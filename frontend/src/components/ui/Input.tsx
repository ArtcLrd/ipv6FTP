import React from 'react';
import { GlassInput } from '../GlassInput';
import { TextInputProps } from 'react-native';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export function Input({ label, error, ...props }: InputProps) {
  return (
    <GlassInput
      label={label}
      error={error || undefined}
      accessibilityRole="text"
      accessibilityLabel={label || props.placeholder}
      accessibilityHint={error || undefined}
      {...props}
    />
  );
}
