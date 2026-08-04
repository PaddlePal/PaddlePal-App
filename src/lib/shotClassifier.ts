import { ImuSample, RawHit, ShotType } from '@/types';

/**
 * Rule-based shot classification.
 *
 * Runs on-device when a session ends (see `computeSessionMetrics`). Pure,
 * dependency-free and side-effect-free — same discipline as `sessionMetrics.ts`
 * and for the same reason: trivial to unit-test and to retune.
 *
 * Deliberately a decision cascade, not a trained model and not independent
 * per-class rules. The cascade is what makes it **tie-free by construction** —
 * evaluation stops at the first match, so there is structurally nothing for two
 * classes to disagree about. Order only decides which class an ambiguous
 * signature falls into, never whether two can both fire.
 *
 * Four features, all derived from data already on every `RawHit`: peak gyro
 * magnitude (swing speed), force (power), windup duration, and zone (contact
 * point). Paddle face / shot angle is deliberately out of scope — the LSM6DSOX
 * has no magnetometer, so absolute orientation isn't measurable, and
 * gyro-integrated relative rotation is real work for the least-confident
 * feature.
 */

/**
 * ⚠️ PLACEHOLDER thresholds — starting guesses, not measurements. The whole
 * point of keeping them here as named constants is that retuning against real
 * recorded swings is a one-line edit per value. Expect to change all of them.
 */
const GYRO_HIGH_DPS = 300;
const GYRO_LOW_DPS = 150;
const FORCE_HIGH = 800; // raw FSR scale, 0–1023
const FORCE_LOW = 799;
const WINDUP_LARGE_MS = 300;
const WINDUP_SHORT_MS = 200;
/**
 * A separate, much lower bar than `GYRO_LOW_DPS`: not "was this a soft swing"
 * but "is the paddle moving at all". Used only to find where a windup starts.
 */
const ACTIVITY_FLOOR_DPS = 40;

/** Fixed display order — mirrored by `SessionMetrics.shotTypes` and the UI. */
export const SHOT_TYPES: readonly ShotType[] = [
  'drive',
  'drop',
  'dink',
  'overhead',
  'rally',
];

/** Total angular rate, in deg/s, regardless of axis. */
function gyroMagnitude(sample: ImuSample): number {
  return Math.sqrt(sample.gx ** 2 + sample.gy ** 2 + sample.gz ** 2);
}

/**
 * Fastest the paddle was rotating anywhere in the window — the "swing speed"
 * feature. 0 for an empty window.
 */
export function computePeakGyroMag(window: ImuSample[]): number {
  let peak = 0;
  for (const sample of window) {
    const mag = gyroMagnitude(sample);
    if (mag > peak) peak = mag;
  }
  return peak;
}

/**
 * How long the paddle had been swinging before contact, in ms.
 *
 * `window` is oldest-first (`useImuBuffer.getWindow`'s contract). Walks
 * newest → oldest for the last sample where the paddle was still quiet; the
 * windup is everything after it.
 */
export function computeWindupMs(window: ImuSample[], hitTs: number): number {
  if (window.length === 0) return 0;

  for (let i = window.length - 1; i >= 0; i--) {
    if (gyroMagnitude(window[i]) < ACTIVITY_FLOOR_DPS) {
      // When the quiet sample IS the newest one, the paddle was still at
      // contact time: no detectable windup at all.
      if (i === window.length - 1) return 0;
      return Math.max(hitTs - window[i].ts, 0);
    }
  }

  // Never dropped below the floor anywhere in the window — the swing began
  // before the window opens, so the most that can be said is "at least this
  // long". A longer IMU_WINDOW_MS is the only way to see further back.
  return Math.max(hitTs - window[0].ts, 0);
}

/**
 * Contact force on the 0–1023 FSR scale.
 *
 * Zones 1–4 store it directly. **Zone 5 does not** — its payload is a packed
 * A2/A3 pair (upper byte / lower byte, each scaled down by 4 in the firmware),
 * so reading it as a force gives a value up to 65535. Left raw it would push
 * every zone-5 hit past `FORCE_HIGH`, which matters here because zone 5 is
 * exactly where Overhead lives. Unpacked to the harder of the two contacts.
 */
function hitForce(hit: RawHit): number {
  if (hit.zone !== 5) return hit.payload;
  const a2 = (hit.payload >> 8) << 2; // restores 0–255 to the 0–1020 range
  const a3 = (hit.payload & 0xff) << 2;
  return Math.max(a2, a3);
}

/**
 * Classify one hit.
 *
 * `hitTs` is the hit's **absolute** receipt timestamp — the same clock the
 * `imuWindow` samples are keyed on. `RawHit` only stores `offsetMs` (relative
 * to session start), so callers reconstruct it as `startedAtMs + offsetMs`,
 * which is exact: `useSession` derives `offsetMs` from that same start value.
 * (Using the window's last sample's `ts` instead would be systematically short
 * by up to one BLE tick, biasing every windup measurement downward.)
 *
 * Cascade order is Overhead → Drive → Dink → Drop → Rally: most distinctive
 * signature first (Overhead's zone-5 contact plus a big windup is the hardest
 * to fake), most ambiguous last (Drop is the "everything in between" shot, so
 * sitting right before the Rally fallback means it only catches what survived
 * the sharper checks above).
 */
export function classifyShot(hit: RawHit, hitTs: number): ShotType {
  const window = hit.imuWindow;
  // No motion data → nothing to judge by. Happens for hits in the first moments
  // of a session, or during a paddle reconnect.
  if (!window || window.length === 0) return 'rally';

  const peak = computePeakGyroMag(window);
  const windup = computeWindupMs(window, hitTs);
  const force = hitForce(hit);

  if (hit.zone === 5 && peak >= GYRO_HIGH_DPS && windup >= WINDUP_LARGE_MS) {
    return 'overhead';
  }
  if (hit.zone == 1 && peak >= GYRO_HIGH_DPS && force >= FORCE_HIGH) {
    return 'drive';
  }
  if (peak <= GYRO_LOW_DPS && force <= FORCE_LOW && windup <= WINDUP_SHORT_MS) {
    return 'dink';
  }
  if (peak < GYRO_HIGH_DPS && force < FORCE_LOW) {
    return 'drop';
  }
  return 'rally';
}
