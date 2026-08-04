import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';

import { useSession } from '@/hooks/useSessions';
import { formatSessionDate, formatDuration } from '@/lib/format';
import { SHOT_TYPES } from '@/lib/shotClassifier';
import { PowerLevel } from '@/types';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';
import { SHOT_TYPE_GUIDE, SHOT_TYPE_LABELS } from '@/constants/shotTypes';

const POWER_LEVELS: PowerLevel[] = ['low', 'medium', 'high', 'super'];
const ZONE_LABELS: Record<number, string> = {
  1: 'Z1',
  2: 'Z2',
  3: 'Z3',
  4: 'Z4',
  5: 'Z5',
};
const CHART_HEIGHT = 130;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession(id);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Session not found</Text>
      </View>
    );
  }

  const { metrics } = session;
  const isComplete = session.status === 'complete';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Summary ─────────────────────────────────────── */}
      <Text style={styles.date}>{formatSessionDate(session.startedAt)}</Text>
      <Text style={styles.subtitle}>
        {isComplete ? formatDuration(session.durationSec) : 'In progress'}
      </Text>

      {!metrics ? (
        <Text style={styles.muted}>
          {session.status === 'active'
            ? 'Session in progress — metrics appear once it ends.'
            : 'No metrics for this session yet.'}
        </Text>
      ) : (
        <>
          {/* ── Top-line stats ──────────────────────────── */}
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>SHOTS</Text>
              <Text style={styles.statValue}>{metrics.totalShots}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>AVG POWER</Text>
              <Text style={styles.statValue}>{capitalize(metrics.avgPower)}</Text>
            </View>
          </View>

          {/* ── Average power per shot ──────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Average Power per Shot</Text>
            <PowerMeter level={metrics.avgPower} />
          </View>

          {/* ── Shots per zone ──────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shots per Zone</Text>
            <BarChart
              data={metrics.zones.map((z) => ({
                key: String(z.zone),
                label: ZONE_LABELS[z.zone] ?? `Z${z.zone}`,
                value: z.shots,
              }))}
            />
          </View>

          {/* ── Shots by type ───────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shots by Type</Text>
            <BarChart
              data={metrics.shotTypes.map((s) => ({
                key: s.type,
                label: SHOT_TYPE_LABELS[s.type] ?? s.type,
                value: s.shots,
              }))}
            />
            <ShotTypeGuide />
          </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * Collapsed-by-default explainer for the five shot-type buckets. The copy is
 * static reference material (`constants/shotTypes.ts`) — identical on every
 * session — so it stays folded away under the chart until asked for, but the
 * header is tinted and chevroned so it reads as tappable rather than as a
 * caption. Walks `SHOT_TYPES` so the list order always matches the bars.
 */
function ShotTypeGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.guide}>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="What do these shot types mean?"
        style={({ pressed }) => [
          styles.guideHeader,
          pressed && styles.guidePressed,
        ]}
      >
        <Text style={styles.guideHeaderText}>
          What do these shot types mean?
        </Text>
        <SymbolView
          name={expanded ? 'chevron.up' : 'chevron.down'}
          tintColor={Colors.primary}
          size={14}
        />
      </Pressable>

      {expanded && (
        <View style={styles.guideBody}>
          {SHOT_TYPES.map((type) => (
            <View key={type} style={styles.guideItem}>
              <Text style={styles.guideItemTitle}>
                {SHOT_TYPE_LABELS[type]}
              </Text>
              <Text style={styles.guideItemText}>
                {SHOT_TYPE_GUIDE[type].what}
              </Text>
              <Text style={styles.guideItemUsage}>
                <Text style={styles.guideItemUsageLead}>In game: </Text>
                {SHOT_TYPE_GUIDE[type].inGame}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Four-segment gauge filled up to the current power level. */
function PowerMeter({ level }: { level: PowerLevel }) {
  const activeIndex = POWER_LEVELS.indexOf(level);
  return (
    <View>
      <View style={styles.meterRow}>
        {POWER_LEVELS.map((lvl, i) => (
          <View
            key={lvl}
            style={[
              styles.meterSeg,
              i <= activeIndex ? styles.meterSegActive : styles.meterSegInactive,
            ]}
          />
        ))}
      </View>
      <View style={styles.meterLabels}>
        {POWER_LEVELS.map((lvl) => (
          <Text
            key={lvl}
            style={[styles.meterLabel, lvl === level && styles.meterLabelActive]}
          >
            {capitalize(lvl)}
          </Text>
        ))}
      </View>
    </View>
  );
}

interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * Simple dependency-free vertical bar chart. Shared by the zone and shot-type
 * breakdowns so the two always look identical — bars are scaled against the
 * largest value in their own chart, and a zero value still renders a 2px stub
 * rather than disappearing.
 */
function BarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={styles.chart}>
      {data.map((d) => {
        const height = Math.max(Math.round((d.value / max) * CHART_HEIGHT), 2);
        return (
          <View key={d.key} style={styles.barCol}>
            <Text style={styles.barValue}>{d.value}</Text>
            <View style={[styles.bar, { height }]} />
            {/* Shrink-to-fit keeps the longest label ("Overhead") on one line
                in a 5-column chart without changing the style for short ones. */}
            <Text
              style={styles.barLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 120, // clear the floating pill tab bar
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  muted: {
    ...Typography.bodyMd,
    color: Colors.muted,
  },
  date: {
    ...Typography.headlineMd,
    color: Colors.text,
  },
  subtitle: {
    ...Typography.bodyLg,
    color: Colors.onSurfaceVariant,
    marginBottom: Spacing.xl,
  },

  // Top-line stats
  statRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
  },
  statLabel: {
    ...Typography.labelCaps,
    color: Colors.muted,
    marginBottom: Spacing.xs,
  },
  statValue: {
    ...Typography.dataDisplay,
    color: Colors.text,
  },

  // Sections
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headlineMd,
    color: Colors.text,
    marginBottom: Spacing.md,
  },

  // Power meter
  meterRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  meterSeg: {
    flex: 1,
    height: 10,
    borderRadius: Radius.full,
  },
  meterSegActive: {
    backgroundColor: Colors.primary,
  },
  meterSegInactive: {
    backgroundColor: Colors.surfaceContainerHighest,
  },
  meterLabels: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
  },
  meterLabel: {
    ...Typography.labelCaps,
    flex: 1,
    textAlign: 'center',
    color: Colors.muted,
  },
  meterLabelActive: {
    color: Colors.primary,
  },

  // Zone bar chart
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: CHART_HEIGHT + 44,
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  bar: {
    width: '55%',
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
    backgroundColor: Colors.primary,
  },
  barValue: {
    ...Typography.labelCaps,
    color: Colors.onSurfaceVariant,
  },
  barLabel: {
    ...Typography.labelCaps,
    color: Colors.muted,
  },

  // Shot-type explainer dropdown
  guide: {
    marginTop: Spacing.md,
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    overflow: 'hidden',
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  guidePressed: {
    opacity: 0.6,
  },
  guideHeaderText: {
    ...Typography.bodyMd,
    flexShrink: 1,
    color: Colors.primary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  guideBody: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  guideItem: {
    gap: Spacing.xs,
  },
  guideItemTitle: {
    ...Typography.labelCaps,
    color: Colors.text,
  },
  guideItemText: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },
  guideItemUsage: {
    ...Typography.bodyMd,
    color: Colors.muted,
  },
  guideItemUsageLead: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
    color: Colors.onSurfaceVariant,
  },
});
