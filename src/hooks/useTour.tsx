import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'expo-router';

import {
  TOUR_AUTO_CONNECT_SOURCE,
  TOUR_STEPS,
  type TourAction,
  type TourStep,
  type TourTargetId,
} from '@/constants/tourSteps';
import { useBluetooth } from '@/hooks/useBluetooth';

/** Window-space box of a spotlit element, as reported by `measureInWindow`. */
export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourContextValue {
  /** True while the tour owns the screen. */
  isActive: boolean;
  /** 0-based index of the current step. */
  stepIndex: number;
  /** The current step, or null when the tour isn't running. */
  step: TourStep | null;
  totalSteps: number;
  /** Target the current step wants spotlit (null when inactive). */
  activeTargetId: TourTargetId | null;
  /**
   * Measured box of the active target, or null when we don't have a fresh one
   * yet (e.g. the step just crossed tabs and the new screen hasn't laid out).
   * The overlay dims with no cutout in that case rather than cutting a hole at
   * the previous screen's coordinates.
   */
  targetRect: TargetRect | null;
  /** Begin the tour at step 1. No-ops if it has already run this session. */
  start: () => void;
  /** Advance one step, switching tabs when the next step lives elsewhere. */
  next: () => void;
  /** End the tour and hand the app back to the user. */
  finish: () => void;
  /** Called by <TourTarget> with its window-space box. */
  reportTarget: (id: TourTargetId, rect: TargetRect) => void;
  /**
   * Report that a real action just happened. Advances the tour if — and only
   * if — the current step was waiting on that action, so callers can fire it
   * on any state change without tracking where the tour is.
   */
  notifyAction: (action: TourAction) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/** Sub-pixel jitter shouldn't push a state update through the whole tree. */
function sameRect(a: TargetRect, b: TargetRect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Owns the in-context onboarding tour: which step we're on, where each
 * spotlit element is, and the cross-tab navigation between steps.
 *
 * Deliberately has no `skip()` — a new user completes the tour or force-quits
 * (`onboarded` is already true by the time it runs, so it doesn't replay; a
 * demo re-run means flipping that flag back in the Firebase console). See
 * memory-bank/PLAN-onboarding-tour.md.
 */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setAutoConnectEnabled } = useBluetooth();

  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rects, setRects] = useState<Partial<Record<TourTargetId, TargetRect>>>({});
  /** One run per app session — a finished tour can't be restarted by a remount. */
  const hasStartedRef = useRef(false);

  const step = isActive ? TOUR_STEPS[stepIndex] ?? null : null;
  const activeTargetId = step?.targetId ?? null;
  const targetRect = (activeTargetId && rects[activeTargetId]) || null;

  const reportTarget = useCallback((id: TourTargetId, rect: TargetRect) => {
    setRects((prev) => {
      const current = prev[id];
      if (current && sameRect(current, rect)) return prev;
      return { ...prev, [id]: rect };
    });
  }, []);

  const start = useCallback(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setRects({});
    setStepIndex(0);
    setIsActive(true);
  }, []);

  const finish = useCallback(() => {
    setIsActive(false);
    setStepIndex(0);
    setRects({});
    // The last step is on Settings; hand the app back where it starts.
    router.navigate('/(tabs)/dashboard');
  }, [router]);

  const next = useCallback(() => {
    const current = TOUR_STEPS[stepIndex];
    const upcoming = TOUR_STEPS[stepIndex + 1];

    if (!current || !upcoming) {
      finish();
      return;
    }

    if (upcoming.route !== current.route) {
      // Drop anything we hold for the incoming target so the overlay can't
      // spotlight stale coordinates while the new tab lays itself out. Its
      // <TourTarget> re-measures as soon as it becomes the active target.
      setRects((prev) => {
        const pruned = { ...prev };
        delete pruned[upcoming.targetId];
        return pruned;
      });
      router.navigate(upcoming.route);
    }

    setStepIndex(stepIndex + 1);
  }, [finish, router, stepIndex]);

  // Late-bound current step + advance, so `notifyAction` can stay identity-
  // stable ([] deps). Callers put it in effect dependency arrays; if it changed
  // on every step those effects would re-fire and re-report state that hadn't
  // actually changed.
  const stepRef = useRef<TourStep | null>(null);
  const nextRef = useRef(next);
  useEffect(() => {
    stepRef.current = step;
    nextRef.current = next;
  }, [step, next]);

  const notifyAction = useCallback((action: TourAction) => {
    const current = stepRef.current;
    if (!current || current.requiresAction !== action) return;
    nextRef.current();
  }, []);

  // ── BLE auto-connect gate ────────────────────────────────────
  // The welcome screen claims this same source *before* flipping `onboarded`,
  // so there is no window between the Auth Gate releasing its own hold and the
  // tour taking over. Which is why this deliberately does NOT release on mount
  // — only once a tour that actually ran has ended.
  useEffect(() => {
    if (isActive) {
      setAutoConnectEnabled(false, TOUR_AUTO_CONNECT_SOURCE);
      return;
    }
    if (hasStartedRef.current) {
      setAutoConnectEnabled(true, TOUR_AUTO_CONNECT_SOURCE);
    }
  }, [isActive, setAutoConnectEnabled]);

  // Never leave the radio gated off because the tabs tree went away mid-tour
  // (sign-out, Fast Refresh). `setAutoConnectEnabled` is stable, so this only
  // runs on unmount.
  useEffect(() => () => setAutoConnectEnabled(true, TOUR_AUTO_CONNECT_SOURCE), [
    setAutoConnectEnabled,
  ]);

  const value = useMemo<TourContextValue>(
    () => ({
      isActive,
      stepIndex,
      step,
      totalSteps: TOUR_STEPS.length,
      activeTargetId,
      targetRect,
      start,
      next,
      finish,
      reportTarget,
      notifyAction,
    }),
    [
      isActive,
      stepIndex,
      step,
      activeTargetId,
      targetRect,
      start,
      next,
      finish,
      reportTarget,
      notifyAction,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useTour must be used within a <TourProvider>.');
  }
  return ctx;
}
