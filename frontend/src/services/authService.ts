import * as authApi from '../modules/auth/api';
import { wsManager } from '../realtime/websocket';
import { logger } from '../core/logger/logger';
import { nativeVoiceCoordinator } from '../modules/call/nativeVoice';

export async function initializeSession() {
  return authApi.restoreSession();
}

export function terminateSession() {
  void nativeVoiceCoordinator.stopForSessionEnd();
  wsManager.disconnect();
}
