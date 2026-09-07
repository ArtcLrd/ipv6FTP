import React, { useMemo } from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';

type ColorStop = {
  offset: number;
  color: string;
};

interface ViewGradientProps {
  stops: ColorStop[];
  steps?: number;
  opacity?: number;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixColor(from: string, to: string, amount: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a.r + (b.r - a.r) * amount);
  const g = Math.round(a.g + (b.g - a.g) * amount);
  const blue = Math.round(a.b + (b.b - a.b) * amount);
  return `rgb(${r}, ${g}, ${blue})`;
}

function colorAt(stops: ColorStop[], offset: number) {
  const sortedStops = [...stops].sort((a, b) => a.offset - b.offset);
  const nextIndex = sortedStops.findIndex((stop) => stop.offset >= offset);

  if (nextIndex <= 0) return sortedStops[0]?.color ?? '#000000';
  if (nextIndex === -1) return sortedStops[sortedStops.length - 1]?.color ?? '#000000';

  const previous = sortedStops[nextIndex - 1];
  const next = sortedStops[nextIndex];
  const span = next.offset - previous.offset || 1;
  return mixColor(previous.color, next.color, (offset - previous.offset) / span);
}

export function ViewGradient({ stops, steps = 48, opacity = 1 }: ViewGradientProps) {
  const bands = useMemo(
    () =>
      Array.from({ length: steps }).map((_, index) => ({
        color: colorAt(stops, steps === 1 ? 0 : index / (steps - 1)),
        top: `${(index / steps) * 100}%` as DimensionValue,
        height: `${100 / steps + 0.5}%` as DimensionValue,
      })),
    [stops, steps],
  );

  return (
    <View style={[StyleSheet.absoluteFillObject, { opacity }]} pointerEvents="none">
      {bands.map((band, index) => (
        <View
          key={`${band.color}-${index}`}
          style={[
            styles.band,
            {
              backgroundColor: band.color,
              top: band.top,
              height: band.height,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
