const ACCESS_KEY = 'ipv6ftp_access_token';
const REFRESH_KEY = 'ipv6ftp_refresh_token';
const memoryStore = new Map<string, string>();

function getSecureStore() {
  try {
    return require('expo-secure-store');
  } catch (error) {
    console.warn('SecureStore native module is not available; using in-memory fallback.', error);
    return null;
  }
}

export async function storeTokens(access: string, refresh: string) {
  try {
    const SecureStore = getSecureStore();
    if (!SecureStore) {
      memoryStore.set(ACCESS_KEY, access);
      memoryStore.set(REFRESH_KEY, refresh);
      return;
    }

    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  } catch (error) {
    console.error('Failed to store tokens:', error);
  }
}

export async function getTokens() {
  try {
    const SecureStore = getSecureStore();
    if (!SecureStore) {
      const accessToken = memoryStore.get(ACCESS_KEY);
      const refreshToken = memoryStore.get(REFRESH_KEY);
      if (!accessToken || !refreshToken) return null;
      return { accessToken, refreshToken };
    }

    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch (error) {
    console.error('Failed to get tokens:', error);
    return null;
  }
}

export async function clearTokens() {
  try {
    const SecureStore = getSecureStore();
    if (!SecureStore) {
      memoryStore.delete(ACCESS_KEY);
      memoryStore.delete(REFRESH_KEY);
      return;
    }

    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch (error) {
    console.error('Failed to clear tokens:', error);
  }
}
