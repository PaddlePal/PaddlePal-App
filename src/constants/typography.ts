import { TextStyle } from 'react-native';

/**
 * Typography scale derived from DESIGN.md.
 * Font family references match @expo-google-fonts/plus-jakarta-sans keys.
 */
export const Typography = {
  displayLg: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 48,
    fontWeight: '800' as TextStyle['fontWeight'],
    lineHeight: 56,
    letterSpacing: -0.96, // -0.02em × 48
  },
  headlineLg: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 32,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 40,
    letterSpacing: -0.32, // -0.01em × 32
  },
  headlineLgMobile: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 28,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 36,
  },
  headlineMd: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 24,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 32,
  },
  bodyLg: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 18,
    fontWeight: '500' as TextStyle['fontWeight'],
    lineHeight: 28,
  },
  bodyMd: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 16,
    fontWeight: '400' as TextStyle['fontWeight'],
    lineHeight: 24,
  },
  labelCaps: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 12,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 16,
    letterSpacing: 0.6,  // 0.05em × 12
    textTransform: 'uppercase' as TextStyle['textTransform'],
  },
  dataDisplay: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 36,
    fontWeight: '800' as TextStyle['fontWeight'],
    lineHeight: 44,
    letterSpacing: -0.72, // -0.02em × 36
  },
} as const;
