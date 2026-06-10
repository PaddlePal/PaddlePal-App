import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut } from '@react-native-firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

export default function DashboardScreen() {
  const { profile } = useAuth();

  const handleSignOut = async () => {
    await signOut(auth);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hey, {profile?.name ?? 'Player'} 👋
        </Text>
        <Text style={styles.subtitle}>Ready to play?</Text>
      </View>

      {/* ── Status Cards ───────────────────────────────── */}
      <View style={styles.cards}>
        {/* Paddle Status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.statusDot, styles.statusOffline]} />
            <Text style={styles.cardLabel}>PADDLE SENSOR</Text>
          </View>
          <Text style={styles.cardValue}>Not Connected</Text>
          <Text style={styles.cardHint}>
            Pair your PaddlePal to start tracking
          </Text>
        </View>

        {/* Session Stats Placeholder */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardLabel}>LAST SESSION</Text>
          </View>
          <Text style={styles.cardValue}>—</Text>
          <Text style={styles.cardHint}>
            No sessions recorded yet
          </Text>
        </View>
      </View>

      {/* ── Quick Actions ──────────────────────────────── */}
      <View style={styles.quickActions}>
        <Pressable style={styles.connectButton}>
          <View style={styles.pulseRing} />
          <Text style={styles.connectButtonText}>Connect Paddle</Text>
        </Pressable>
      </View>

      {/* ── Sign Out ───────────────────────────────────── */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleSignOut}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },

  // Header
  header: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  greeting: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.bodyLg,
    color: Colors.onSurfaceVariant,
  },

  // Cards
  cards: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cardLabel: {
    ...Typography.labelCaps,
    color: Colors.muted,
  },
  cardValue: {
    ...Typography.dataDisplay,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  cardHint: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  statusOffline: {
    backgroundColor: Colors.muted,
  },

  // Quick Actions
  quickActions: {
    marginBottom: Spacing.xl,
  },
  connectButton: {
    backgroundColor: Colors.secondaryContainer,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  pulseRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.bluetooth,
    opacity: 0.3,
  },
  connectButtonText: {
    ...Typography.bodyLg,
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },

  // Footer
  footer: {
    marginTop: 'auto',
    paddingBottom: Spacing.lg,
    alignItems: 'center',
  },
  signOutButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  signOutText: {
    ...Typography.bodyMd,
    color: Colors.error,
  },
});
