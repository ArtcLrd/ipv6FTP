export const Theme = {
  colors: {
    background: '#0f1418',       // Deep nocturnal background
    surface: '#171c20',          // Glass surface card base
    border: 'rgba(255, 255, 255, 0.08)', // Translucent glass border
    textPrimary: '#ffffff',      // Crisp white text
    textSecondary: '#94a3b8',    // Muted blue-gray text
    accent: '#38bdf8',           // Electric blue highlight
    success: '#10b981',          // Emerald green
    danger: '#ef4444',           // Vibrant red
    shadow: '#000000',           // Shadow base
    glassBg: 'rgba(23, 28, 32, 0.75)', // Glass translucent background
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  roundness: {
    sm: 6,
    md: 12,
    lg: 20,
    full: 9999,
  },
  typography: {
    brandTitle: {
      fontSize: 38,
      fontWeight: '900' as '900',
      letterSpacing: -1,
    },
    cardTitle: {
      fontSize: 22,
      fontWeight: '900' as '900',
      letterSpacing: -0.5,
    },
  },
  glass: {
    backgroundColor: 'rgba(23, 28, 32, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
};
