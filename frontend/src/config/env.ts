import Constants from 'expo-constants';

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

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
    const normalized = normalizeUrl(configuredUrl);
    let parsed: URL;
    try { parsed = new URL(normalized); } catch { throw new Error('Backend URL must be a valid HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Backend URL must be an HTTP(S) origin without credentials or a path.');
    }
    if (!__DEV__ && parsed.protocol !== 'https:') throw new Error('Production requires an HTTPS backend origin.');
    return normalized;
  }

  if (!__DEV__) throw new Error('Production requires an explicit HTTPS backend origin.');

  const debuggerHost = Constants.expoConfig?.hostUri;
  const address = debuggerHost ? debuggerHost.split(':')[0] : 'localhost';
  return `http://${address}:8080`;
};

export const API_BASE_URL = getBaseUrl();
export const BACKEND_URL = API_BASE_URL;
export const WS_URL = API_BASE_URL.replace(/^http/, 'ws');

export const APP_CONFIG = {
  TIMEOUT: 10000,
  RETRY_COUNT: 3,
};
