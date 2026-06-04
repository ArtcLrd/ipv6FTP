import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'ipv6ftp_access_token';
const REFRESH_KEY = 'ipv6ftp_refresh_token';

export async function storeTokens(access: string, refresh: string) {
  try {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  } catch (error) {
    console.error('Failed to store tokens:', error);
  }
}

export async function getTokens() {
  try {
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
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch (error) {
    console.error('Failed to clear tokens:', error);
  }
}
