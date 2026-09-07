import client from '../../core/api/client';
import { Platform } from 'react-native';
import { storeTokens, clearTokens, getOrCreateInstallationID } from '../../core/storage/secure';
import { useAuthStore } from './store';
import { AuthResponseSchema, CheckUsernameResponseSchema, UserSchema } from '../../core/api/schemas';
import type { User } from '../../core/api/schemas';
import { initializeSignaling, terminateSignaling } from '../../services/signalingService';
import { getOrCreateKeyPair } from '../../crypto/ecdh';
import { sendHeartbeat, uploadPublicKey } from '../phonebook/api';
import { usePromptStore } from '../prompts/store';

async function buildInstallationPayload() {
  const [installationID, keyPair] = await Promise.all([
    getOrCreateInstallationID(),
    getOrCreateKeyPair(),
  ]);
  return {
    identifier_hash: installationID,
    app_instance_id: installationID,
    platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
    public_key: keyPair.publicKey,
  };
}

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
  const guestID = useAuthStore.getState().user?.account_type === 'guest' ? useAuthStore.getState().user?.id : undefined;
  const installation = await buildInstallationPayload();
  const { data: rawData } = await client.post('/api/v1/auth/login', {
    username,
    password,
    guest_principal_id: guestID,
    installation,
  });
  const data = AuthResponseSchema.parse(rawData);
  await storeTokens(data.access_token, data.refresh_token);
  initializeSignaling();
  await initializeOnlinePresence();
  usePromptStore.getState().clearPrompts();
  useAuthStore.getState().setUser(data.user);
  return data.user;
}

export async function checkUsername(username: string): Promise<{ exists: boolean; username: string }> {
  const { data: rawData } = await client.get(
    `/api/v1/auth/check-username?username=${encodeURIComponent(username.trim())}`
  );
  const data = CheckUsernameResponseSchema.parse(rawData);
  return data;
}

export async function register(username: string, password: string): Promise<User> {
  const guestID = useAuthStore.getState().user?.account_type === 'guest' ? useAuthStore.getState().user?.id : undefined;
  const installation = await buildInstallationPayload();
  const { data: rawData } = await client.post('/api/v1/auth/register', {
    username,
    password,
    guest_principal_id: guestID,
    installation,
  });
  const data = AuthResponseSchema.parse(rawData);
  await storeTokens(data.access_token, data.refresh_token);
  initializeSignaling();
  await initializeOnlinePresence();
  usePromptStore.getState().clearPrompts();
  useAuthStore.getState().setUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try { 
    await client.post('/api/v1/auth/logout'); 
  } catch (error) {
    console.warn('Logout request failed, cleaning up local state anyway', error);
  }
  terminateSignaling();
  await clearTokens();
  useAuthStore.getState().clearAuth();
  await bootstrapGuest();
}

export async function getMe(): Promise<User | null> {
  try {
    const { data: rawData } = await client.get('/api/v1/auth/me');
    const data = UserSchema.parse(rawData);
    useAuthStore.getState().setUser(data);
    return data;
  } catch (error) {
    useAuthStore.getState().clearAuth();
    return null;
  }
}

export async function bootstrapGuest(): Promise<User> {
  const installation = await buildInstallationPayload();
  const { data: rawData } = await client.post('/api/v1/auth/guest/bootstrap', { installation });
  const data = AuthResponseSchema.parse(rawData);
  await storeTokens(data.access_token, data.refresh_token);
  useAuthStore.getState().setUser(data.user);
  return data.user;
}
