/**
 * Design tokens derived from DESIGN.md — "Kinetic Precision" theme.
 *
 * Color naming follows the Material Design 3 tonal system adapted
 * for the PaddlePal brand palette.
 */
export const Colors = {
  // ── Primary: Electric Lime ────────────────────────────────
  primary: '#DFFF00',
  primaryContainer: '#D2F000',
  onPrimary: '#2C3400',
  onPrimaryContainer: '#5D6B00',

  // ── Secondary: Action Blue ────────────────────────────────
  secondary: '#ADC6FF',
  secondaryContainer: '#4B8EFF',
  onSecondary: '#002E69',
  onSecondaryContainer: '#00285C',

  // ── Tertiary: Cyan accents ────────────────────────────────
  tertiary: '#63F7FF',
  tertiaryDim: '#00DCE5',
  onTertiary: '#003739',

  // ── Surfaces / Backgrounds ────────────────────────────────
  background: '#020617',       // Near-Black canvas
  surface: '#0F172A',          // Midnight Navy containers
  surfaceDim: '#0B1326',
  surfaceBright: '#31394D',
  surfaceContainer: '#171F33',
  surfaceContainerHigh: '#222A3D',
  surfaceContainerHighest: '#2D3449',
  surfaceContainerLow: '#131B2E',
  surfaceContainerLowest: '#060E20',

  // ── On-Surface text ───────────────────────────────────────
  text: '#DAE2FD',
  textSecondary: '#C6C9AB',
  onSurface: '#DAE2FD',
  onSurfaceVariant: '#C6C9AB',

  // ── Outline / Borders ────────────────────────────────────
  border: '#454932',
  outline: '#909378',
  outlineVariant: '#454932',

  // ── Semantic ──────────────────────────────────────────────
  error: '#FFB4AB',
  errorContainer: '#93000A',
  onError: '#690005',
  success: '#DFFF00',          // Reuse primary for positive states

  // ── Utility ───────────────────────────────────────────────
  muted: '#909378',
  card: '#171F33',             // Alias for surfaceContainer
  inputBackground: '#0B1326',
  inputBorder: '#454932',
  inputBorderFocus: '#DFFF00',

  // ── Gradient endpoints ────────────────────────────────────
  gradientStart: '#00F5FF',    // Cyan baseline
  gradientEnd: '#DFFF00',      // Electric Lime peak

  // ── Glass effects ─────────────────────────────────────────
  glassBackground: 'rgba(15, 23, 42, 0.6)',
  glassBorder: 'rgba(255, 255, 255, 0.10)',

  // ── Connectivity ──────────────────────────────────────────
  bluetooth: '#4B8EFF',
} as const;

export type ColorToken = keyof typeof Colors;
