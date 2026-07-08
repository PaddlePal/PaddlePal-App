// ─────────────────────────────────────────────────────────────────────────────
//  PaddlePal — Smart Pickleball Paddle Firmware
//  Board: Arduino Nano RP2040 Connect
//  Core:  Arduino Mbed OS Nano Boards  (NOT Philhower arduino-pico)
//
//  Why the Mbed core: the Philhower arduino-pico core cannot bring up
//  ArduinoBLE on this board's u-blox NINA-W102 module (BLE.begin() fails,
//  paddle never advertises). The official Arduino Mbed OS Nano core supports
//  ArduinoBLE here natively. See memory-bank/progress.md (2026-07-06 "BLE
//  Discovery Debugging").
//
//  Dual-core model: Mbed manages ONLY Core 0 (setup()/loop()) — there is no
//  setup1()/loop1(). Core 1 is launched manually via the Pico SDK
//  (multicore_launch_core1). Core 1 runs bare metal and MUST NOT call any
//  Arduino or Mbed API (no Serial / analogRead / delay / digitalWrite) — raw
//  Pico SDK only.
//
//    Core 0 (setup/loop) : IMU + Serial debug + BLE   (need Arduino APIs)
//    Core 1 (core1_entry): FSR polling, raw Pico SDK   (dedicated,
//    contention-free)
//
//  This pass adds BLE IDENTITY/ADVERTISING ONLY (discoverable + connectable).
//  No data characteristics / notify streaming yet — that's a follow-up task.
//  IMU + FSR + Serial behavior is preserved byte-for-byte from the pre-BLE
//  baseline.
// ─────────────────────────────────────────────────────────────────────────────

#include "hardware/adc.h"
#include "pico/multicore.h"
#include <ArduinoBLE.h>
#include <Arduino_LSM6DSOX.h>

#define FSR_THRESHOLD 150
#define ACCEL_THRESHOLD 0.05f
#define GYRO_THRESHOLD 1.0f

// BLE identity — these two values MUST stay in sync with the app's
// PADDLE_FILTER in src/hooks/useBluetooth.tsx (matches on name OR service
// UUID). Do not change them here without updating the app to match.
#define PADDLE_BLE_NAME "PaddlePal-Paddle"
#define PADDLE_SERVICE_UUID "9590ad2d-fd81-4688-9d3b-65ac36caca3a"

BLEService paddleService(PADDLE_SERVICE_UUID);
// Minimal read-only placeholder so the advertised service isn't empty on
// connect. Real FSR/IMU telemetry characteristics are a follow-up task, not
// this pass.
BLEStringCharacteristic paddleInfo("9590ad2e-fd81-4688-9d3b-65ac36caca3a",
                                   BLERead, 32);
