import React from 'react';
import { GlassButton } from '../GlassButton';
import { TouchableOpacityProps } from 'react-native';

export interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
  rightIcon?: React.ReactNode;
}

export function Button({ title, variant = 'primary', loading, disabled, ...props }: ButtonProps) {
  return (
    <GlassButton
      title={title}
      variant={variant}
      loading={loading}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      {...props}
    />
  );
}
