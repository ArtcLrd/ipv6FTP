import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, TouchableOpacityProps } from 'react-native';
import { Theme } from '../theme';
import { cn } from '../utils';

interface GlassButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
}

export function GlassButton({ title, variant = 'primary', loading, disabled, style, ...props }: GlassButtonProps) {
  const isButtonDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={cn(
        styles.button,
        styles[variant],
        isButtonDisabled && styles.disabled,
        style
      )}
      disabled={isButtonDisabled}
      activeOpacity={0.7}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'secondary' ? Theme.colors.textPrimary : '#fff'} />
      ) : (
        <Text style={cn(styles.text, styles[`text_${variant}` as keyof typeof styles])}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: Theme.roundness.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.lg,
    flexDirection: 'row',
    width: '100%',
    marginVertical: Theme.spacing.xs,
  },
  primary: {
    backgroundColor: Theme.colors.accent,
  },
  secondary: {
    backgroundColor: 'rgba(52, 58, 62, 0.4)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  destructive: {
    backgroundColor: Theme.colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  text_primary: {
    color: '#0f1418', // Contrast with accent
  },
  text_secondary: {
    color: Theme.colors.textPrimary,
  },
  text_destructive: {
    color: '#ffffff',
  },
});
