import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { Radius, Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import type { TourAction } from '@/constants/tourSteps';
import { isConnectedToPaddle, useBluetooth } from '@/hooks/useBluetooth';
import { useTour, type TargetRect } from '@/hooks/useTour';

// ── Layout constants ──────────────────────────────────────────────
/** Breathing room between the spotlit element and the edge of the cutout. */
const SPOTLIGHT_PADDING = 8;
/** Gap between the cutout and the tooltip card. */
const TOOLTIP_GAP = Spacing.md;
/** Height reserved for the floating pill tab bar (see (tabs)/_layout). */
const TAB_BAR_SPACE = 88;
/** Assumed tooltip height for the very first frame, before it self-measures. */
const TOOLTIP_HEIGHT_ESTIMATE = 200;
/** Near-Black canvas (Colors.background) as the scrim. */
const SCRIM = 'rgba(2, 6, 23, 0.88)';

/**
 * What an action-gated step shows in place of the Next button. These steps
 * advance themselves when the action lands, so this is an instruction, not a
 * control the user is ever meant to tap.
 */
const ACTION_PROMPT: Record<TourAction, string> = {
  connect: 'Connect your paddle to continue',
  'session-start': 'Start a session to continue',
  'session-end': 'End the session to continue',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Grows the target box by the spotlight padding, clipped to the screen. */
function inflate(rect: TargetRect, width: number, height: number): TargetRect {
  const x = Math.max(0, rect.x - SPOTLIGHT_PADDING);
  const y = Math.max(0, rect.y - SPOTLIGHT_PADDING);
  return {
    x,
    y,
    width: Math.min(width - x, rect.width + SPOTLIGHT_PADDING * 2),
    height: Math.min(height - y, rect.height + SPOTLIGHT_PADDING * 2),
  };
}

/**
 * The onboarding tour's spotlight + tooltip, drawn over the live Tabs
 * navigator.
 *
 * The "hole" is four dark rectangles around the target rather than a real
 * cutout — no react-native-svg, so nothing here forces a native rebuild (same
 * reasoning as the hand-drawn paddle in live.tsx). Rendered as the last child
 * of (tabs)/_layout, NOT inside a <Modal>: a Modal is a separate native window
 * and could not show the real screen behind it.
 */
export function TourOverlay() {
  const { isActive, step, stepIndex, totalSteps, targetRect, next, notifyAction } =
    useTour();
  const { connectedDevice } = useBluetooth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [tooltipHeight, setTooltipHeight] = useState(TOOLTIP_HEIGHT_ESTIMATE);

  const handleTooltipLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    setTooltipHeight((prev) => (Math.abs(prev - measured) < 1 ? prev : measured));
  }, []);

  // Connection is the one gate the overlay can watch itself (Bluetooth is a
  // context). The session gates are reported by the dashboard, which owns the
  // recording lifecycle. `notifyAction` no-ops unless the step wants it.
  const connected = isConnectedToPaddle(connectedDevice);
  useEffect(() => {
    if (connected) notifyAction('connect');
  }, [connected, notifyAction]);

  if (!isActive || !step) return null;

  const spot = targetRect ? inflate(targetRect, width, height) : null;

  // Action-gated steps have no Next button — doing the real thing is what
  // advances them, which also means the tour never sits on a control that has
  // already done its job (Connect Paddle becomes Disconnect Paddle once paired).
  const gate = step.requiresAction ?? null;
  const isLastStep = stepIndex === totalSteps - 1;

  // ── Tooltip placement: flip above/below so it clears both the safe area
  // and the floating tab bar, then clamp into whatever room is left.
  const topLimit = insets.top + Spacing.md;
  const bottomLimit = height - insets.bottom - TAB_BAR_SPACE;

  const lowestTop = Math.max(topLimit, bottomLimit - tooltipHeight);

  let tooltipTop = Math.max(topLimit, (height - tooltipHeight) / 2);
  if (step.placement === 'bottom') {
    tooltipTop = lowestTop;
  } else if (step.placement === 'top') {
    tooltipTop = topLimit;
  } else if (spot) {
    const roomAbove = spot.y - TOOLTIP_GAP - topLimit;
    const roomBelow = bottomLimit - (spot.y + spot.height) - TOOLTIP_GAP;
    const placeBelow =
      roomBelow >= tooltipHeight || roomBelow >= roomAbove;

    tooltipTop = placeBelow
      ? spot.y + spot.height + TOOLTIP_GAP
      : spot.y - TOOLTIP_GAP - tooltipHeight;
    tooltipTop = clamp(tooltipTop, topLimit, lowestTop);
  }

  return (
    // box-none so the cutout passes touches through to the real screen; every
    // masked rectangle below is opaque and swallows them.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {spot ? (
        <>
          {/* Four-rectangle mask around the target. */}
          <View style={[styles.scrim, { left: 0, right: 0, top: 0, height: spot.y }]} />
          <View
            style={[
              styles.scrim,
              { left: 0, right: 0, top: spot.y + spot.height, bottom: 0 },
            ]}
          />
          <View
            style={[
              styles.scrim,
              { left: 0, width: spot.x, top: spot.y, height: spot.height },
            ]}
          />
          <View
            style={[
              styles.scrim,
              {
                left: spot.x + spot.width,
                right: 0,
                top: spot.y,
                height: spot.height,
              },
            ]}
          />

          {/* Electric-Lime focus glow around the cutout (DESIGN.md focus state). */}
          <View
            pointerEvents="none"
            style={[
              styles.glow,
              {
                left: spot.x,
                top: spot.y,
                width: spot.width,
                height: spot.height,
              },
            ]}
          />

          {/* Explain-only steps keep the spotlit control inert, so the tour
              can't fire anything on the user's behalf. Action-gated steps omit
              this so the real control underneath is genuinely tappable. */}
          {!gate && (
            <View
              style={{
                position: 'absolute',
                left: spot.x,
                top: spot.y,
                width: spot.width,
                height: spot.height,
              }}
            />
          )}
        </>
      ) : (
        // No fresh measurement yet (a step just crossed tabs) — dim everything
        // rather than cut a hole at the previous screen's coordinates.
        <View style={[styles.scrim, { left: 0, right: 0, top: 0, bottom: 0 }]} />
      )}

      {/* ── Tooltip ──────────────────────────────────────────── */}
      <View
        style={[styles.tooltip, { top: tooltipTop }]}
        onLayout={handleTooltipLayout}
      >
        <Text style={styles.counter}>
          {stepIndex + 1} of {totalSteps}
        </Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>

        {gate ? (
          // No button: the action itself is what advances the step.
          <View style={styles.prompt}>
            <Text style={styles.promptText}>{ACTION_PROMPT[gate]}</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? 'Finish tour' : 'Next step'}
          >
            <Text style={styles.buttonText}>{isLastStep ? 'Done' : 'Next'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    backgroundColor: SCRIM,
  },
  glow: {
    position: 'absolute',
    borderRadius: Radius.xl,
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },

  // Tooltip card — same glass treatment as every other card in the app.
  tooltip: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  counter: {
    ...Typography.labelCaps,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.headlineMd,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  body: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },
  // Instruction that replaces the button on action-gated steps. Deliberately
  // not button-shaped — there is nothing here to tap.
  prompt: {
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerHigh,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptText: {
    ...Typography.labelCaps,
    color: Colors.primary,
  },

  // Primary CTA — Electric Lime fill with black text, per DESIGN.md.
  button: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    ...Typography.bodyLg,
    color: Colors.onPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
});
