import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getAvatarColors, getInitials } from '../utils';

interface AvatarProps {
  username: string;
  size?: number;
}

export function Avatar({ username, size = 48 }: AvatarProps) {
  const colors = getAvatarColors(username);
  const initials = getInitials(username);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.start,
          borderColor: colors.end,
          borderWidth: 1.5,
        },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.4, lineHeight: size }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  text: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
