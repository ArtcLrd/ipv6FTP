import { networkManager } from '../core/network/netinfo';
import { nativeVoiceCoordinator } from '../modules/call/nativeVoice';
import { logger } from '../core/logger/logger';

let lastConnectionType: string | undefined = undefined;
let isInitialized = false;

export function initializeNetworkService() {
  if (isInitialized) return;
  isInitialized = true;

  networkManager.subscribe((state) => {
    if (lastConnectionType && lastConnectionType !== state.type && state.isConnected) {
      logger.info(`Network changed from ${lastConnectionType} to ${state.type}. Triggering reconnection...`);
      
      nativeVoiceCoordinator.handleNetworkChange().catch((error) => {
        logger.error('Direct IPv6 reconnection failed', error);
      });
    }
    lastConnectionType = state.type;
  });
}
