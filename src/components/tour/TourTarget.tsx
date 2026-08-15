import React, { useCallback, useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { TourTargetId } from '@/constants/tourSteps';
import { useTour } from '@/hooks/useTour';

/** Re-measure attempts after a target becomes active, and their spacing. */
const MEASURE_ATTEMPTS = 6;
const MEASURE_INTERVAL_MS = 80;

interface TourTargetProps {
  id: TourTargetId;
  /**
   * Applied to the wrapper. Pass whatever the wrapped element needs from its
   * parent's layout (e.g. `flex: 1`) so inserting this View changes nothing.
   */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Wraps a real UI element so the onboarding tour can spotlight it.
 *
 * Reports its window-space box to `TourProvider` whenever it is the active
 * step's target. Purely additive — outside the tour this is an ordinary View
 * that reports nothing.
 */
export function TourTarget({ id, style, children }: TourTargetProps) {
  const ref = useRef<View>(null);
  const { activeTargetId, reportTarget } = useTour();
  const isActive = activeTargetId === id;

  // onLayout fires from the host view, which doesn't re-render on every step
  // change — read "am I active?" through a ref so it always sees the current
  // answer without re-binding the handler.
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      // A screen on a background tab measures as zero-sized (or not at all).
      // Skip those — a stale rect is worse than no cutout.
      if (!width || !height) return;
      reportTarget(id, { x, y, width, height });
    });
  }, [id, reportTarget]);

  // Measure when this becomes the spotlit target. The screen may have only
  // just been navigated to, so retry over a few frames until it has a real box
  // (`reportTarget` ignores repeats, so settling costs nothing).
  useEffect(() => {
    if (!isActive) return;

    measure();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      measure();
      if (attempts >= MEASURE_ATTEMPTS) clearInterval(timer);
    }, MEASURE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isActive, measure]);

  const handleLayout = useCallback(() => {
    if (isActiveRef.current) measure();
  }, [measure]);

  return (
    // collapsable={false} keeps the wrapper a real native view so it can be
    // measured (Android flattens single-child Views otherwise).
    <View ref={ref} collapsable={false} style={style} onLayout={handleLayout}>
      {children}
    </View>
  );
}
