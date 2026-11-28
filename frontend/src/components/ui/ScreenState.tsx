import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../theme';
import { normalizeError } from '../../core/api/appErrors';

interface ScreenStateProps {
  isLoading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function ScreenState({
  isLoading,
  error,
  isEmpty,
  emptyMessage = 'No data available.',
  onRetry,
  children,
}: ScreenStateProps) {
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Theme.colors.accent} />
      </View>
    );
  }

  if (error) {
    const normalized = normalizeError(error);
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Theme.colors.danger} />
        <Text style={styles.errorText}>{normalized.message}</Text>
        {onRetry && (
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading content"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.center}>
        <Ionicons name="folder-open-outline" size={48} color={Theme.colors.textSecondary} />
        <Text style={styles.emptyText}>{emptyMessage}</Text>
        {onRetry && (
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Refresh content"
          >
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.lg,
    backgroundColor: Theme.colors.background,
  },
  errorText: {
    color: '#ffffff',
    fontSize: 15,
    textAlign: 'center',
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
    lineHeight: 22,
  },
  emptyText: {
    color: Theme.colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: Theme.colors.accent,
    borderRadius: Theme.roundness.pill,
    paddingVertical: 12,
    paddingHorizontal: 28,
    minHeight: 44, // Enforce touch target size
    justifyContent: 'center',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
