import { useCallback, useRef, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { useBluetooth } from '@/hooks/useBluetooth';
import { useImuBuffer } from '@/hooks/useImuBuffer';
import { usePaddleData, PaddleHit } from '@/hooks/usePaddleData';
import {
  startSession as createSessionDoc,
  endSession as completeSessionDoc,
} from '@/lib/sessions';
import { RawHit } from '@/types';

export type SessionState = 'idle' | 'active';

export interface UseSessionResult {
  /** Whether a session is currently recording. */
  sessionState: SessionState;
  /** Live count of buffered hits (for the dashboard while active). */
  hitCount: number;
  /** Client start time (ms epoch) of the active session, or null when idle. */
  startedAtMs: number | null;
  /** True while a start/end Firestore write is in flight. */
  busy: boolean;
  /** Begin a session: create the Firestore doc, then start buffering hits. */
  startSession: () => Promise<void>;
  /** End a session: flush the buffered hits to Firestore in a single write. */
  endSession: () => Promise<void>;
}

/**
 * Owns the live session *recording* lifecycle: start/end plus the in-memory FSR
 * hit buffer flushed to Firestore in one write when the session ends.
 *
 * Distinct from `useSession(id)` in `@/hooks/useSessions`, which loads a stored
 * session for display. Buffering taps the existing `usePaddleData` BLE monitor
 * through its `onHit` callback rather than opening a second subscription.
 */
export function useSession(): UseSessionResult {
  const { user } = useAuth();
  const { writeSessionState } = useBluetooth();

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [hitCount, setHitCount] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Refs mirror the pieces the BLE callback and re-entrancy guards read
  // synchronously (state updates are async and would race).
  const stateRef = useRef<SessionState>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const startedAtMsRef = useRef<number>(0);
  const hitsRef = useRef<RawHit[]>([]);
  const busyRef = useRef(false);

  // Trailing IMU window for each hit. This hook owns that subscription's
  // lifecycle: it starts when `sessionState` flips to 'active' (in
  // startSession) and stops when it flips back (first thing endSession does),
  // so nothing is subscribed — and per BLE notify semantics nothing is
  // transmitted — outside a session.
  const { getWindow } = useImuBuffer({ active: sessionState === 'active' });

  // Buffer every decoded hit while active. Stable identity (getWindow is
  // itself identity-stable) so usePaddleData never resubscribes the BLE monitor
  // because of this callback.
  const bufferHit = useCallback(
    (hit: PaddleHit) => {
      if (stateRef.current !== 'active') return;

      const rawHit: RawHit = {
        zone: hit.zone,
        payload: hit.payload,
        offsetMs: hit.ts - startedAtMsRef.current,
      };

      // Cheap array snapshot on the hot BLE path — no classification here. That
      // runs once per session, on-device, inside endSession's metrics pass
      // (future task). Key omitted rather than set to undefined when empty:
      // Firestore rejects explicit undefined values.
      const imuWindow = getWindow(hit.ts);
      if (imuWindow.length > 0) rawHit.imuWindow = imuWindow;

      hitsRef.current.push(rawHit);
      setHitCount(hitsRef.current.length);
    },
    [getWindow],
  );

  usePaddleData({ onHit: bufferHit });

  const startSession = useCallback(async () => {
    if (!user || stateRef.current === 'active' || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const now = Date.now();
      hitsRef.current = [];
      startedAtMsRef.current = now;

      const id = await createSessionDoc(user.uid);

      sessionIdRef.current = id;
      stateRef.current = 'active';
      setStartedAtMs(now);
      setHitCount(0);
      setSessionState('active');

      // Best-effort — no-ops on today's firmware, never throws.
      void writeSessionState(true);
    } catch (err) {
      console.warn('[useSession] Failed to start session:', err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [user, writeSessionState]);

  const endSession = useCallback(async () => {
    if (stateRef.current !== 'active' || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    // Stop buffering immediately so no hit lands mid-flush, and reflect the
    // ended state in the UI right away (the `busy` flag covers the save).
    stateRef.current = 'idle';
    setSessionState('idle');
    setStartedAtMs(null);

    const id = sessionIdRef.current;
    const hits = hitsRef.current;
    const startedAt = startedAtMsRef.current;
    try {
      if (id) {
        await completeSessionDoc(id, hits, startedAt);
      }
      void writeSessionState(false);
    } catch (err) {
      console.warn('[useSession] Failed to end session:', err);
    } finally {
      hitsRef.current = [];
      sessionIdRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }, [writeSessionState]);

  return {
    sessionState,
    hitCount,
    startedAtMs,
    busy,
    startSession,
    endSession,
  };
}
