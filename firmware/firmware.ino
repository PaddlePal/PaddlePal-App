#include <Arduino_LSM6DSOX.h>

#define FSR_THRESHOLD 150
#define ACCEL_THRESHOLD 0.05f
#define GYRO_THRESHOLD 1.0f

// Helper function to pack data and send to Core 1 via FIFO
// Zone number goes into upper 16 bits, FSR value goes into lower 16 bits
// For Zone 5: upper 16 bits = 5, lower 16 bits contains A2 (upper 8) and A3
// (lower 8)
void sendFSRPacket(int zoneNumber, int fsrVal) {
  uint32_t packedData = ((uint32_t)zoneNumber << 16) | (fsrVal & 0xFFFF);
  rp2040.fifo.push_nb(packedData);
}

// ─────────────────────────────────────────────
//  CORE 0 — Lightning-fast polling of native pins
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  while (!Serial)
    ;

  // Initialize native RP2040 ADC pins
  pinMode(A0, INPUT);
  pinMode(A1, INPUT);
  pinMode(A2, INPUT);
  pinMode(A3, INPUT);

  Serial.println("=== 5-Zone Native FSR + IMU Ready ===");
}

void loop() {
  // Read all 4 native pins
  int v1 = analogRead(A0);
  int v2 = analogRead(A1);
  int v3 = analogRead(A3);
  int v4 = analogRead(A2);

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

// ─────────────────────────────────────────────
//  CORE 1 — IMU processing + Terminal Output
// ─────────────────────────────────────────────
void setup1() {
  if (!IMU.begin()) {
    pinMode(LED_BUILTIN, OUTPUT);
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
    }
  }
}

void loop1() {
  float ax = 0, ay = 0, az = 0;
  float gx = 0, gy = 0, gz = 0;

  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(ax, ay, az);
  }
  if (IMU.gyroscopeAvailable()) {
    IMU.readGyroscope(gx, gy, gz);
  }

  // Check if any FSR data is waiting in the FIFO queue
  bool gotHit = rp2040.fifo.available();

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
    while (rp2040.fifo.available()) {
      uint32_t packedData = rp2040.fifo.pop();

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

  delay(50);
}