// Live FSR hit stream: a 4-byte notify carrying the raw inter-core FIFO word
// (zone in upper 16 bits, FSR payload in lower 16 — see sendFSRPacket()). Sent
// little-endian on the wire (RP2040). Decoded by the app in
// src/hooks/usePaddleData.ts with identical unpacking. UUID sequence:
// ...2d = service, ...2e = paddleInfo, ...2f = fsrData.
BLECharacteristic fsrData("9590ad2f-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 4);

// Helper function to pack data and send to Core 0 via FIFO
// Zone number goes into upper 16 bits, FSR value goes into lower 16 bits
// For Zone 5: upper 16 bits = 5, lower 16 bits contains A2 (upper 8) and A3
// (lower 8)
void sendFSRPacket(int zoneNumber, int fsrVal) {
  uint32_t packedData = ((uint32_t)zoneNumber << 16) | (fsrVal & 0xFFFF);
  // Drop-if-full: preserves the baseline's non-blocking rp2040.fifo.push_nb()
  // behavior. wready() guarantees the push won't block; if the FIFO is full we
  // simply skip so Core 1's FSR polling never stalls.
  if (multicore_fifo_wready()) {
    multicore_fifo_push_blocking(packedData);
  }
}

// ─────────────────────────────────────────────
//  CORE 1 — Lightning-fast polling of native pins (raw Pico SDK ONLY)
// ─────────────────────────────────────────────
// Launched manually from setup() via multicore_launch_core1(). Runs bare metal:
// no Arduino/Mbed APIs here. Replaces the baseline's Core-0 setup()/loop() FSR
// polling — Mbed does not auto-repeat this, so it owns its own while(true).
//
// Pin -> ADC channel (fixed RP2040 hardware):
//   A0 = GPIO26 = ch0,  A1 = GPIO27 = ch1,  A2 = GPIO28 = ch2,  A3 = GPIO29 =
//   ch3
void core1_entry() {
  adc_init();
  adc_gpio_init(26); // A0
  adc_gpio_init(27); // A1
  adc_gpio_init(28); // A2
  adc_gpio_init(29); // A3

  while (true) {
    // adc_read() returns the RP2040's native 12-bit value (0-4095). The
    // baseline used Arduino analogRead() (10-bit, 0-1023), which FSR_THRESHOLD
    // and the Zone 5 (>> 2) packing are calibrated against. Right-shift by 2
    // immediately to normalize 12-bit -> 10-bit so all downstream logic stays
    // byte-for-byte identical to the baseline.
    //
    // NOTE: preserve the baseline's deliberate (non-numeric) mapping —
    // v3 reads from A3 and v4 reads from A2.
    adc_select_input(0);
    int v1 = adc_read() >> 2; // A0
    adc_select_input(1);
    int v2 = adc_read() >> 2; // A1
    adc_select_input(3);
    int v3 = adc_read() >> 2; // A3 (baseline: v3 = analogRead(A3))
    adc_select_input(2);
    int v4 = adc_read() >> 2; // A2 (baseline: v4 = analogRead(A2))

    // Process Zone 1 and Zone 2 normally
    if (v1 > FSR_THRESHOLD)
      sendFSRPacket(1, v1);
    if (v2 > FSR_THRESHOLD)
      sendFSRPacket(2, v2);

    // Evaluate overlap logic for Zone 3, 4, and 5
    if (v3 > FSR_THRESHOLD && v4 > FSR_THRESHOLD) {
      // ZONE 5: Both A2 and A3 are active.
      // Compress both 10-bit ADC values (0-1023) into the 16-bit payload space:
      // v3 goes into the upper 8 bits, v4 goes into the lower 8 bits.
      // (Note: shifting right by 2 scales 0-1023 down to 0-255 to fit 8 bits)
      int compressedVals = ((v3 >> 2) << 8) | (v4 >> 2);
      sendFSRPacket(5, compressedVals);
    } else if (v3 > FSR_THRESHOLD) {
      // ZONE 3: Only A2 is active
      sendFSRPacket(3, v3);
    } else if (v4 > FSR_THRESHOLD) {
      // ZONE 4: Only A3 is active
      sendFSRPacket(4, v4);
    }
  }
}

// ─────────────────────────────────────────────
//  CORE 0 — Mbed-managed: IMU + Serial + BLE + Core 1 launch
// ─────────────────────────────────────────────
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.begin(9600);
  while (!Serial)
    ; // block until a USB serial monitor attaches (baseline behavior)

  // IMU bring-up — baseline behavior preserved: failure halts here in a fast
  // blink loop, which means BLE never comes up if the IMU is dead. Because this
  // is fatal, no "IMU ready" flag is needed downstream.
  if (!IMU.begin()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
    }
  }

  Serial.println("=== 5-Zone Native FSR + IMU Ready ===");

  // ── BLE bring-up ────────────────────────────────────────────
  if (!BLE.begin()) {
    Serial.println("[BLE] BLE.begin() FAILED");
    while (1) { // slow blink (700ms) distinguishes BLE failure from IMU failure
      digitalWrite(LED_BUILTIN, HIGH);
      delay(700);
      digitalWrite(LED_BUILTIN, LOW);
      delay(700);
    }
  }

  BLE.setDeviceName(PADDLE_BLE_NAME);
  paddleService.addCharacteristic(paddleInfo);
  paddleService.addCharacteristic(fsrData);
  paddleInfo.writeValue(PADDLE_BLE_NAME);
  BLE.addService(paddleService);

  // A BLE advertising packet is capped at 31 bytes — a 128-bit service UUID
  // (18B) and a local name (18B) don't both fit in the main packet. Put the
  // UUID in the advertising packet and the name in the scan response; iOS
  // active-scans, so the app sees both (the app matches on name OR service
  // UUID, and checks the scan-response localName — see
  // src/hooks/useBluetooth.tsx).
  BLEAdvertisingData advData;
  advData.setAdvertisedService(paddleService);
  BLE.setAdvertisingData(advData);

  BLEAdvertisingData scanData;
  scanData.setLocalName(PADDLE_BLE_NAME);
  BLE.setScanResponseData(scanData);

  if (!BLE.advertise()) {
    Serial.println("[BLE] BLE.advertise() FAILED");
    while (1) { // rapid double-blink distinguishes advertise failure
      digitalWrite(LED_BUILTIN, HIGH);
      delay(100);
      digitalWrite(LED_BUILTIN, LOW);
      delay(100);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(100);
      digitalWrite(LED_BUILTIN, LOW);
      delay(500);
    }
  }
  Serial.print("[BLE] Advertising as '");
  Serial.print(PADDLE_BLE_NAME);
  Serial.print("' with service ");
  Serial.println(PADDLE_SERVICE_UUID);

  // Launch Core 1 last, once everything it might race against is ready.
  multicore_launch_core1(core1_entry);
}

