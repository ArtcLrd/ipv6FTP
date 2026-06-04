import React, { useState } from 'react';
import { TextInput, TextInputProps, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Theme } from '../theme';
import { cn } from '../utils';
import { Ionicons } from '@expo/vector-icons';

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function GlassInput({ label, error, style, onFocus, onBlur, secureTextEntry, ...props }: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isSecure, setIsSecure] = useState(true);

  return (
    <View style={styles.container}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View
        style={cn(
          styles.inputWrapper,
          isFocused && styles.inputWrapperFocused,
          !!error && styles.inputWrapperError,
          style
        )}
      >
        <TextInput
          style={styles.input}
          placeholderTextColor={Theme.colors.textSecondary}
          secureTextEntry={secureTextEntry ? isSecure : false}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={() => setIsSecure(!isSecure)}
            style={styles.iconButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isSecure ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Theme.colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Theme.spacing.md,
    width: '100%',
  },
  label: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.xs,
    fontWeight: '500',
  },
  inputWrapper: {
    height: 48,
    backgroundColor: 'rgba(23, 28, 32, 0.4)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.roundness.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  inputWrapperFocused: {
    borderColor: Theme.colors.accent,
    backgroundColor: 'rgba(23, 28, 32, 0.65)',
  },
  inputWrapperError: {
    borderColor: Theme.colors.danger,
  },
  input: {
    flex: 1,
    height: '100%',
    color: Theme.colors.textPrimary,
    fontSize: 16,
    padding: 0,
  },
  iconButton: {
    paddingLeft: Theme.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  errorText: {
    fontSize: 12,
    color: Theme.colors.danger,
    marginTop: Theme.spacing.xs,
  },
});
