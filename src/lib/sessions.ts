import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

import { firestore } from './firebase';
import { computeSessionMetrics } from './sessionMetrics';
import { RawHit, Session, SessionMetrics, SessionStatus } from '@/types';

/**
 * Session data service — real Firestore persistence.
 *
 * Backend processing is on-device, permanently (see memory-bank/progress.md, 2026-07-13):
 * FSR metrics are cheap arithmetic, computed here at session end and written in
 * a single doc write. Uses the modular Firestore API to match src/lib/firestore.ts
 * (do not reintroduce the deprecated namespaced API — see bugs.md "Bug 2").
 *
 * Firestore doc: top-level `sessions/{sessionId}` with a `userId` field.
 */

const SESSIONS = 'sessions';

/** Shape of a `sessions/{id}` document as stored in Firestore. */
interface SessionDoc {
  userId: string;
  status: SessionStatus;
  startedAt: FirebaseFirestoreTypes.Timestamp | null;
  endedAt: FirebaseFirestoreTypes.Timestamp | null;
  durationSec: number | null;
  rawHits: RawHit[];
  metrics: SessionMetrics | null;
}

/** Firestore Timestamp → ISO 8601 string (the `Session` view-model shape). */
function tsToIso(value: FirebaseFirestoreTypes.Timestamp | null): string {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return '';
}

/** Map a stored document to the `Session` type the screens consume. */
function mapSession(id: string, data: SessionDoc): Session {
  return {
    id,
    userId: data.userId,
    status: data.status,
    startedAt: tsToIso(data.startedAt),
    endedAt: tsToIso(data.endedAt),
    durationSec: data.durationSec ?? 0,
    metrics: data.metrics ?? null,
  };
}

/**
 * Create a new active session and return its id.
 *
 * `startedAt` is a server timestamp (for display/ordering); the client-side
 * `startedAtMs` used for offsets/duration is tracked by the caller (useSession).
 */
export async function startSession(userId: string): Promise<string> {
  const docRef = await addDoc(collection(firestore, SESSIONS), {
    userId,
    status: 'active',
    startedAt: serverTimestamp(),
    endedAt: null,
    durationSec: null,
    rawHits: [],
    metrics: null,
  });
  return docRef.id;
}

/**
 * End a session in a single write: compute duration + metrics synchronously,
 * flush the buffered hits, and mark the doc `complete`.
 *
 * No intermediate `ended`/`processing` state — nothing watches for it and one
 * write removes the stuck-session failure mode entirely. This pass only ever
 * emits `active` then `complete`.
 */
export async function endSession(
  sessionId: string,
  rawHits: RawHit[],
  startedAtMs: number,
): Promise<void> {
  const durationSec = Math.round((Date.now() - startedAtMs) / 1000);
  const metrics = computeSessionMetrics(rawHits);

  await updateDoc(doc(firestore, SESSIONS, sessionId), {
    status: 'complete',
    endedAt: serverTimestamp(),
    durationSec,
    rawHits,
    metrics,
  });
}

/**
 * List a user's sessions, newest first (one-shot read).
 *
 * The History list drives its own refresh (pull-to-refresh + a header button)
 * rather than a live listener — see useSessions.ts for why.
 *
 * ⚠️ The where('userId','==',uid) + orderBy('startedAt','desc') shape needs a
 * composite index (firestore.indexes.json). The first run before the index
 * builds throws a "query requires an index" error with a console link — that's
 * expected, not a rules bug.
 */
export async function getSessions(uid: string): Promise<Session[]> {
  const q = query(
    collection(firestore, SESSIONS),
    where('userId', '==', uid),
    orderBy('startedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapSession(d.id, d.data() as SessionDoc));
}

/** Fetch a single session by id, or null if it doesn't exist. */
export async function getSessionById(id: string): Promise<Session | null> {
  const snap = await getDoc(doc(firestore, SESSIONS, id));
  if (!snap.exists()) return null;
  return mapSession(snap.id, snap.data() as SessionDoc);
}
