// ─────────────────────────────────────────────────────────────────────────────
//  PaddlePal — Smart Pickleball Paddle Firmware
//  Board: Arduino Nano RP2040 Connect  ·  Core: Arduino Mbed OS Nano Boards
//
//  Dual-core split:
//    Core 0 (setup/loop) : IMU + Serial + BLE   — uses Arduino/Mbed APIs
//    Core 1 (core1_entry): FSR polling          — raw Pico SDK only
//
//  Must use the Mbed core (NOT Philhower) or ArduinoBLE won't start on the
//  NINA-W102 module. Full design notes, the Core 1 stack rationale, and the
//  pin/packet reference live in memory-bank/ (progress.md + architecture.md).
// ─────────────────────────────────────────────────────────────────────────────

#include "hardware/adc.h"     // Pico SDK ADC (Core 1)
#include "pico/multicore.h"   // Core 1 launch + inter-core FIFO
#include <ArduinoBLE.h>
#include <Arduino_LSM6DSOX.h> // on-board IMU

// ── Tuning ───────────────────────────────────────────────────────────────────
#define FSR_THRESHOLD 150     // per-zone hit trigger (0-1023 scale)
#define ACCEL_THRESHOLD 0.05f // g   — movement gate for Serial prints
#define GYRO_THRESHOLD 1.0f   // dps — movement gate for Serial prints

// ── BLE identity & characteristics ───────────────────────────────────────────
// Name + service UUID MUST match the app's PADDLE_FILTER (src/hooks/useBluetooth.tsx).
#define PADDLE_BLE_NAME "PaddlePal-Paddle"
#define PADDLE_SERVICE_UUID "9590ad2d-fd81-4688-9d3b-65ac36caca3a"

BLEService paddleService(PADDLE_SERVICE_UUID);
// Read-only placeholder so the service isn't empty on connect.
BLEStringCharacteristic paddleInfo("9590ad2e-fd81-4688-9d3b-65ac36caca3a",
                                   BLERead, 32);
