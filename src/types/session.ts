/**
 * Session domain types.
 *
 * Shaped to mirror the planned Firestore `sessions/{sessionId}` document
 * (see memory-bank/PLAN-live-demo-and-game-pipeline.md) so the local mock in
 * `src/lib/sessions.ts` can be swapped for real Firestore reads without
 * touching the hooks or screens that consume these types.
 */

/**
 * Firmware FSR zones. Four, one per sensor group — A0/A1/A2/A3.
 *
 * ⚠️ Zone 5 (the old "A2 and A3 fired together" composite) was removed from the
 * firmware on 2026-08-06; zones 3 and 4 now open, close, and report
 * independently. Sessions recorded before that reflash still contain zone-5
 * hits in Firestore and a five-entry `metrics.zones` array. Those documents are
 * read back with a cast and are deliberately NOT rewritten — the hits really
 * happened — so a legacy `ZoneStat.zone` can hold a 5 this type says is
 * impossible. Only the zone-bar label path consumes it (see `ZONE_LABELS` in
 * `sessions/[id].tsx`, which falls back to `Z${zone}`); nothing branches on it.
 */
export type ZoneId = 1 | 2 | 3 | 4;

export type PowerLevel = 'low' | 'medium' | 'high' | 'super';

export type SessionStatus = 'active' | 'ended' | 'processing' | 'complete';

/** Per-zone shot tally for the shots-per-zone breakdown. */
export interface ZoneStat {
  zone: ZoneId;
  shots: number;
}

/**
 * Shot classes the rule-based classifier can emit (`src/lib/shotClassifier.ts`).
 *
 * `rally` is the catch-all for anything that doesn't match a real signature —
 * including hits with no IMU window to judge by. Volley is deliberately absent:
 * it's defined by the ball not bouncing first, which nothing on the paddle can
 * detect.
 */
export type ShotType = 'drive' | 'drop' | 'dink' | 'overhead' | 'rally';

/** Per-shot-type tally, same shape as `ZoneStat`. */
export interface ShotTypeStat {
  type: ShotType;
  shots: number;
}

/**
 * One decoded IMU reading from the paddle's ~20Hz notify stream, dequantized to
 * real units (see `src/hooks/useImuBuffer.ts`).
 *
 * Only ever persisted as the trailing window attached to a `RawHit` — the
 * continuous stream itself is never stored.
 */
export interface ImuSample {
  /** Acceleration in g. */
  ax: number;
  ay: number;
  az: number;
  /** Angular velocity in degrees/second. */
  gx: number;
  gy: number;
  gz: number;
  /**
   * App-side receipt timestamp (ms epoch) — the same clock as `PaddleHit.ts`
   * in `src/hooks/usePaddleData.ts`, which is what makes windowing a hit
   * against this stream valid. Absolute, unlike `RawHit.offsetMs`.
   */
  ts: number;
}

/**
 * A single buffered FSR hit, recorded client-side during an active session and
 * flushed to Firestore in one write when the session ends (`sessions.rawHits`).
 */
export interface RawHit {
  zone: ZoneId;
  /** Peak FSR force from the BLE packet, 0–1023. */
  payload: number;
  /** Hit timestamp minus session start timestamp, in ms (client clock). */
  offsetMs: number;
  /**
   * Trailing IMU window leading up to this hit — the ~1s of samples before
   * `ts`, snapshotted from `useImuBuffer` at hit time. Input data for the
   * future shot classifier (drive / drop / dink / volley / overhead / rally);
   * nothing reads it yet.
   *
   * Absent (key omitted, never `undefined`) when the window came back empty —
   * a hit in the first moments of a session, or one that lands while the
   * paddle is mid-reconnect. Firestore rejects explicit `undefined`.
   */
  imuWindow?: ImuSample[];
}

/** Backend-computed session metrics (empty until processing completes). */
export interface SessionMetrics {
  totalShots: number;
  /** Average power per shot as a category, not a raw number. */
  avgPower: PowerLevel;
  zones: ZoneStat[];
  /**
   * Shot-type tally. Always exactly 5 entries, zero-filled, in the fixed
   * display order [drive, drop, dink, overhead, rally] — same contract as
   * `zones`, and for the same reason: the chart maps the array directly, so a
   * short array would silently render fewer bars.
   *
   * Sessions recorded before shot classification existed have no `shotTypes`
   * field in Firestore; `mapSession` in `lib/sessions.ts` zero-fills them on
   * read so this stays non-optional for every consumer.
   */
  shotTypes: ShotTypeStat[];
}

/** A single training/match session. */
export interface Session {
  id: string;
  userId: string;
  status: SessionStatus;
  /** ISO 8601 string. In production this is a Firestore Timestamp. */
  startedAt: string;
  /** ISO 8601 string. In production this is a Firestore Timestamp. */
  endedAt: string;
  durationSec: number;
  /** Populated by the backend once processing completes; null otherwise. */
  metrics: SessionMetrics | null;
}
