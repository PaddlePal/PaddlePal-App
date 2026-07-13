import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useSession } from '@/hooks/useSessions';
import { formatSessionDate, formatDuration } from '@/lib/format';
import { PowerLevel, ZoneStat } from '@/types';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Summary ─────────────────────────────────────── */}
      <Text style={styles.date}>{formatSessionDate(session.startedAt)}</Text>
      <Text style={styles.subtitle}>{formatDuration(session.durationSec)}</Text>

      {!metrics ? (
        <Text style={styles.muted}>No metrics for this session yet.</Text>
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
            <ZoneBarChart zones={metrics.zones} />
          </View>
        </>
      )}
    </ScrollView>
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

/** Simple dependency-free vertical bar chart of shots per zone. */
function ZoneBarChart({ zones }: { zones: ZoneStat[] }) {
  const max = Math.max(...zones.map((z) => z.shots), 1);
  return (
    <View style={styles.chart}>
      {zones.map((z) => {
        const height = Math.max(Math.round((z.shots / max) * CHART_HEIGHT), 2);
        return (
          <View key={z.zone} style={styles.barCol}>
            <Text style={styles.barValue}>{z.shots}</Text>
            <View style={[styles.bar, { height }]} />
            <Text style={styles.barLabel}>
              {ZONE_LABELS[z.zone] ?? `Z${z.zone}`}
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
});
