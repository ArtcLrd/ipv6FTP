import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { Theme } from '../theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside ErrorBoundary:', error, errorInfo);
    try {
      Sentry.captureException(error, { extra: { errorInfo } });
    } catch (err) {
      // Sentry might not be initialized
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              An unexpected error occurred. We have logged this error and are looking into it.
            </Text>
            {__DEV__ && this.state.error && (
              <View style={styles.devError}>
                <Text style={styles.devErrorText}>{this.state.error.toString()}</Text>
              </View>
            )}
            <TouchableOpacity 
              style={styles.button} 
              onPress={this.handleReset}
              accessibilityRole="button"
              accessibilityLabel="Try loading the screen again"
            >
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.md,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.roundness.md,
    padding: Theme.spacing.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.lg,
  },
  devError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: Theme.roundness.sm,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
    width: '100%',
  },
  devErrorText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: Theme.colors.danger,
  },
  button: {
    backgroundColor: Theme.colors.accent,
    borderRadius: Theme.roundness.pill,
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    minHeight: 44, // enforce touch target size
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
