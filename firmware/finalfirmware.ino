#include "hardware/adc.h"
#include "hardware/timer.h"
#include "hardware/watchdog.h"
#include "pico/multicore.h"
#include <ArduinoBLE.h>
#include <Arduino_LSM6DSOX.h>

#define MOTOR_OUTPUT 6
#define LOAD_SWITCH_EN 7

bool motorActive = false;
unsigned long motorStartTime = 0;
unsigned long motorDurationMs = 0;

const unsigned long MOTOR_HIT_MS = 200;
const unsigned long MOTOR_STARTUP_MS = 1000;

#define FSR_TRIGGER_THRESHOLD 150
#define FSR_RELEASE_THRESHOLD 100

#define FSR_MAX_WINDOW_US 400000

#define WATCHDOG_TIMEOUT_MS 4000
#define WATCHDOG_CHECK_INTERVAL_MS 500

#define ACCEL_THRESHOLD 0.05f
#define GYRO_THRESHOLD 1.0f

#define PADDLE_BLE_NAME "PaddlePal-Paddle"
#define PADDLE_SERVICE_UUID "9590ad2d-fd81-4688-9d3b-65ac36caca3a"

BLEService paddleService(PADDLE_SERVICE_UUID);

BLEStringCharacteristic paddleInfo("9590ad2e-fd81-4688-9d3b-65ac36caca3a",
                                   BLERead, 32);

BLECharacteristic fsrData("9590ad2f-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 4);

BLECharacteristic imuData("9590ad31-fd81-4688-9d3b-65ac36caca3a",
                          BLERead | BLENotify, 12);

#define IMU_ACCEL_SCALE 4096.0f
#define IMU_GYRO_SCALE 16.0f

int16_t quantizeImu(float value, float scale) {
  float scaled = value * scale;
  if (scaled > 32767.0f)
    return 32767;
  if (scaled < -32768.0f)
    return -32768;
  return (int16_t)lroundf(scaled);
}

void sendFSRPacket(int zoneNumber, int fsrVal) {
  uint32_t packedData = ((uint32_t)zoneNumber << 16) | (fsrVal & 0xFFFF);

  if (multicore_fifo_wready()) {
    multicore_fifo_push_blocking(packedData);
  }
}

alignas(8) static uint32_t core1_stack[2048];

volatile uint32_t g_core1Heartbeat = 0;

void core1_entry() {
  adc_init();
  adc_gpio_init(29);
  adc_gpio_init(26);
  adc_gpio_init(27);
  adc_gpio_init(28);

  bool z1Open = false, z2Open = false;
  int z1Peak = 0, z2Peak = 0;

  bool z3Open = false, z4Open = false;
  int z3Peak = 0, z4Peak = 0;

  uint64_t z1OpenedAt = 0, z2OpenedAt = 0, z3OpenedAt = 0, z4OpenedAt = 0;

  bool sawBoth = false;

  while (true) {
    g_core1Heartbeat++;

    adc_select_input(3);
    int v1 = adc_read() >> 2;
    adc_select_input(0);
    int v2 = adc_read() >> 2;
    adc_select_input(1);
    int v3 = adc_read() >> 2;
    adc_select_input(2);
    int v4 = adc_read() >> 2;

    if (!z1Open) {
      if (v1 > FSR_TRIGGER_THRESHOLD) {
        z1Open = true;
        z1Peak = v1;
        z1OpenedAt = time_us_64();
      }
    } else {
      if (v1 > z1Peak)
        z1Peak = v1;
      if (v1 < FSR_RELEASE_THRESHOLD ||
          (time_us_64() - z1OpenedAt) > FSR_MAX_WINDOW_US) {
        sendFSRPacket(1, z1Peak);
        z1Open = false;
      }
    }

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
        z3Open = false;
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
        z4Open = false;
    }

    if (z3Open && z4Open)
      sawBoth = true;

    if (groupWasOpen && !(z3Open || z4Open)) {
      if (sawBoth) {
        int compressedVals = ((z3Peak >> 2) << 8) | (z4Peak >> 2);
        sendFSRPacket(5, compressedVals);
      } else if (z3Peak > 0 || z4Peak > 0) {
        if (z3Peak >= z4Peak)
          sendFSRPacket(3, z3Peak);
        else
          sendFSRPacket(4, z4Peak);
      }
      z3Peak = 0;
      z4Peak = 0;
      sawBoth = false;
    }
  }
}

