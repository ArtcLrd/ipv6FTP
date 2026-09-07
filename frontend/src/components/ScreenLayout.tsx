import React, { ReactNode } from 'react';
import { StyleSheet, View, ScrollView, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../theme';
import { cn } from '../utils';
import { ViewGradient } from './ViewGradient';

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
    <View style={cn(styles.gradientBg, style)}>
      <ViewGradient
        stops={[
          { offset: 0, color: Theme.neu.gradientStart },
          { offset: 1, color: Theme.neu.gradientEnd },
        ]}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {header && <View style={styles.headerContainer}>{header}</View>}
        {innerContent}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  gradientBg: {
    flex: 1,
    backgroundColor: Theme.neu.gradientStart,
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