void loop() {
  // Must run every pass, unconditionally, for BLE to stay responsive to
  // connect/disconnect and central requests.
  BLE.poll();

  // The baseline used a flat delay(50) here, which would now block BLE.poll()
  // for 50ms every pass. Replace it with a non-blocking millis() gate so BLE
  // stays responsive while the IMU/print/drain block still runs at the same
  // ~50ms cadence as before. (FSR timing is unaffected either way — FSR is
  // isolated on Core 1.)
  static uint32_t lastTick = 0;
  if (millis() - lastTick < 50)
    return;
  lastTick = millis();

  float ax = 0, ay = 0, az = 0;
  float gx = 0, gy = 0, gz = 0;

  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(ax, ay, az);
  }
  if (IMU.gyroscopeAvailable()) {
    IMU.readGyroscope(gx, gy, gz);
  }

  // Check if any FSR data is waiting in the FIFO queue
  bool gotHit = multicore_fifo_rvalid();

  // Check if board is moving
  bool imuActive = (abs(ax) > ACCEL_THRESHOLD) || (abs(ay) > ACCEL_THRESHOLD) ||
                   (abs(gx) > GYRO_THRESHOLD) || (abs(gy) > GYRO_THRESHOLD) ||
                   (abs(gz) > GYRO_THRESHOLD);

  // Only print if moving OR a hit was detected
  if (imuActive || gotHit) {
    Serial.println("──────────────────────────────");

    if (imuActive) {
      Serial.print("Accel  X: ");
      Serial.print(ax, 3);
      Serial.print("  Y: ");
      Serial.print(ay, 3);
      Serial.print("  Z: ");
      Serial.println(az, 3);
      Serial.print("Gyro   X: ");
      Serial.print(gx, 2);
      Serial.print("  Y: ");
      Serial.print(gy, 2);
      Serial.print("  Z: ");
      Serial.println(gz, 2);
    }

    // Process and print all pending FSR hits collected in the queue
    while (multicore_fifo_rvalid()) {
      uint32_t packedData = multicore_fifo_pop_blocking();

      // Mirror the raw FIFO word out over BLE as a 4-byte notify, in addition
      // to the Serial print below. These are the exact bytes Core 1 packed via
      // sendFSRPacket() (zone in upper 16 bits, payload in lower 16) — no
      // re-encoding. writeValue() both stores and notifies any subscribed
      // central; it's a no-op on the air when nothing is subscribed. Serial
      // output below is unchanged, preserving the byte-for-byte discipline.
      fsrData.writeValue((uint8_t *)&packedData, 4);

      // Unpack variables back out from the single 32-bit integer
      int zoneNum = packedData >> 16;
      int payload = packedData & 0xFFFF;

      if (zoneNum == 5) {
        // Unpack and reconstruct the two separate sensor forces for Zone 5
        // Shifting left by 2 restores the 0-255 byte back to the 0-1020 range
        int fsrA2 = (payload >> 8) << 2;
        int fsrA3 = (payload & 0xFF) << 2;

        Serial.print("[FSR] zone5 HIT -> ");
        Serial.print("A2: ");
        Serial.print(fsrA2);
        Serial.print(" / 1023 | ");
        Serial.print("A3: ");
        Serial.print(fsrA3);
        Serial.println(" / 1023");
      } else {
        // Standard printing for Zones 1, 2, 3, and 4
        Serial.print("[FSR] zone");
        Serial.print(zoneNum);
        Serial.print(" HIT: ");
        Serial.print(payload);
        Serial.println(" / 1023");
      }
    }
  }
}