void triggerMotor(unsigned long durationMs) {
  digitalWrite(MOTOR_OUTPUT, HIGH);
  motorActive = true;
  motorStartTime = millis();
  motorDurationMs = durationMs;
}

void setup() {
  pinMode(LOAD_SWITCH_EN, OUTPUT);
  digitalWrite(LOAD_SWITCH_EN, HIGH);

  pinMode(MOTOR_OUTPUT, OUTPUT);
  digitalWrite(MOTOR_OUTPUT, LOW);

  if (!IMU.begin()) {
    while (1) {
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(2000);
    }
  }

  if (!BLE.begin()) { // 3 pulses
    while (1) {
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(250);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(2000);
    }
  }

  BLE.setDeviceName(PADDLE_BLE_NAME);
  paddleService.addCharacteristic(paddleInfo);
  paddleService.addCharacteristic(fsrData);
  paddleService.addCharacteristic(imuData);
  paddleInfo.writeValue(PADDLE_BLE_NAME);
  BLE.addService(paddleService);

  BLEAdvertisingData advData;
  advData.setAdvertisedService(paddleService);
  BLE.setAdvertisingData(advData);

  BLEAdvertisingData scanData;
  scanData.setLocalName(PADDLE_BLE_NAME);
  BLE.setScanResponseData(scanData);

  if (!BLE.advertise()) {
    while (1) {
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(200);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(200);
      digitalWrite(MOTOR_OUTPUT, HIGH);
      delay(200);
      digitalWrite(MOTOR_OUTPUT, LOW);
      delay(2000);
    }
  }

  multicore_launch_core1_with_stack(core1_entry, core1_stack,
                                    sizeof(core1_stack));

  triggerMotor(MOTOR_STARTUP_MS);

  watchdog_enable(WATCHDOG_TIMEOUT_MS, true);
}

void loop() {
  static uint32_t lastWatchdogCheck = 0;
  static uint32_t lastSeenHeartbeat = 0;
  if (millis() - lastWatchdogCheck >= WATCHDOG_CHECK_INTERVAL_MS) {
    lastWatchdogCheck = millis();
    uint32_t hb = g_core1Heartbeat;
    if (hb != lastSeenHeartbeat) {
      lastSeenHeartbeat = hb;
      watchdog_update();
    }
  }

  if (motorActive && (millis() - motorStartTime >= motorDurationMs)) {
    digitalWrite(MOTOR_OUTPUT, LOW);
    motorActive = false;
  }

  BLE.poll();

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

  int16_t imuPacket[6] = {
      quantizeImu(ax, IMU_ACCEL_SCALE), quantizeImu(ay, IMU_ACCEL_SCALE),
      quantizeImu(az, IMU_ACCEL_SCALE), quantizeImu(gx, IMU_GYRO_SCALE),
      quantizeImu(gy, IMU_GYRO_SCALE),  quantizeImu(gz, IMU_GYRO_SCALE)};
  imuData.writeValue((uint8_t *)imuPacket, sizeof(imuPacket));

  bool gotHit = multicore_fifo_rvalid();

  bool imuActive = (abs(ax) > ACCEL_THRESHOLD) || (abs(ay) > ACCEL_THRESHOLD) ||
                   (abs(gx) > GYRO_THRESHOLD) || (abs(gy) > GYRO_THRESHOLD) ||
                   (abs(gz) > GYRO_THRESHOLD);

  if (imuActive || gotHit) {
    while (multicore_fifo_rvalid()) {
      uint32_t packedData = multicore_fifo_pop_blocking();

      fsrData.writeValue((uint8_t *)&packedData, 4);

      int zoneNum = packedData >> 16;
      if (zoneNum == 1) {
        triggerMotor(MOTOR_HIT_MS);
      }
    }
  }
}
