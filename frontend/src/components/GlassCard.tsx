import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { cn } from '../utils';

interface GlassCardProps extends ViewProps {
  children: React.ReactNode;
}

export function GlassCard({ children, style, ...props }: GlassCardProps) {
  return (
    <View style={cn(styles.card, style)} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...Theme.glass,
  },
});
