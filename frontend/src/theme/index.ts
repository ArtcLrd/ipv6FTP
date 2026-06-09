import { BrandColors } from './colors';

export { BrandColors } from './colors';

export const Theme = {
  colors: {
    // ── Brand Palette ──────────────────────────────────────────────
    background:    BrandColors.inkBlack,   // #071013 — deepest bg
    surface:       BrandColors.inkBlack2,  // #001828 — card/glass base
    accent:        BrandColors.balticBlue, // #01538d — primary CTA, focus
    accentPressed: BrandColors.yaleBlue,   // #00477a — pressed/hover
    // ── UI Derived Tokens ──────────────────────────────────────────
    border:        'rgba(1, 83, 141, 0.28)', // balticBlue at low opacity
    textPrimary:   '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.5)',
    textMuted:     'rgba(255, 255, 255, 0.22)',
    // ── Functional (outside brand palette — system signals) ────────
    success: '#10b981',
    danger:  '#ef4444',
    shadow:  '#000000',
    // ── Glass surface ──────────────────────────────────────────────
    glassBg:     'rgba(0, 24, 40, 0.60)',  // inkBlack2 @ 60% opacity
    glassBorder: 'rgba(1, 83, 141, 0.30)', // balticBlue faint
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  roundness: {
    sm:   8,
    md:   14,
    lg:   22,
    pill: 50,
    full: 9999,
  },
  typography: {
    brandTitle: {
      fontSize: 36,
      fontWeight: '800' as '800',
      letterSpacing: -0.5,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '700' as '700',
      letterSpacing: -0.3,
    },
  },
  glass: {
    backgroundColor: 'rgba(0, 24, 40, 0.60)',
    borderWidth: 1,
    borderColor: 'rgba(1, 83, 141, 0.30)',
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 12,
  },
};
