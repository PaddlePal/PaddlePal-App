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
import { Colors } from '@/constants/colors';

// Keep splash visible while fonts + auth load
SplashScreen.preventAutoHideAsync();

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
    <>
      <StatusBar style="light" />
      <Slot />
    </>
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
