/**
 * Dark theme constants — optimised for photo work on iPad.
 */

export const COLORS = {
  // Backgrounds
  bg: '#0D0D0D',
  bgSecondary: '#1A1A1A',
  bgTertiary: '#252525',
  surface: '#2A2A2A',
  surfaceHover: '#333333',

  // Canon-red accent
  accent: '#C41230',
  accentLight: '#E8354F',
  accentDark: '#8B0D22',

  // Status
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',

  // Text
  textPrimary: '#F5F5F5',
  textSecondary: '#A0A0A0',
  textMuted: '#666666',
  textInverse: '#0D0D0D',

  // Borders
  border: '#333333',
  borderLight: '#444444',

  // Overlays
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(255,255,255,0.05)',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  hero: 36,
} as const;

export const BORDER_RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;
