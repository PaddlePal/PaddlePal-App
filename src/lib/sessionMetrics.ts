import {
  PowerLevel,
  RawHit,
  SessionMetrics,
  ShotType,
  ShotTypeStat,
  ZoneId,
  ZoneStat,
} from '@/types';
import { classifyShot, SHOT_TYPES } from './shotClassifier';

/**
 * Pure session-metrics computation.
 *
 * Runs on-device when a session ends (see `endSession` in `./sessions`). Kept
 * dependency-free and side-effect-free so it's trivial to unit-test and retune.
 */

const ALL_ZONES: readonly ZoneId[] = [1, 2, 3, 4, 5];

/**
 * ⚠️ PLACEHOLDER power bucketing — same spirit as the "avg power as one
 * session-wide category" assumption already flagged in progress.md. We bucket
 * the mean FSR payload into quartiles of the 0–1023 range. These cutoffs are a
 * reasonable first guess; retune once real hit data exists.
 *
 * Note: zone-5 payloads are a packed A2/A3 pair (see usePaddleData), not a
 * single force reading, so each payload is clamped to 0–1023 below to keep a
 * stray packed value from skewing the average. Revisit when zone-5 semantics
 * are finalized on hardware.
 */
const POWER_CUTOFFS: readonly { belowOrEqual: number; level: PowerLevel }[] = [
  { belowOrEqual: 500, level: 'low' },
  { belowOrEqual: 799, level: 'medium' },
  { belowOrEqual: 900, level: 'high' },
  { belowOrEqual: 1023, level: 'super' },
];

function clampPayload(payload: number): number {
  if (payload < 0) return 0;
  if (payload > 1023) return 1023;
  return payload;
}

function computeAvgPower(rawHits: RawHit[]): PowerLevel {
  if (rawHits.length === 0) return 'low';
  const sum = rawHits.reduce((acc, hit) => acc + clampPayload(hit.payload), 0);
  const avg = sum / rawHits.length;
  return POWER_CUTOFFS.find((c) => avg <= c.belowOrEqual)?.level ?? 'super';
}

/**
 * Compute the metrics shown on the session detail screen from the raw hit
 * buffer.
 *
 * `zones` and `shotTypes` always contain exactly 5 entries each, zero-filled
 * for any bucket with no hits — the bar charts in sessions/[id].tsx map those
 * arrays directly with no zero-padding of their own, so a short array would
 * silently render fewer bars.
 *
 * `startedAtMs` is the session's client start time, the same value `useSession`
 * subtracts to produce each hit's `offsetMs`. Adding it back gives the hit's
 * absolute timestamp, which is the clock its `imuWindow` samples are keyed on —
 * the classifier needs both on the same clock to measure a windup.
 */
export function computeSessionMetrics(
  rawHits: RawHit[],
  startedAtMs: number,
): SessionMetrics {
  const counts: Record<ZoneId, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const shotCounts: Record<ShotType, number> = {
    drive: 0,
    drop: 0,
    dink: 0,
    overhead: 0,
    rally: 0,
  };

  for (const hit of rawHits) {
    if (hit.zone in counts) counts[hit.zone] += 1;
    shotCounts[classifyShot(hit, startedAtMs + hit.offsetMs)] += 1;
  }

  const zones: ZoneStat[] = ALL_ZONES.map((zone) => ({
    zone,
    shots: counts[zone],
  }));

  const shotTypes: ShotTypeStat[] = SHOT_TYPES.map((type) => ({
    type,
    shots: shotCounts[type],
  }));

  return {
    totalShots: rawHits.length,
    avgPower: computeAvgPower(rawHits),
    zones,
    shotTypes,
  };
}
