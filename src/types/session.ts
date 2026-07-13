/**
 * Session domain types.
 *
 * Shaped to mirror the planned Firestore `sessions/{sessionId}` document
 * (see memory-bank/PLAN-live-demo-and-game-pipeline.md) so the local mock in
 * `src/lib/sessions.ts` can be swapped for real Firestore reads without
 * touching the hooks or screens that consume these types.
 */

export type ZoneId = 1 | 2 | 3 | 4 | 5;

export type PowerLevel = 'low' | 'medium' | 'high' | 'super';

export type SessionStatus = 'active' | 'ended' | 'processing' | 'complete';

/** Per-zone shot tally for the shots-per-zone breakdown. */
export interface ZoneStat {
  zone: ZoneId;
  shots: number;
}

/**
 * A single buffered FSR hit, recorded client-side during an active session and
 * flushed to Firestore in one write when the session ends (`sessions.rawHits`).
 */
export interface RawHit {
  zone: ZoneId;
  /** Raw FSR value from the BLE packet (0–1023 for zones 1–4). */
  payload: number;
  /** Hit timestamp minus session start timestamp, in ms (client clock). */
  offsetMs: number;
}

/** Backend-computed session metrics (empty until processing completes). */
export interface SessionMetrics {
  totalShots: number;
  /** Average power per shot as a category, not a raw number. */
  avgPower: PowerLevel;
  zones: ZoneStat[];
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
