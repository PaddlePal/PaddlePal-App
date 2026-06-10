import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut } from '@react-native-firebase/auth';
import { doc, setDoc } from '@react-native-firebase/firestore';
import { auth, firestore } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

export default function WelcomeScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  /**
   * Dev-only: mark onboarded → true, then sign out to validate
   * the Auth Gate bounces the user back to sign-in.
   */
  const handleSkip = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const userRef = doc(firestore, 'users', user.uid);
      await setDoc(userRef, { onboarded: true }, { merge: true });

      await signOut(auth);
    } catch {
      // Auth Gate will handle navigation
    } finally {
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
          Your smart paddle companion is almost ready. We'll walk you through
          connecting your paddle and customizing your experience.
        </Text>

        {/* ── Placeholder card ─────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>ONBOARDING</Text>
          <Text style={styles.cardBody}>
            Full onboarding flow coming soon — paddle pairing, sensor
            calibration, and profile setup.
          </Text>
        </View>
      </View>

      {/* ── Actions ──────────────────────────────────────── */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.skipButton,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
          onPress={handleSkip}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onPrimary} />
          ) : (
            <Text style={styles.skipButtonText}>Skip for now (Dev)</Text>
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
  skipButton: {
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
  skipButtonText: {
    ...Typography.bodyLg,
    color: Colors.onPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
});
