import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as SplashScreen from 'expo-splash-screen';

import { useAuth } from '@/hooks/useAuth';
import { BluetoothProvider, useBluetooth } from '@/hooks/useBluetooth';
import { Colors } from '@/constants/colors';
import { UserProfile } from '@/types';

// Keep splash visible while fonts + auth load
SplashScreen.preventAutoHideAsync();

/** Auth-Gate source name for the auto-connect suppression (see useBluetooth). */
const AUTO_CONNECT_SOURCE = 'onboarding';

/**
 * Holds the BLE auto-connect loop off for the whole not-yet-onboarded window
 * — sign-up through "Get Started" — using the same predicate the Auth Gate
 * uses to redirect into onboarding.
 *
 * Without this, the paddle connects itself at app launch (the loop arms as
 * soon as the adapter reports PoweredOn), long before a new user reaches the
 * tour's Connect Paddle step, leaving that step nothing real to demonstrate.
 * The tour holds the same gate — under its own source — for its own duration.
 *
 * Renders nothing; must live INSIDE <BluetoothProvider>, which RootLayout is
 * the parent of. See memory-bank/PLAN-onboarding-tour.md (T1).
 */
function OnboardingAutoConnectGate({
  user,
  profile,
}: {
  user: unknown;
  profile: UserProfile | null;
}) {
  const { setAutoConnectEnabled } = useBluetooth();

  useEffect(() => {
    const notOnboardedYet = !!user && (!profile || profile.onboarded === false);
    setAutoConnectEnabled(!notOnboardedYet, AUTO_CONNECT_SOURCE);
  }, [user, profile, setAutoConnectEnabled]);

  return null;
}

/**
 * Root layout — acts as the strict Auth Gate.
 *
 * Uses useEffect + router.replace instead of declarative <Redirect>
 * to prevent "Maximum update depth exceeded" errors during rapid
 * auth state transitions (e.g. sign-out).
 */
export default function RootLayout() {
  const { user, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // Hide splash once both auth state and fonts have resolved
  useEffect(() => {
    if (!loading && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [loading, fontsLoaded]);

  // ── Auth Gate routing ──────────────────────────────────────
  useEffect(() => {
    if (loading || !fontsLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    const inTabsGroup = segments[0] === '(tabs)';

    if (!user && !inAuthGroup) {
      // Not signed in → go to sign-in
      router.replace('/(auth)/sign-in');
    } else if (user && (!profile || profile.onboarded === false) && !inOnboardingGroup) {
      // Signed in but has no profile OR hasn't onboarded → onboarding
      router.replace('/(onboarding)/welcome');
    } else if (user && profile && profile.onboarded === true && !inTabsGroup) {
      // Signed in and onboarded → main app
      router.replace('/(tabs)/dashboard');
    }
  }, [user, profile, loading, fontsLoaded, segments]);

  // ── Loading state ──────────────────────────────────────────
  if (loading || !fontsLoaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <BluetoothProvider>
      <OnboardingAutoConnectGate user={user} profile={profile} />
      <StatusBar style="light" />
      <Slot />
    </BluetoothProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
