import type { NetInfoState } from '@react-native-community/netinfo';
import { logger } from '../logger/logger';

export type NetworkCallback = (state: NetInfoState) => void;

const fallbackState = {
  type: 'unknown',
  isConnected: true,
  isInternetReachable: true,
  details: null,
} as unknown as NetInfoState;

function getNetInfo() {
  try {
    return require('@react-native-community/netinfo').default;
  } catch (error) {
    logger.warn('NetInfo native module is not available; using fallback network state.', error);
    return null;
  }
}

class NetworkManager {
  private listeners: Set<NetworkCallback> = new Set();
  private currentState: NetInfoState | null = null;
  private nativeUnsubscribe: (() => void) | null = null;
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    const NetInfo = getNetInfo();
    if (!NetInfo?.addEventListener) {
      this.currentState = fallbackState;
      return;
    }

    this.nativeUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      this.currentState = state;
      this.listeners.forEach((callback) => callback(state));
    });
  }

  subscribe(callback: NetworkCallback) {
    this.ensureInitialized();
    this.listeners.add(callback);
    callback(this.currentState ?? fallbackState);

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.nativeUnsubscribe?.();
        this.nativeUnsubscribe = null;
        this.initialized = false;
      }
    };
  }

  async isConnected() {
    this.ensureInitialized();
    const NetInfo = getNetInfo();
    if (!NetInfo?.fetch) return true;

    const state = await NetInfo.fetch();
    return state.isConnected;
  }

  getState() {
    return this.currentState ?? fallbackState;
  }
}

export const networkManager = new NetworkManager();
