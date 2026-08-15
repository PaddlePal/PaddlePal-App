import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { doc, setDoc } from '@react-native-firebase/firestore';
import { firestore } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useBluetooth } from '@/hooks/useBluetooth';
import {
  TOUR_AUTO_CONNECT_SOURCE,
  TOUR_PARAM_VALUE,
} from '@/constants/tourSteps';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

export default function WelcomeScreen() {
  const { user } = useAuth();
  const { setAutoConnectEnabled } = useBluetooth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  /**
   * Complete onboarding (`onboarded` → true) and hand straight over to the
   * in-context tour.
   *
   * Navigating explicitly rather than leaning on the root Auth Gate's reactive
   * redirect is what carries the `tour` param — which is the entire "plays
   * once" mechanism: a normal relaunch lands on the dashboard without it. The
   * Auth Gate's redirect is untouched and still covers every other transition.
   */
  const handleGetStarted = async () => {
    if (!user) return;

    setLoading(true);
    // Claim the tour's auto-connect hold BEFORE the flag flips. The Auth Gate
    // releases its own hold the instant `onboarded` becomes true, and the tour
    // can't claim one until the tabs tree mounts — without this the loop could
    // arm in that gap and connect the paddle before the Connect Paddle step.
    setAutoConnectEnabled(false, TOUR_AUTO_CONNECT_SOURCE);
    try {
      const userRef = doc(firestore, 'users', user.uid);
      await setDoc(userRef, { onboarded: true }, { merge: true });
      router.replace({
        pathname: '/(tabs)/dashboard',
        params: { tour: TOUR_PARAM_VALUE },
      });
    } catch (err) {
      console.error('[WelcomeScreen] Error completing onboarding:', err);
      // Onboarding didn't complete — no tour is coming, so give the radio back.
      setAutoConnectEnabled(true, TOUR_AUTO_CONNECT_SOURCE);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* ── Decorative accent ────────────────────────── */}
        <View style={styles.accentDot} />

        {/* ── Copy ─────────────────────────────────────── */}
        <Text style={styles.brand}>PADDLEPAL</Text>
        <Text style={styles.title}>Welcome to{'\n'}PaddlePal Connect</Text>
        <Text style={styles.body}>
          Your smart paddle companion is ready. Let's get you set up and show
          you around.
        </Text>

        {/* ── What happens next ────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>QUICK TOUR</Text>
          <Text style={styles.cardBody}>
            A quick lap of the app: connecting your paddle, recording a real
            session, watching your hits land live, and where your stats live.
          </Text>
        </View>
      </View>

      {/* ── Actions ──────────────────────────────────────── */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.getStartedButton,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
          onPress={handleGetStarted}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onPrimary} />
          ) : (
            <Text style={styles.getStartedButtonText}>Get Started</Text>
          )}
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
  content: {
    flex: 1,
    justifyContent: 'center',
  },

  // Accent
  accentDot: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    marginBottom: Spacing.lg,
    opacity: 0.9,
  },

  // Copy
  brand: {
    ...Typography.labelCaps,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.headlineLg,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  body: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    marginBottom: Spacing.xl,
  },

  // Card
  card: {
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
  },
  cardLabel: {
    ...Typography.labelCaps,
    color: Colors.secondaryContainer,
    marginBottom: Spacing.sm,
  },
  cardBody: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },

  // Actions
  actions: {
    paddingBottom: Spacing.xl,
  },
  getStartedButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  getStartedButtonText: {
    ...Typography.bodyLg,
    color: Colors.onPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
});
