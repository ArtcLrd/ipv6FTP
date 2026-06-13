import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

interface PulsingDotProps {
  active: boolean;
  color: string;
  size?: number;   // default 10
  pulse?: boolean; // default true when active
}

export function PulsingDot({ active, color, size = 10, pulse = true }: PulsingDotProps) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!active || !pulse) {
      pulseAnim.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [active, pulse]);

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  };

  if (!active || !pulse) {
    return <View style={dotStyle} />;
  }

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.pulse,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            position: 'absolute',
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
            opacity: pulseAnim.interpolate({
              inputRange: [0.4, 1],
              outputRange: [0.6, 0],
            }),
          },
        ]}
      />
      <View style={dotStyle} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pulse: {
    position: 'absolute',
  },
});
