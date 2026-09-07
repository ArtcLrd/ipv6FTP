/**
 * VoIPv6 Brand Palette
 * All UI colours must derive from this set.
 */
export const BrandColors = {
  inkBlack:   '#071013',  // Deepest background
  inkBlack2:  '#001828',  // Mid-dark surface / card base
  balticBlue: '#01538d',  // Primary accent — buttons, focus rings, borders
  yaleBlue:   '#00477a',  // Hover / pressed accent variant
} as const;

export type BrandColorKey = keyof typeof BrandColors;
