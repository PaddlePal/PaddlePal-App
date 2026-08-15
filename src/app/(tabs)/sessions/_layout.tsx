import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Stack for the Sessions tab: list (index) → detail ([id]).
 * Nested inside the (tabs) group so the Auth Gate doesn't bounce it.
 */
export default function SessionsLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: Colors.background },
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { color: Colors.text },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Session' }} />
    </Stack>
  );
}
