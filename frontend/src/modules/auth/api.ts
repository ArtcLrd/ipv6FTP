import client from '../../core/api/client';
import { storeTokens, clearTokens } from '../../core/storage/secure';
import { useAuthStore } from './store';
import { AuthResponse, User } from './types';
import { initializeSignaling, terminateSignaling } from '../../services/signalingService';
import { getOrCreateKeyPair } from '../../crypto/ecdh';
import { sendHeartbeat, uploadPublicKey } from '../phonebook/api';

async function initializeOnlinePresence() {
  try {
    const keyPair = await getOrCreateKeyPair();
    await uploadPublicKey(keyPair.publicKey);
    await sendHeartbeat();
  } catch (error) {
    console.warn('Presence initialization failed', error);
  }
}

export async function login(username: string, password: string): Promise<User> {
  const { data } = await client.post<AuthResponse>('/api/auth/login', { username, password });
  await storeTokens(data.access_token, data.refresh_token);
  initializeSignaling();
  await initializeOnlinePresence();
  useAuthStore.getState().setUser(data.user);
  return data.user;
}

export async function register(username: string, password: string): Promise<User> {
  const { data } = await client.post<AuthResponse>('/api/auth/register', { username, password });
  await storeTokens(data.access_token, data.refresh_token);
  initializeSignaling();
  await initializeOnlinePresence();
  useAuthStore.getState().setUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try { 
    await client.post('/api/auth/logout'); 
  } catch (error) {
    console.warn('Logout request failed, cleaning up local state anyway', error);
  }
  terminateSignaling();
  await clearTokens();
  useAuthStore.getState().clearAuth();
}

export async function getMe(): Promise<User | null> {
  try {
    const { data } = await client.get<User>('/api/auth/me');
    useAuthStore.getState().setUser(data);
    return data;
  } catch (error) {
    useAuthStore.getState().clearAuth();
    return null;
  }
}
