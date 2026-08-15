// ─────────────────────────────────────────────────────────────────────────────
//  PaddlePal — Smart Pickleball Paddle Firmware (planB.ino — current build)
//  Board: Arduino Nano RP2040 Connect · Core: Arduino Mbed OS Nano Boards
//
//  Core 0 (setup/loop):  IMU + Serial debug + BLE + vibration motor + watchdog
//  Core 1 (core1_entry): FSR polling, bare Pico SDK only — launched below
//
//  Design rationale, history, and tuning guidance (why the Mbed core, why the
//  watchdog and FSR hysteresis/failsafe logic exist, why the power buttons
//  were removed, etc.) all live in memory-bank/planB-design-notes.md. The
//  comments in this file explain HOW the code below works, not why it was
//  built this way.
// ─────────────────────────────────────────────────────────────────────────────

#include "hardware/adc.h"
#include "hardware/timer.h"    // time_us_64() — FSR window age (Core-1-safe)
#include "hardware/watchdog.h" // watchdog_enable/update/caused_reboot
#include "pico/multicore.h"
#include <ArduinoBLE.h>
#include <Arduino_LSM6DSOX.h>
//
// Digital peripheral pins. These are Arduino pin NUMBERS (indices into the
// core's pin table), NOT RP2040 GPIO numbers. On this board D3=GPIO15,
// D6=GPIO18, D7=GPIO19 — passing the GPIO number drives the wrong pin
// (15=A1, 18=A4/SDA, 19=A5/SCL). Use the D-number.
#define MOTOR_OUTPUT 6 // D6 — haptic feedback motor
#define LOAD_SWITCH_EN                                                         \
  7 // D7 — power-rail enable; asserted HIGH at boot and
    // never driven LOW (no power buttons on this board —
    // see memory-bank/planB-design-notes.md)

bool motorActive = false;
unsigned long motorStartTime = 0;
unsigned long motorDurationMs = 0;
// Buzz lengths: a short tick on a zone-1 hit, and a long one at boot so the
// user can feel that the paddle came up (there is no power LED any more).
const unsigned long MOTOR_HIT_MS = 200;
const unsigned long MOTOR_STARTUP_MS = 3000;

// Hit detection uses hysteresis: a zone's window opens above TRIGGER and only
// closes below RELEASE (see core1_entry()). Design rationale + tuning risk:
// memory-bank/planB-design-notes.md.
#define FSR_TRIGGER_THRESHOLD 150
#define FSR_RELEASE_THRESHOLD 100

// Hard ceiling on how long one hit window may stay open (stuck-sensor
// failsafe — see core1_entry()). Design rationale: planB-design-notes.md.
#define FSR_MAX_WINDOW_US 400000 // 400ms

// Reboots the chip if not pet within this window (see loop()). Arm-order and
// tuning rationale: memory-bank/planB-design-notes.md.
#define WATCHDOG_TIMEOUT_MS 4000
#define WATCHDOG_CHECK_INTERVAL_MS 500

#define ACCEL_THRESHOLD 0.05f
#define GYRO_THRESHOLD 1.0f

// BLE identity — these two values MUST stay in sync with the app's
// PADDLE_FILTER in src/hooks/useBluetooth.tsx (matches on name OR service
// UUID). Do not change them here without updating the app to match.
#define PADDLE_BLE_NAME "PaddlePal-Paddle"
#define PADDLE_SERVICE_UUID "9590ad2d-fd81-4688-9d3b-65ac36caca3a"

BLEService paddleService(PADDLE_SERVICE_UUID);
// Minimal read-only device-info characteristic, originally added so the
// advertised service wasn't empty on connect. The real telemetry streams are
// the two notify characteristics below.
BLEStringCharacteristic paddleInfo("9590ad2e-fd81-4688-9d3b-65ac36caca3a",
                                   BLERead, 32);
