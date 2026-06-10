import { Redirect } from 'expo-router';

/**
 * Entry point — immediately redirects.
 * The root _layout.tsx Auth Gate determines the actual destination.
 */
export default function Index() {
  return <Redirect href="/(auth)/sign-in" />;
}