// Live hit stream: a 4-byte notify carrying one raw FIFO word (zone in upper 16
// bits, payload in lower 16 — see sendFSRPacket). Little-endian; the app decodes
// it in src/hooks/usePaddleData.ts. UUIDs: …2d service, …2e info, …2f fsrData.
BLECharacteristic fsrData("9590ad2f-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 4);

// ── Inter-core FIFO helper (Core 1 → Core 0) ─────────────────────────────────
// Pack a hit into one 32-bit word: zone in upper 16 bits, value in lower 16.
void sendFSRPacket(int zoneNumber, int fsrVal) {
  uint32_t packedData = ((uint32_t)zoneNumber << 16) | (fsrVal & 0xFFFF);
  // Drop-if-full so Core 1's polling never blocks when Core 0 is behind.
  if (multicore_fifo_wready()) {
    multicore_fifo_push_blocking(packedData);
  }
}

// Dedicated Core 1 stack (used by the launch in setup). Explicit buffer instead
// of the SDK default, which isn't safe under the Mbed linker — see memory-bank.
// alignas(8): ARM AAPCS requires 8-byte stack alignment.
alignas(8) static uint32_t core1_stack[2048]; // 8KB

// ─────────────────────────────────────────────────────────────────────────────
//  CORE 1 — FSR polling (raw Pico SDK only; no Arduino/Mbed APIs here)
// ─────────────────────────────────────────────────────────────────────────────
// Sensor → analog pin → GPIO → ADC channel (channel is fixed RP2040 hardware):
//   zone1 = A0 = GPIO29 = ch3        zone3 = A2 = GPIO27 = ch1
//   zone2 = A1 = GPIO26 = ch0        zone4 = A3 = GPIO28 = ch2
void core1_entry() {
  // ── Enable ADC on the four sensor pins ──
  adc_init();
  adc_gpio_init(29); // A0 / zone1
  adc_gpio_init(26); // A1 / zone2
  adc_gpio_init(27); // A2 / zone3
  adc_gpio_init(28); // A3 / zone4

  while (true) {
    // ── Read all four zones ──
    // adc_read() is 12-bit (0-4095); >> 2 normalizes to the 10-bit range
    // (0-1023) that FSR_THRESHOLD and the Zone 5 packing expect.
    adc_select_input(3);
    int v1 = adc_read() >> 2; // A0 / zone1
    adc_select_input(0);
    int v2 = adc_read() >> 2; // A1 / zone2
    adc_select_input(1);
    int v3 = adc_read() >> 2; // A2 / zone3
    adc_select_input(2);
    int v4 = adc_read() >> 2; // A3 / zone4

    // ── Detect hits & send ──
    // Zones 1 and 2 are independent.
    if (v1 > FSR_THRESHOLD)
      sendFSRPacket(1, v1);
    if (v2 > FSR_THRESHOLD)
      sendFSRPacket(2, v2);

    // Zones 3/4 overlap — both active is reported as zone 5.
    if (v3 > FSR_THRESHOLD && v4 > FSR_THRESHOLD) {
      // Zone 5: pack both forces into the 16-bit payload, 8 bits each
      // (>> 2 scales each 0-1023 down to 0-255).
      int compressedVals = ((v3 >> 2) << 8) | (v4 >> 2);
      sendFSRPacket(5, compressedVals);
    } else if (v3 > FSR_THRESHOLD) {
      sendFSRPacket(3, v3); // zone 3 only (A2)
    } else if (v4 > FSR_THRESHOLD) {
      sendFSRPacket(4, v4); // zone 4 only (A3)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CORE 0 — Mbed-managed: IMU + Serial + BLE, then launches Core 1
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
  // ── Pins & serial ──
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.begin(9600);
  while (!Serial)
    ; // wait for a USB serial monitor to attach

  // ── IMU bring-up ──
  // Fatal if it fails: fast 200ms blink forever (BLE never comes up).
  if (!IMU.begin()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
    }
  }

  Serial.println("=== 5-Zone Native FSR + IMU Ready ===");

  // ── BLE bring-up ──
  if (!BLE.begin()) {
    Serial.println("[BLE] BLE.begin() FAILED");
    while (1) { // fatal: slow 700ms blink
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

  // ── Advertising ──
  // A 31-byte advert can't hold both the 128-bit UUID and the name, so the UUID
  // goes in the advert and the name in the scan response (iOS active-scans, so
  // it still sees the name).
  BLEAdvertisingData advData;
  advData.setAdvertisedService(paddleService);
  BLE.setAdvertisingData(advData);

  BLEAdvertisingData scanData;
  scanData.setLocalName(PADDLE_BLE_NAME);
  BLE.setScanResponseData(scanData);

  if (!BLE.advertise()) {
    Serial.println("[BLE] BLE.advertise() FAILED");
    while (1) { // fatal: rapid double-blink
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

  // ── Launch Core 1 ──
  // Last, once everything it might race against is ready. Uses the explicit
  // core1_stack declared above.
  multicore_launch_core1_with_stack(core1_entry, core1_stack,
                                    sizeof(core1_stack));
}

void loop() {
  // ── BLE poll ──
  // Every pass, unconditionally — keeps BLE responsive to connect/disconnect.
  BLE.poll();

  // ── ~50ms timing gate ──
  // Non-blocking (vs. delay(50)) so BLE.poll() keeps running. FSR timing is
  // unaffected — that runs on Core 1.
  static uint32_t lastTick = 0;
  if (millis() - lastTick < 50)
    return;
  lastTick = millis();

  // ── Read IMU ──
  float ax = 0, ay = 0, az = 0;
  float gx = 0, gy = 0, gz = 0;

  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(ax, ay, az);
  }
  if (IMU.gyroscopeAvailable()) {
    IMU.readGyroscope(gx, gy, gz);
  }

  bool gotHit = multicore_fifo_rvalid(); // FSR hit waiting in the FIFO?

  // Is the board moving?
  bool imuActive = (abs(ax) > ACCEL_THRESHOLD) || (abs(ay) > ACCEL_THRESHOLD) ||
                   (abs(gx) > GYRO_THRESHOLD) || (abs(gy) > GYRO_THRESHOLD) ||
                   (abs(gz) > GYRO_THRESHOLD);

  // ── Print IMU + drain FSR hits ──
  // Only when something happened, to keep the Serial log readable.
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

    // Drain every hit Core 1 has queued.
    while (multicore_fifo_rvalid()) {
      uint32_t packedData = multicore_fifo_pop_blocking();

      // Mirror the raw word out over BLE (no re-encode); a no-op on the air when
      // nothing is subscribed.
      fsrData.writeValue((uint8_t *)&packedData, 4);

      int zoneNum = packedData >> 16;    // unpack zone
      int payload = packedData & 0xFFFF; // unpack payload

      if (zoneNum == 5) {
        // Zone 5: two forces packed 8 bits each; << 2 restores 0-255 → 0-1020.
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
        // Zones 1-4: single force value.
        Serial.print("[FSR] zone");
        Serial.print(zoneNum);
        Serial.print(" HIT: ");
        Serial.print(payload);
        Serial.println(" / 1023");
      }
    }
  }
}
