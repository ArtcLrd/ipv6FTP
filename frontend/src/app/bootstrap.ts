import * as Sentry from '@sentry/react-native';
import { AppState } from 'react-native';
import { initializeNetworkService } from '../services/networkService';
import { initializeSession } from '../services/authService';
import { reconcileSession, reconcileEventSession } from '../modules/auth/api';
import { observeAccountEvents } from '../realtime/accountEvents';
import { networkManager } from '../core/network/netinfo';
import { logger } from '../core/logger/logger';

export function observeSessionResumption(): () => void {
	const stopEvents = observeAccountEvents(reconcileEventSession);
  const reconcile = () => { void reconcileSession().catch(() => undefined); };
  let appState = AppState.currentState;
  const foreground = AppState.addEventListener('change', (next) => {
    const resumed = next === 'active' && appState !== 'active';
    appState = next;
    if (resumed) reconcile();
  });
  let wasOnline: boolean | undefined;
  const unsubscribe = networkManager.subscribe((state) => {
    // An unknown transport state must not erase a confirmed disconnect.
    if (state.isConnected === null && state.isInternetReachable !== false) return;
    const online = state.isConnected === true && state.isInternetReachable !== false;
    const reconnected = wasOnline === false && online;
    wasOnline = online;
    if (reconnected && appState === 'active') reconcile();
  });
  return () => { stopEvents(); foreground.remove(); unsubscribe(); };
}

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
  }
}
