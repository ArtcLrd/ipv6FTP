import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { BrandColors } from '../theme/colors';
import { ViewGradient } from './ViewGradient';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CELL = 38;

interface GridBackgroundProps {
  children?: React.ReactNode;
}

export function GridBackground({ children }: GridBackgroundProps) {
  const cols = useMemo(() => Math.ceil(SCREEN_W / CELL) + 1, []);
  const rows = useMemo(() => Math.ceil(SCREEN_H / CELL) + 1, []);

  return (
    <View style={styles.root}>
      <ViewGradient
        stops={[
          { offset: 0, color: BrandColors.inkBlack },
          { offset: 0.45, color: BrandColors.inkBlack2 },
          { offset: 0.72, color: '#012a4a' },
          { offset: 1, color: '#013d6b' },
        ]}
      />

      <View style={[StyleSheet.absoluteFillObject, styles.gridContainer]} pointerEvents="none">
        {Array.from({ length: cols }).map((_, i) => (
          <View key={`v-${i}`} style={[styles.vLine, { left: i * CELL }]} />
        ))}
        {Array.from({ length: rows }).map((_, i) => (
          <View key={`h-${i}`} style={[styles.hLine, { top: i * CELL }]} />
        ))}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BrandColors.inkBlack,
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
