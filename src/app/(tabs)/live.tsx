import { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { Radius, Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { isConnectedToPaddle, useBluetooth } from '@/hooks/useBluetooth';
import { usePaddleData, type PaddleHit, type ZoneId } from '@/hooks/usePaddleData';
import { TourTarget } from '@/components/tour/TourTarget';

// The paddle is drawn from plain Views (rounded-rect head + rectangular handle) —
// no image, no react-native-svg, so nothing forces a native rebuild.
const PADDLE_ASPECT = 0.56; // width / height of the full paddle (face + handle)
const HEAD_HEIGHT_PCT = '60%'; // head occupies the top 60% of the paddle box

// ── Zone → sensor-grid layout ─────────────────────────────────────────────────
// The physical paddle face is a 4-column × 5-row grid of 16 FSR sensors grouped
// into 4 zones. Zones are positioned by GRID FRACTIONS of the head's bounding
// box, so they scale with the drawn paddle. Columns 1=left … 4=right, rows
// 1=top … 5=bottom.
//
// ⚠️ Which physical region maps to firmware zone IDs 1–4 is still unconfirmed on
// real hardware. This array is the single source of truth — to remap, just edit
// a row's `zone` (or its col/row span). Default numbering per the hardware diagram:
//   Z1 center (rows 2–3 × cols 2–3, 4 sensors) — largest, dead center
//   Z2 bottom (rows 4–5 × cols 2–3, 4 sensors) — closest to the handle
//   Z3 left   (rows 2–4 × col 1,   3 sensors) — full-height left strip
//   Z4 right  (rows 2–4 × col 4,   3 sensors) — full-height right strip
//
// ⚠️ Row 1 (top, cols 2–3) is UNCLAIMED — it was Z5's box, and Z5 was removed
// from the firmware on 2026-08-06. Left deliberately blank rather than
// stretching Z1 up into it: no hardware source says the centre sensor group
// reaches the top of the face. The zones therefore only span rows 2–5, which
// left the block sitting flush against the bottom of the head with the whole
// gap along the top — see ROW_SHIFT_PCT below for the cosmetic fix. If the real
// geometry ever gets confirmed against the paddle, extend a zone's `row` span
// or shrink ROWS to 4 and drop the shift.
const COLS = 4;
const ROWS = 5;
const ZONE_GAP_PCT = 1.5; // visual gutter between zones

// Cosmetic vertical centring, not a layout change. With row 1 empty, the
// occupied rows (2–5) are one full row short of the grid, so everything hung
// low on the face. Lifting every zone by HALF a row splits that leftover row
// evenly above and below the block, which centres it — a full row would just
// move the same gap to the bottom. Grid spans are untouched, so remapping a
// zone still means editing only its col/row.
const ROW_SHIFT_PCT = (0.5 / ROWS) * 100;

interface ZoneConfig {
  zone: ZoneId;
  /** Inclusive column span, 1-indexed (1=left … 4=right). */
  col: [number, number];
  /** Inclusive row span, 1-indexed (1=top … 5=bottom). */
  row: [number, number];
  /**
   * Optional cosmetic nudge down the face, in grid rows (fractions allowed).
   * Applied on top of `ROW_SHIFT_PCT` and affects position only, never height.
   */
  nudgeRows?: number;
}

// The side strips span rows 2–4 while the centre column spans 2–5, so left
// alone they sit half a row high relative to the Z1/Z2 stack beside them.
// Nudging them down half a row lines their midpoint up with that stack's — both
// end up centred at 50% of the head. They stay shorter than the centre column,
// which is the grid's doing, not the nudge's.
const SIDE_STRIP_NUDGE = 0.5;

const ZONES: ZoneConfig[] = [
  { zone: 3, col: [1, 1], row: [2, 4], nudgeRows: SIDE_STRIP_NUDGE },
  { zone: 1, col: [2, 3], row: [2, 3] },
  { zone: 4, col: [4, 4], row: [2, 4], nudgeRows: SIDE_STRIP_NUDGE },
  { zone: 2, col: [2, 3], row: [4, 5] },
];

const ZONE_ORDER: ZoneId[] = [1, 2, 3, 4];

/** Converts a zone's grid span into a percentage-positioned box within the head. */
function zoneBox({ col, row, nudgeRows = 0 }: ZoneConfig): ViewStyle {
  const leftPct = ((col[0] - 1) / COLS) * 100;
  const rightPct = (col[1] / COLS) * 100;
  const topPct = ((row[0] - 1) / ROWS) * 100;
  const bottomPct = (row[1] / ROWS) * 100;
  const nudgePct = (nudgeRows / ROWS) * 100;
  return {
    left: `${leftPct + ZONE_GAP_PCT}%`,
    top: `${topPct - ROW_SHIFT_PCT + nudgePct + ZONE_GAP_PCT}%`,
    width: `${rightPct - leftPct - ZONE_GAP_PCT * 2}%`,
    height: `${bottomPct - topPct - ZONE_GAP_PCT * 2}%`,
  };
}

// ── One zone region: a faint outline that flashes Electric Lime on a hit ───────
function ZoneOverlay({
  zone,
  box,
  lastHit,
}: {
  zone: ZoneId;
  box: ViewStyle;
  lastHit: PaddleHit | null;
}) {
  const glow = useSharedValue(0);

  useEffect(() => {
    // lastHit is a new object per hit (its `ts` changes), so repeat hits on the
    // same zone re-run this effect and re-trigger the flash.
    if (lastHit && lastHit.zone === zone) {
      glow.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [lastHit, zone, glow]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <View style={[styles.zone, box]}>
      <Animated.View style={[styles.zoneFill, fillStyle]} />
      <Text style={styles.zoneNum}>{zone}</Text>
    </View>
  );
}

// ── Live paddle screen ────────────────────────────────────────────────────────
export default function LiveScreen() {
  const { connectedDevice } = useBluetooth();
  const { lastHit, zoneCounts } = usePaddleData();
  const { width } = useWindowDimensions();

  const connected = isConnectedToPaddle(connectedDevice);
  const paddleW = Math.min(width * 0.6, 220);
  const paddleH = paddleW / PADDLE_ASPECT;
  const headRadius = paddleW * 0.22;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Zone Hits</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, connected ? styles.dotOn : styles.dotOff]} />
          <Text style={styles.statusText}>
            {connected ? 'Paddle connected — tap the face' : 'Not connected — connect from Home'}
          </Text>
        </View>
      </View>

      <View style={styles.paddleWrap}>
        <TourTarget id="live-paddle">
          <View
            style={[
              styles.paddleBox,
              { width: paddleW, height: paddleH },
              !connected && styles.paddleDim,
            ]}
          >
            {/* Handle — drawn first so the head sits over the seam */}
            <View style={styles.handle} />

            {/* Head — rounded-rect face that hosts the zone grid */}
            <View style={[styles.head, { borderRadius: headRadius }]}>
              {ZONES.map((z) => (
                <ZoneOverlay key={z.zone} zone={z.zone} box={zoneBox(z)} lastHit={lastHit} />
              ))}
            </View>
          </View>
        </TourTarget>
      </View>

      {/* <View style={styles.counters}>
        {ZONE_ORDER.map((z) => (
          <View key={z} style={styles.counterChip}>
            <Text style={styles.counterZone}>Z{z}</Text>
            <Text style={styles.counterValue}>{zoneCounts[z]}</Text>
          </View>
        ))}
      </View> */}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },

  // Header
  header: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  title: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  dotOn: {
    backgroundColor: Colors.success,
  },
  dotOff: {
    backgroundColor: Colors.muted,
  },
  statusText: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },

  // Paddle
  paddleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paddleBox: {
    position: 'relative',
  },
  paddleDim: {
    opacity: 0.4,
  },
  head: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HEAD_HEIGHT_PCT,
    backgroundColor: Colors.surfaceContainer,
    borderWidth: 1.5,
    borderColor: Colors.glassBorder,
    overflow: 'hidden',
  },
  handle: {
    position: 'absolute',
    bottom: 0,
    left: '38%',
    width: '24%',
    height: '46%',
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: Colors.glassBorder,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
  },

  // Zone regions (positioned via zoneBox percentages)
  zone: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.default,
    borderWidth: 1.5,
    borderColor: 'rgba(223, 255, 0, 0.35)', // faint Electric Lime outline at rest
    backgroundColor: 'rgba(223, 255, 0, 0.05)',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  zoneFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.primary,
  },
  zoneNum: {
    ...Typography.labelCaps,
    fontSize: 14,
    color: 'rgba(223, 255, 0, 0.55)',
  },

  // Per-zone counters
  counters: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  // counterChip: {
  //   flex: 1,
  //   alignItems: 'center',
  //   backgroundColor: Colors.surfaceContainer,
  //   borderRadius: Radius.lg,
  //   borderWidth: 1,
  //   borderColor: Colors.glassBorder,
  //   paddingVertical: Spacing.md,
  //   gap: Spacing.xs,
  // },
  // counterZone: {
  //   ...Typography.labelCaps,
  //   color: Colors.muted,
  // },
  // counterValue: {
  //   ...Typography.headlineMd,
  //   color: Colors.primary,
  // },
});
