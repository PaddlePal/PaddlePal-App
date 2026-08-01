import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut } from '@react-native-firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { TourTarget } from '@/components/tour/TourTarget';
import { UserProfile } from '@/types';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

// ── Field helpers ──────────────────────────────────────────────────
// Any missing / null / invalid value renders as blank, per spec.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function displayName(profile: UserProfile | null): string {
  const name = profile?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : '';
}

function displayEmail(profile: UserProfile | null): string {
  const email = profile?.email;
  if (typeof email === 'string' && EMAIL_REGEX.test(email.trim())) {
    return email.trim();
  }
  return '';
}

// ── Component ──────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { profile } = useAuth();

  const name = displayName(profile);
  const email = displayEmail(profile);

  const handleSignOut = async () => {
    await signOut(auth);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* ── Account ─────────────────────────────────────── */}
      <TourTarget id="settings-account">
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>NAME</Text>
            <Text style={styles.value}>{name}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>EMAIL</Text>
            <Text style={styles.value}>{email}</Text>
          </View>
        </View>
      </TourTarget>

      {/* ── Sign Out ────────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={handleSignOut}
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
  },

  // Account card
  card: {
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingHorizontal: Spacing.lg,
  },
  row: {
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  label: {
    ...Typography.labelCaps,
    color: Colors.muted,
  },
  value: {
    ...Typography.bodyLg,
    color: Colors.text,
    minHeight: 28, // keep row height stable when the value is blank
  },
  divider: {
    height: 1,
    backgroundColor: Colors.glassBorder,
  },

  // Sign out
  signOutButton: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    ...Typography.bodyLg,
    color: Colors.error,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