// Live FSR hit stream: a 4-byte notify carrying the raw inter-core FIFO word
// (zone in upper 16 bits, FSR payload in lower 16 — see sendFSRPacket()). Sent
// little-endian on the wire (RP2040). Decoded by the app in
// src/hooks/usePaddleData.ts with identical unpacking.
BLECharacteristic fsrData("9590ad2f-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 4);
// Live IMU stream: a 12-byte notify carrying six int16s, little-endian, in the
// order ax, ay, az, gx, gy, gz (see loop()). Written every ~50ms tick,
// unconditionally and forever — the firmware has no concept of a session, so
// the APP decides whether anyone is listening by subscribing only while it is
// recording. Nothing is transmitted when no central has enabled notifications.
// Decoded by the app in src/hooks/useImuBuffer.ts. UUID sequence:
// ...2d = service, ...2e = paddleInfo, ...2f = fsrData, ...30 = reserved for
// session control (app-side stub today), ...31 = imuData.
BLECharacteristic imuData("9590ad31-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 12);

// Fixed-point scale factors for the IMU notify payload above, in counts per
// unit. Arduino_LSM6DSOX configures the sensor at +/-4 g and +/-2000 dps
// (CTRL1_XL 0x4A / CTRL2_G 0x4C) and returns g and deg/s, so at these scales a
// full-scale reading lands at +/-16384 and +/-32000 counts respectively —
// inside int16 either way, so a real reading can never clip:
//   accel: 4096 counts per g    -> 0.244 mg per count (sensor LSB: 0.122 mg)
//   gyro:  16 counts per deg/s  -> 0.0625 deg/s per count (sensor LSB: 0.061)
// The app dequantizes with the exact inverse of these two numbers. Change one
// here and src/hooks/useImuBuffer.ts MUST change to match — a mismatch corrupts
// every sample silently, with no error anywhere.
#define IMU_ACCEL_SCALE 4096.0f
#define IMU_GYRO_SCALE 16.0f

// Float -> int16 for the payload above. The clamp can't trigger at the scales
// documented there; it's here so a future rescale can't silently wrap.
int16_t quantizeImu(float value, float scale) {
  float scaled = value * scale;
  if (scaled > 32767.0f)
    return 32767;
  if (scaled < -32768.0f)
    return -32768;
  return (int16_t)lroundf(scaled);
}

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

alignas(8) static uint32_t core1_stack[2048]; // 8KB

// Core 1 liveness proof, read by Core 0's watchdog check in loop(). Bumped once
// per FSR poll pass. Single writer (Core 1) / single reader (Core 0), no lock
// needed. Background: memory-bank/planB-design-notes.md.
volatile uint32_t g_core1Heartbeat = 0;

// ─────────────────────────────────────────────
//  CORE 1 — FSR polling (raw Pico SDK only — no Arduino/Mbed APIs)
// ─────────────────────────────────────────────
// Launched manually from setup() via multicore_launch_core1_with_stack(); owns
// its own while(true) (Mbed doesn't auto-repeat this the way loop1() would).
//
// Sensor -> analog pin -> ADC channel (channel is fixed RP2040 hardware):
//   zone1 = A0 = GPIO29 = ch3        zone3 = A2 = GPIO27 = ch1
//   zone2 = A1 = GPIO26 = ch0        zone4 = A3 = GPIO28 = ch2
//
// One packet per hit: each zone tracks a hit WINDOW — opens on the rising edge
// past FSR_TRIGGER_THRESHOLD, holds the largest reading seen while open
// (peak-hold), and sends exactly once when it closes below
// FSR_RELEASE_THRESHOLD (or the FSR_MAX_WINDOW_US ceiling fires). Zones 3/4
// share one group window instead of sending individually — "zone 5" means A2
// and A3 were both open at some point during that window; see the
// classification logic below. Design rationale:
// memory-bank/planB-design-notes.md.
void core1_entry() {
  adc_init();
  adc_gpio_init(29); // A0 / zone1
  adc_gpio_init(26); // A1 / zone2
  adc_gpio_init(27); // A2 / zone3
  adc_gpio_init(28); // A3 / zone4

  // Zones 1 & 2: independent windows.
  bool z1Open = false, z2Open = false;
  int z1Peak = 0, z2Peak = 0;

  // Zones 3 & 4: individual windows, but they share one group window (below)
  // because zone 5 is defined as the two of them overlapping.
  bool z3Open = false, z4Open = false;
  int z3Peak = 0, z4Peak = 0;

  // When each window opened, for the FSR_MAX_WINDOW_US failsafe. Only read
  // while that zone's window is open, so the initial 0 is never used.
  uint64_t z1OpenedAt = 0, z2OpenedAt = 0, z3OpenedAt = 0, z4OpenedAt = 0;
  // True once zones 3 and 4 have been open at the same time during the current
  // group window — this is what makes it a zone 5 hit rather than two separate
  // edge hits.
  bool sawBoth = false;

  while (true) {
    // Unconditional liveness proof for Core 0's watchdog check. Must stay
    // outside every branch below — if this only ran on some paths, a quiet
    // paddle would look like a dead core and trigger a spurious reboot.
    g_core1Heartbeat++;

    // adc_read() is 12-bit (0-4095); >> 2 normalizes to the 10-bit range
    // (0-1023) that the thresholds and the Zone 5 packing expect.
    adc_select_input(3);
    int v1 = adc_read() >> 2; // A0 / zone1
    adc_select_input(0);
    int v2 = adc_read() >> 2; // A1 / zone2
    adc_select_input(1);
    int v3 = adc_read() >> 2; // A2 / zone3
    adc_select_input(2);
    int v4 = adc_read() >> 2; // A3 / zone4

    // ── Zone 1 ──────────────────────────────────────────────
    if (!z1Open) {
      if (v1 > FSR_TRIGGER_THRESHOLD) {
        z1Open = true;
        z1Peak = v1;
        z1OpenedAt = time_us_64();
      }
    } else {
      if (v1 > z1Peak)
        z1Peak = v1;
      // Normal close (released) OR failsafe close (open too long — see
      // FSR_MAX_WINDOW_US). Both take the same send-and-reset path: the group
      // logic below and everything downstream only care THAT a window closed,
      // never why.
      if (v1 < FSR_RELEASE_THRESHOLD ||
          (time_us_64() - z1OpenedAt) > FSR_MAX_WINDOW_US) {
        sendFSRPacket(1, z1Peak); // window closed: one hit, at its peak force
        z1Open = false;
      }
    }

    // ── Zone 2 ── (same pattern as zone 1)
    if (!z2Open) {
      if (v2 > FSR_TRIGGER_THRESHOLD) {
        z2Open = true;
        z2Peak = v2;
        z2OpenedAt = time_us_64();
      }
    } else {
      if (v2 > z2Peak)
        z2Peak = v2;
      if (v2 < FSR_RELEASE_THRESHOLD ||
          (time_us_64() - z2OpenedAt) > FSR_MAX_WINDOW_US) {
        sendFSRPacket(2, z2Peak);
        z2Open = false;
      }
    }

    // ── Zones 3 / 4 / 5 group window ────────────────────────
    // Neither zone sends on its own close. The group window spans from the
    // first of the two opening to the last of them closing, and produces
    // exactly one packet (zone 3, 4, or 5) at that close.
    bool groupWasOpen = z3Open || z4Open;

    if (!z3Open) {
      if (v3 > FSR_TRIGGER_THRESHOLD) {
        z3Open = true;
        z3Peak = v3;
        z3OpenedAt = time_us_64();
      }
    } else {
      if (v3 > z3Peak)
        z3Peak = v3;
      if (v3 < FSR_RELEASE_THRESHOLD ||
          (time_us_64() - z3OpenedAt) > FSR_MAX_WINDOW_US)
        z3Open = false; // deliberately no send here
    }

    if (!z4Open) {
      if (v4 > FSR_TRIGGER_THRESHOLD) {
        z4Open = true;
        z4Peak = v4;
        z4OpenedAt = time_us_64();
      }
    } else {
      if (v4 > z4Peak)
        z4Peak = v4;
      if (v4 < FSR_RELEASE_THRESHOLD ||
          (time_us_64() - z4OpenedAt) > FSR_MAX_WINDOW_US)
        z4Open = false; // deliberately no send here
    }

    if (z3Open && z4Open)
      sawBoth = true;

    if (groupWasOpen && !(z3Open || z4Open)) {
      // The group window closed on this scan — classify it and send once.
      if (sawBoth) {
        // ZONE 5: A2 and A3 were pressed together.
        // Compress both 10-bit peaks (0-1023) into the 16-bit payload space:
        // A2 in the upper 8 bits, A3 in the lower 8.
        // (Note: shifting right by 2 scales 0-1023 down to 0-255 to fit 8 bits)
        int compressedVals = ((z3Peak >> 2) << 8) | (z4Peak >> 2);
        sendFSRPacket(5, compressedVals);
      } else if (z3Peak > 0 || z4Peak > 0) {
        // Only one sensor crossed the trigger during this window — a hit near
        // the 3/4 boundary, not an overlap, so it must NOT report as zone 5.
        // (If both somehow have a peak without ever overlapping — the two
        // would have to swap within a single sub-millisecond scan — report
        // whichever actually took the harder hit rather than always zone 3.)
        if (z3Peak >= z4Peak)
          sendFSRPacket(3, z3Peak); // ZONE 3: only A2 was active
        else
          sendFSRPacket(4, z4Peak); // ZONE 4: only A3 was active
      }
      z3Peak = 0;
      z4Peak = 0;
      sawBoth = false; // rearm for the next hit
    }
  }
}

// Motor code. Non-blocking: this only starts the buzz and records how long it
// should last — loop() switches the motor back off once that time is up. A
// re-trigger while one is already running simply restarts the timer.
void triggerMotor(unsigned long durationMs) {
  digitalWrite(MOTOR_OUTPUT, HIGH);
  motorActive = true;
  motorStartTime = millis();
  motorDurationMs = durationMs;
}

// ─────────────────────────────────────────────
//  CORE 0 — Mbed-managed: IMU + Serial + BLE + Core 1 launch
// ─────────────────────────────────────────────
void setup() {
  // Assert the power-rail load switch immediately at boot, before anything
  // else, so the board keeps itself powered for the rest of this sketch.
  pinMode(LOAD_SWITCH_EN, OUTPUT);
  digitalWrite(LOAD_SWITCH_EN, HIGH);

  pinMode(LED_BUILTIN, OUTPUT);

  pinMode(MOTOR_OUTPUT, OUTPUT);
  digitalWrite(MOTOR_OUTPUT, LOW);

  Serial.begin(9600);
  // Visibility into how often the watchdog actually fires in the field —
  // otherwise a stall-and-recover looks identical to a normal boot and leaves
  // no trace. Note this sketch does NOT gate on `while (!Serial)`, so with no
  // host attached this line is simply dropped, same as every other print here.
  if (watchdog_caused_reboot()) {
    Serial.println("[WATCHDOG] Rebooted after a stall");
  }

  // IMU bring-up — baseline behavior preserved: failure halts here in a fast
  // blink loop, which means BLE never comes up if the IMU is dead. Because this
  // is fatal, no "IMU ready" flag is needed downstream.
  if (!IMU.begin()) { // two blinks
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(2000);
    }
  }
  // ── BLE bring-up ────────────────────────────────────────────
  if (!BLE.begin()) { // one blink
    Serial.println("[BLE] BLE.begin() FAILED");
    while (1) { // slow blink (700ms) distinguishes BLE failure from IMU failure
      digitalWrite(LED_BUILTIN, HIGH);
      delay(700);
      digitalWrite(LED_BUILTIN, LOW);
      delay(700);
      delay(2000);
    }
  }

  BLE.setDeviceName(PADDLE_BLE_NAME);
  paddleService.addCharacteristic(paddleInfo);
  paddleService.addCharacteristic(fsrData);
  paddleService.addCharacteristic(imuData);
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

  if (!BLE.advertise()) { // 3 blinks
    Serial.println("[BLE] BLE.advertise() FAILED");
    while (1) { // rapid double-blink distinguishes advertise failure
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(2000);
    }
  }

  // Launch Core 1 last, once everything it might race against is ready.
  multicore_launch_core1_with_stack(core1_entry, core1_stack,
                                    sizeof(core1_stack));

  // Startup buzz — the paddle's "I'm on" signal (no lit power button any
  // more). Non-blocking; loop() turns the motor off once MOTOR_STARTUP_MS
  // elapses. Placed here, after a successful bring-up: see
  // memory-bank/planB-design-notes.md for why the ordering matters.
  triggerMotor(MOTOR_STARTUP_MS);

  // Armed last — after IMU/BLE bring-up and the Core 1 launch. Do not move
  // this earlier; see memory-bank/planB-design-notes.md for why the order
  // matters.
  watchdog_enable(WATCHDOG_TIMEOUT_MS,
                  true); // true = pause when debugger halts
}

void loop() {
  // Watchdog check-and-pet, ~every 500ms — must stay at the very top of
  // loop(), before the early-return below, so a Core 0 hang further down
  // (inside IMU.gyroscopeAvailable()) reliably stops this from ever running
  // again. Pets only if Core 1's heartbeat has advanced since the last check.
  // Why one check covers both a Core 1 death and a Core 0 hang:
  // memory-bank/planB-design-notes.md.
  static uint32_t lastWatchdogCheck = 0;
  static uint32_t lastSeenHeartbeat = 0;
  if (millis() - lastWatchdogCheck >= WATCHDOG_CHECK_INTERVAL_MS) {
    lastWatchdogCheck = millis();
    uint32_t hb = g_core1Heartbeat; // single volatile read, then compare
    if (hb != lastSeenHeartbeat) {
      lastSeenHeartbeat = hb;
      watchdog_update(); // Core 1 proved it is alive since the last check
    }
    // else: heartbeat frozen — withhold the pet ON PURPOSE and let the
    // watchdog reboot us.
  }

  // Ends whichever buzz is running — the 3s startup one or a 200ms hit tick.
  if (motorActive && (millis() - motorStartTime >= motorDurationMs)) {
    digitalWrite(MOTOR_OUTPUT, LOW);
    motorActive = false;
  }

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

  // Mirror this tick's IMU reading out as a 12-byte notify. Deliberately
  // OUTSIDE the imuActive/gotHit gate below — that gate only ever controlled
  // the Serial print, and the app needs the quiet samples too (a still paddle
  // right before a hit is itself a signal for shot classification). Unfiltered
  // and unconditional: no threshold, no session state, every tick. At the
  // sensor's 104Hz ODR a reading is essentially always available at this 20Hz
  // cadence; on the rare tick where it isn't, the locals above are still 0 and
  // the sample decodes as all-zeros rather than as stale data.
  int16_t imuPacket[6] = {
      quantizeImu(ax, IMU_ACCEL_SCALE), quantizeImu(ay, IMU_ACCEL_SCALE),
      quantizeImu(az, IMU_ACCEL_SCALE), quantizeImu(gx, IMU_GYRO_SCALE),
      quantizeImu(gy, IMU_GYRO_SCALE),  quantizeImu(gz, IMU_GYRO_SCALE)};
  imuData.writeValue((uint8_t *)imuPacket, sizeof(imuPacket));

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
      if (zoneNum == 1) {
        triggerMotor(MOTOR_HIT_MS);
      }
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