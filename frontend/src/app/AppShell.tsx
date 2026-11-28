import React from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from './ErrorBoundary';
import { RootNavigator } from '../navigation';
import { ToastNotification } from '../components/ToastNotification';

export function AppShell() {
  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <RootNavigator />
        <ToastNotification />
        <StatusBar style="light" />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
