import React, { ReactNode } from 'react';
import { StyleSheet, View, ScrollView, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../theme';
import { cn } from '../utils';

interface ScreenLayoutProps {
  children: ReactNode;
  scrollable?: boolean;
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export function ScreenLayout({
  children,
  scrollable = false,
  header,
  contentStyle,
  style,
}: ScreenLayoutProps) {
  const innerContent = scrollable ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={cn(styles.scrollContent, contentStyle)}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={cn(styles.flexContent, contentStyle)}>{children}</View>
  );

  return (
    <LinearGradient
      colors={[Theme.neu.gradientStart, Theme.neu.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={cn(styles.gradientBg, style)}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {header && <View style={styles.headerContainer}>{header}</View>}
        {innerContent}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientBg: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  headerContainer: {
    width: '100%',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  flexContent: {
    flex: 1,
    padding: 16,
  },
});
