import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface InlineErrorProps {
  message: string;
  type: 'validation' | 'info' | 'warn';
  visible: boolean;
}

export function InlineError({ message, type, visible }: InlineErrorProps) {
  const opacityAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const heightAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: false, // can't use native for height
      }),
      Animated.timing(heightAnim, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [visible]);

  let iconName: any = 'alert-circle-outline';
  let iconColor = '#f59e0b'; // amber
  let textColor = '#fcd34d'; // light amber
  let bgColor = 'rgba(245, 158, 11, 0.1)';

  if (type === 'info') {
    iconName = 'information-circle-outline';
    iconColor = '#3b82f6';
    textColor = '#93c5fd';
    bgColor = 'rgba(59, 130, 246, 0.1)';
  } else if (type === 'warn') {
    iconName = 'warning-outline';
    iconColor = '#f97316';
    textColor = '#fdba74';
    bgColor = 'rgba(249, 115, 22, 0.1)';
  }

  const maxHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 48],
  });
  const marginVertical = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 4],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: opacityAnim,
          maxHeight,
          marginVertical,
          backgroundColor: bgColor,
          overflow: 'hidden',
        },
      ]}
    >
      <Ionicons name={iconName} size={16} color={iconColor} style={styles.icon} />
      <Text style={[styles.text, { color: textColor }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  icon: {
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
});
