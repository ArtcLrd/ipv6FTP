import React from 'react';
import { View, TouchableOpacity, StyleSheet, TouchableOpacityProps } from 'react-native';
import { Theme } from '../theme';
import { cn } from '../utils';

interface NeuCardProps extends TouchableOpacityProps {
  children: React.ReactNode;
  pressable?: boolean;
}

export function NeuCard({ children, pressable, onPress, activeOpacity = 0.8, style, ...props }: NeuCardProps) {
  if (pressable) {
    return (
      <TouchableOpacity
        style={cn(styles.card, style)}
        onPress={onPress}
        activeOpacity={activeOpacity}
        {...props}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={cn(styles.card, style)} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Theme.neu.cardSurface,
    borderRadius: Theme.neu.cardRadius,
    borderWidth: 1,
    borderTopColor: Theme.neu.shadowLight,
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomColor: Theme.neu.shadowDark,
    borderRightColor: 'rgba(0, 0, 0, 0.45)',
    // iOS shadow
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    // Android elevation
    elevation: 4,
  },
});
