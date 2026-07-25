import * as Sentry from '@sentry/react-native';
import { initializeNetworkService } from '../services/networkService';
import { initializeSession } from '../services/authService';
import { useAuthStore } from '../modules/auth/store';
import { logger } from '../core/logger/logger';

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry DSN not found, skipping telemetry initialization.');
    return;
  }

  try {
    Sentry.init({
      dsn,
      debug: __DEV__,
      environment: process.env.EXPO_PUBLIC_ENV || (__DEV__ ? 'development' : 'production'),
      tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    });
    logger.info('Sentry telemetry initialized successfully');
  } catch (error) {
    logger.warn('Sentry initialization failed', error);
  }
}

export async function bootstrapApp(): Promise<void> {
  const setLoading = useAuthStore.getState().setLoading;

  // Initialize Sentry monitoring first
  initSentry();

  // Bind network state listeners
  try {
    initializeNetworkService();
  } catch (error) {
    logger.error('Failed to initialize Network Service during bootstrap', error);
  }

  // Restore session if present
  try {
    await initializeSession();
  } catch (error) {
    logger.info('No existing session restored during bootstrap');
  } finally {
    setLoading(false);
  }
}
