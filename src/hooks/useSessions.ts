import { useEffect, useState } from 'react';

import { getSessions, getSessionById } from '@/lib/sessions';
import { Session } from '@/types';

/** Load the list of sessions. */
export function useSessions(): { sessions: Session[]; loading: boolean } {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSessions().then((data) => {
      if (!active) return;
      setSessions(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { sessions, loading };
}

/** Load a single session by id. */
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
    getSessionById(id).then((data) => {
      if (!active) return;
      setSession(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  return { session, loading };
}
