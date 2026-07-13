import { Session } from '@/types';
import mockData from './mockSessions.json';

/**
 * Session data service.
 *
 * Currently backed by a local JSON fixture standing in for the Firestore
 * `sessions` collection. When real data lands, replace the bodies of these
 * functions with Firestore queries (e.g. `getDocs(query(collection(...)))`) —
 * the async signatures are already shaped for that so callers don't change.
 */

// The JSON's string/number literals don't narrow to our union types, so cast
// once here at the data boundary (this is exactly where Firestore parsing will
// eventually live).
const MOCK_SESSIONS = mockData as unknown as Session[];

const SIMULATED_LATENCY_MS = 300;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** List sessions, newest first (mirrors `orderBy('startedAt', 'desc')`). */
export async function getSessions(): Promise<Session[]> {
  await delay(SIMULATED_LATENCY_MS);
  return [...MOCK_SESSIONS].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}

/** Fetch a single session by id, or null if not found. */
export async function getSessionById(id: string): Promise<Session | null> {
  await delay(SIMULATED_LATENCY_MS);
  return MOCK_SESSIONS.find((session) => session.id === id) ?? null;
}
