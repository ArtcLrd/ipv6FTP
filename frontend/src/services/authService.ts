import * as authApi from '../modules/auth/api';
import { wsManager } from '../realtime/websocket';
import { getTokens } from '../core/storage/secure';
import { logger } from '../core/logger/logger';
import { initializeSignaling, terminateSignaling } from './signalingService';
import { getOrCreateKeyPair } from '../crypto/ecdh';
import { sendHeartbeat, uploadPublicKey } from '../modules/phonebook/api';

export async function initializeSession() {
  try {
    const user = await authApi.getMe();
    if (user) {
      const tokens = await getTokens();
      if (tokens?.accessToken) {
        initializeSignaling();
        try {
          const keyPair = await getOrCreateKeyPair();
          await uploadPublicKey(keyPair.publicKey);
          await sendHeartbeat();
        } catch (presenceError) {
          logger.warn('Failed to initialize presence', presenceError);
        }
      }
      return user;
    }
  } catch (error) {
    logger.error('Failed to initialize session', error);
  }
  return null;
}

export function terminateSession() {
  terminateSignaling();
  wsManager.disconnect();
}
