import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandColors } from '../theme/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Grid cell size in dp
const CELL = 38;

interface GridBackgroundProps {
  children?: React.ReactNode;
}

/**
 * Full-screen grid background:
 *   • LinearGradient: inkBlack (top) → inkBlack2 (mid) → balticBlue tint (bottom)
 *   • Fine white grid lines overlaid at low opacity
 *   • Pure React Native — zero additional dependencies
 */
export function GridBackground({ children }: GridBackgroundProps) {
  // Pre-calculate grid line counts once
  const cols = useMemo(() => Math.ceil(SCREEN_W / CELL) + 1, []);
  const rows = useMemo(() => Math.ceil(SCREEN_H / CELL) + 1, []);

  return (
    <View style={styles.root}>
      {/* ── Gradient layer ── */}
      <LinearGradient
        colors={[
          BrandColors.inkBlack,   // #071013 — top
          BrandColors.inkBlack2,  // #001828 — middle
          '#012a4a',              // deep navy transition
          '#013d6b',              // near-balticBlue at bottom
        ]}
        locations={[0, 0.45, 0.72, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* ── Grid overlay ── */}
      <View style={[StyleSheet.absoluteFillObject, styles.gridContainer]} pointerEvents="none">
        {/* Vertical lines */}
        {Array.from({ length: cols }).map((_, i) => (
          <View
            key={`v-${i}`}
            style={[styles.vLine, { left: i * CELL }]}
          />
        ))}
        {/* Horizontal lines */}
        {Array.from({ length: rows }).map((_, i) => (
          <View
            key={`h-${i}`}
            style={[styles.hLine, { top: i * CELL }]}
          />
        ))}
      </View>

      {/* ── Vignette: fade edges so grid feels infinite ── */}
      <LinearGradient
        colors={['rgba(7,16,19,0.6)', 'transparent', 'rgba(7,16,19,0.6)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* ── Content ── */}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gridContainer: {
    overflow: 'hidden',
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
});
