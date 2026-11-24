import { BRAND } from './config';

/** Design tokens from spec §12. The gym's brand colour replaces black on primary actions. */
export const colors = {
  bg: '#F2F3F1',
  card: '#FFFFFF',
  text: '#17191C',
  textSecondary: '#5E646B',
  border: '#D5D8DB',
  red: '#D7263D',
  redSoft: '#FBE9EB',
  green: '#23824A',
  greenSoft: '#E5F3EA',
  amber: '#9A6700',
  amberSoft: '#FFF4D6',
  blueSoft: '#E8EEF8',
  brand: BRAND.primaryColor,
  onBrand: '#FFFFFF',
  overlay: 'rgba(23,25,28,0.45)',
} as const;

export const fonts = {
  display: 'BigShouldersDisplay_800ExtraBold',
  displayBold: 'BigShouldersDisplay_700Bold',
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
} as const;

export const radius = { card: 24, pill: 999, input: 16 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Minimum touch target (spec §11). */
export const TOUCH = 44;
/** Numbers read mid-workout are at least 40 px (spec §12). */
export const BIG_NUMBER = 56;

/** Shadow only for floating elements (tab bar, menus). */
export const floatingShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8,
} as const;
