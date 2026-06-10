/**
 * Spacing scale from DESIGN.md — all values are multiples of 8px.
 */
export const Spacing = {
  /** 4px — half unit for tight padding */
  xs: 4,
  /** 8px — base unit / stack-sm */
  sm: 8,
  /** 16px — gutter / stack-md */
  md: 16,
  /** 24px — container padding */
  lg: 24,
  /** 32px — stack-lg / section separator */
  xl: 32,
  /** 48px — major section gap */
  xxl: 48,
} as const;

/**
 * Border radius tokens from DESIGN.md shapes.
 */
export const Radius = {
  /** 4px — tags, pips */
  sm: 4,
  /** 8px — default */
  default: 8,
  /** 12px */
  md: 12,
  /** 16px — buttons, inputs */
  lg: 16,
  /** 24px — cards, modals */
  xl: 24,
  /** 9999 — pill / fully rounded */
  full: 9999,
} as const;
