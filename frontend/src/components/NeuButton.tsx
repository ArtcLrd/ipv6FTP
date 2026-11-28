import React, { useRef } from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Theme } from '../theme';
import { cn } from '../utils';

interface NeuButtonProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'destructive' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function NeuButton({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  onPress,
  style,
  accessibilityLabel,
}: NeuButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const buttonStyle = [
    styles.btn,
    styles[variant],
    styles[size],
    disabled && styles.disabled,
  ];

  const textStyle = [
    styles.text,
    styles[`text_${variant}` as keyof typeof styles],
    styles[`text_${size}` as keyof typeof styles],
    disabled && styles.text_disabled,
  ];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={cn(buttonStyle, style)}
        accessibilityLabel={accessibilityLabel}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'secondary' ? Theme.colors.textPrimary : '#ffffff'} size="small" />
        ) : (
          <>
            {leftIcon}
            {title ? <Text style={textStyle}>{title}</Text> : null}
            {rightIcon}
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: Theme.neu.buttonRadius,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  primary: {
    backgroundColor: Theme.colors.accent,
    borderColor: Theme.colors.accent,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',
  },
  secondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    borderBottomColor: 'rgba(0, 0, 0, 0.3)',
  },
  destructive: {
    backgroundColor: Theme.colors.danger,
    borderColor: Theme.colors.danger,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',
  },
  icon: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    padding: 8,
  },
  sm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  md: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  lg: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  disabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
  text_primary: {
    color: '#ffffff',
  },
  text_secondary: {
    color: Theme.colors.textPrimary,
  },
  text_destructive: {
    color: '#ffffff',
  },
  text_icon: {
    color: Theme.colors.textPrimary,
  },
  text_sm: {
    fontSize: 12,
  },
  text_md: {
    fontSize: 14,
  },
  text_lg: {
    fontSize: 16,
  },
  text_disabled: {
    color: 'rgba(255, 255, 255, 0.25)',
  },
});
