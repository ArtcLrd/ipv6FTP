import Constants from 'expo-constants';

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

const ICE_MODES = ['ipv6-direct', 'stun', 'turn'] as const;
export type IceMode = (typeof ICE_MODES)[number];

const getIceMode = (): IceMode => {
  const configuredMode = process.env.EXPO_PUBLIC_ICE_MODE?.trim().toLowerCase();
  if (ICE_MODES.includes(configuredMode as IceMode)) {
    return configuredMode as IceMode;
  }
  return 'stun';
};

/**
 * EXPO_PUBLIC_BACKEND_URL is the preferred value for ngrok/local backend URLs.
 * EXPO_PUBLIC_API_BASE_URL is kept as a backwards-compatible alias.
 *
 * In development, we use the debugger host to connect to the local backend.
 * This ensures the app works on physical devices on the same Wi-Fi.
 */
const getBaseUrl = () => {
  const configuredUrl =
    process.env.EXPO_PUBLIC_BACKEND_URL?.trim() ||
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredUrl) {
    return normalizeUrl(configuredUrl);
  }

  const debuggerHost = Constants.expoConfig?.hostUri;
  const address = debuggerHost ? debuggerHost.split(':')[0] : 'localhost';
  return `http://${address}:8080`;
};

export const API_BASE_URL = getBaseUrl();
export const BACKEND_URL = API_BASE_URL;
export const WS_URL = API_BASE_URL.replace(/^http/, 'ws');
export const ICE_MODE = getIceMode();

export const APP_CONFIG = {
  TIMEOUT: 10000,
  RETRY_COUNT: 3,
};
