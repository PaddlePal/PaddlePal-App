import { useCallback, useEffect, useRef } from 'react';
import { Buffer } from 'buffer';
import type { BleError, Characteristic, Subscription } from 'react-native-ble-plx';

import { useBluetooth } from '@/hooks/useBluetooth';
import { ImuSample } from '@/types';

// ── BLE identity (mirrors firmware/planB.ino) ─────────────────────────────────
// Service UUID matches PADDLE_SERVICE_UUID; the characteristic is the IMU
// notify stream added in planB.ino (the ...31 characteristic, next in sequence
// after ...30, which is reserved for session control).
const PADDLE_SERVICE_UUID = '9590ad2d-fd81-4688-9d3b-65ac36caca3a';
const IMU_CHAR_UUID = '9590ad31-fd81-4688-9d3b-65ac36caca3a';

/**
 * ⚠️ Must be the exact inverse of `IMU_ACCEL_SCALE` / `IMU_GYRO_SCALE` in
 * `firmware/planB.ino`. A mismatch produces samples that are subtly wrong with
 * no error anywhere — sanity-check a known-still paddle (≈0 g on X/Y, ≈1 g on
 * whichever axis is vertical, ≈0 deg/s on all three) after any firmware
 * rescale.
 */
const IMU_ACCEL_SCALE = 4096; // counts per g
const IMU_GYRO_SCALE = 16; // counts per deg/s

/**
 * How much history `getWindow` returns before a hit. A placeholder, not a
 * validated number — one line to change once real swings exist to look at
 * (no reflash: the firmware streams continuously and knows nothing about
 * windows).
 */
export const IMU_WINDOW_MS = 1000;

/**
 * Ring-buffer capacity, in samples. ~6.4s at the firmware's 20Hz tick — far
 * more than `IMU_WINDOW_MS` needs, as headroom against BLE delivery jitter
 * (notifications can bunch up and arrive in bursts rather than metronomically
 * every 50ms). Sizing by time rather than by sample count is what keeps a
 * jittery burst from quietly evicting the samples a window still needs.
 */
const IMU_BUFFER_SAMPLES = 128;

const IMU_PACKET_BYTES = 12;

interface UseImuBufferOptions {
  /**
   * Whether to subscribe to the IMU stream. Owned by the session lifecycle
   * (`useSession`), NOT global like `usePaddleData` — outside a session nobody
   * subscribes, and BLE notify semantics mean the firmware's unconditional
   * `writeValue()` calls put nothing on the air when no central has enabled
   * notifications for the characteristic.
   */
  active: boolean;
}

export interface UseImuBufferResult {
  /**
   * Trailing IMU samples for a hit: everything received in the
   * `IMU_WINDOW_MS` before `hitTs`, oldest first. Empty when nothing has
   * arrived yet (start of a session, or mid-reconnect).
   *
   * Timestamp-based rather than "the last N slots", so jittery delivery
   * shortens the sample count instead of silently shifting the window.
   * Identity-stable, so callers can hold it in an otherwise-empty dependency
   * array.
   */
  getWindow: (hitTs: number) => ImuSample[];
}

/**
 * Decodes one 12-byte IMU notify packet (base64) into a sample.
 *
 * The firmware writes six int16s little-endian (RP2040) in the order
 * ax, ay, az, gx, gy, gz, quantized by the scale factors above. Returns null
 * for a short/malformed frame.
 */
function decodeSample(value: string | null | undefined): ImuSample | null {
  if (!value) return null;
  const buf = Buffer.from(value, 'base64');
  if (buf.length < IMU_PACKET_BYTES) return null;

  return {
    ax: buf.readInt16LE(0) / IMU_ACCEL_SCALE,
    ay: buf.readInt16LE(2) / IMU_ACCEL_SCALE,
    az: buf.readInt16LE(4) / IMU_ACCEL_SCALE,
    gx: buf.readInt16LE(6) / IMU_GYRO_SCALE,
    gy: buf.readInt16LE(8) / IMU_GYRO_SCALE,
    gz: buf.readInt16LE(10) / IMU_GYRO_SCALE,
    ts: Date.now(),
  };
}

/**
 * Keeps a rolling in-memory window of the paddle's IMU stream so each recorded
 * hit can carry the swing that produced it.
 *
 * Samples live in a **ref**, never React state — this runs at ~20Hz for the
 * whole length of a session and must not re-render anything (same reason
 * `useSession` buffers its hits in `hitsRef`). Nothing here is persisted on its
 * own: only the per-hit slices `getWindow` returns ever reach Firestore.
 */
export function useImuBuffer({ active }: UseImuBufferOptions): UseImuBufferResult {
  const { connectedDevice } = useBluetooth();

  // Fixed-size ring: `writeIndex` only ever grows, so slot i holds the sample
  // written at index i % IMU_BUFFER_SAMPLES. No allocation per sample.
  const bufferRef = useRef<(ImuSample | null)[]>(
    new Array<ImuSample | null>(IMU_BUFFER_SAMPLES).fill(null),
  );
  const writeIndexRef = useRef(0);

  const getWindow = useCallback((hitTs: number): ImuSample[] => {
    const buf = bufferRef.current;
    const writeIndex = writeIndexRef.current;
    const count = Math.min(writeIndex, IMU_BUFFER_SAMPLES);
    const oldestAllowed = hitTs - IMU_WINDOW_MS;

    // Walk backwards from the newest sample. Receipt timestamps are monotonic,
    // so the first one older than the window means every earlier one is too.
    const window: ImuSample[] = [];
    for (let i = 0; i < count; i++) {
      const sample = buf[(writeIndex - 1 - i) % IMU_BUFFER_SAMPLES];
      if (!sample) break;
      if (sample.ts <= oldestAllowed) break;
      // Defensive: a sample newer than the hit isn't part of its *trailing*
      // window. Can't normally happen — this is called synchronously from the
      // hit callback — so skip rather than stop.
      if (sample.ts > hitTs) continue;
      window.push(sample);
    }

    return window.reverse(); // oldest first
  }, []);

  useEffect(() => {
    if (!active) return;

    const device = connectedDevice?.raw;
    if (!device) return;

    // Fresh subscription → fresh buffer. Anything held from before a reconnect
    // describes a different stretch of time and shouldn't leak into the first
    // window after it.
    bufferRef.current.fill(null);
    writeIndexRef.current = 0;

    let subscription: Subscription | null = null;
    try {
      // Services/characteristics were already discovered at connect time
      // (see useBluetooth.connectToDevice → discoverAllServicesAndCharacteristics).
      subscription = device.monitorCharacteristicForService(
        PADDLE_SERVICE_UUID,
        IMU_CHAR_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            // Fires on disconnect and on Fast Refresh teardown — the session's
            // FSR recording is unaffected, so this is a warning, not a failure.
            console.warn('[Paddle] IMU monitor error:', error.message);
            return;
          }

          const sample = decodeSample(characteristic?.value);
          if (!sample) return;

          bufferRef.current[writeIndexRef.current % IMU_BUFFER_SAMPLES] = sample;
          writeIndexRef.current += 1;
        },
      );
    } catch (err) {
      console.warn('[Paddle] Failed to start IMU monitor:', err);
    }

    return () => {
      subscription?.remove();
    };
  }, [active, connectedDevice]);

  return { getWindow };
}
