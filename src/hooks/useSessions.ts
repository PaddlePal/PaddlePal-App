import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { getSessions, getSessionById } from '@/lib/sessions';
import { Session } from '@/types';

/**
 * Read hooks for stored session history.
 *
 * NOTE: `useSession(id)` here is the single-session *loader* for the History
 * detail screen. It is distinct from `useSession()` in `@/hooks/useSession`,
 * which owns the live start/end *recording* lifecycle.
 */

export interface UseSessionsResult {
  sessions: Session[];
  /** True during the initial load. */
  loading: boolean;
  /** True while a manual refresh is in flight. */
  refreshing: boolean;
  /** Re-read the list (wired to the header button + pull-to-refresh). */
  refresh: () => void;
}

/**
 * Load the current user's sessions, newest first.
 *
 * Uses a one-shot read plus an explicit `refresh()` rather than a live
 * `onSnapshot` listener: on-device the snapshot updates didn't arrive (the list
 * stayed stale until an app restart), and a manual refresh is a deterministic
 * fit for this project's scope. A refresh keeps the current list on a transient
 * error instead of clearing it.
 */
export function useSessions(): UseSessionsResult {
  const { user } = useAuth();
  const uid = user?.uid;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Returns the sessions, or null on error (so callers can distinguish an empty
  // result from a failure). The first run before the composite index finishes
  // building fails here (see firestore.indexes.json) — fail soft, don't crash.
  const fetchSessions = useCallback(async (): Promise<Session[] | null> => {
    if (!uid) return [];
    try {
      return await getSessions(uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[useSessions] Failed to load sessions:', message);
      return null;
    }
  }, [uid]);

  // Initial load, and reload whenever the signed-in user changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSessions().then((data) => {
      if (!active) return;
      setSessions(data ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchSessions]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchSessions().then((data) => {
      // Keep the current list on error (null); otherwise replace it.
      if (data !== null) setSessions(data);
      setRefreshing(false);
    });
  }, [fetchSessions]);

  return { sessions, loading, refreshing, refresh };
}

/** Load a single session by id, or null if not found. */
export function useSession(id: string | undefined): {
  session: Session | null;
  loading: boolean;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setSession(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getSessionById(id)
      .then((data) => {
        if (!active) return;
        setSession(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('[useSession] Failed to load session:', err?.message ?? err);
        setSession(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  return { session, loading };
}
