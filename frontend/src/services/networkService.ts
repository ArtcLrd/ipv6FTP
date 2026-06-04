import { networkManager } from '../core/network/netinfo';
import { wsManager } from '../realtime/websocket';
import { webrtcManager } from '../modules/call/webrtc';
import { logger } from '../core/logger/logger';
import { sendHeartbeat } from '../modules/phonebook/api';

let lastConnectionType: string | undefined = undefined;
let isInitialized = false;

export function initializeNetworkService() {
  if (isInitialized) return;
  isInitialized = true;

  networkManager.subscribe((state) => {
    if (lastConnectionType && lastConnectionType !== state.type && state.isConnected) {
      logger.info(`Network changed from ${lastConnectionType} to ${state.type}. Triggering reconnection...`);
      
      // Reconnect WebSocket
      wsManager.forceReconnect();

      sendHeartbeat().catch((error) => {
        logger.warn('Failed to refresh phonebook heartbeat after network change', error);
      });
      
      // Trigger WebRTC ICE Restart if in a call
      webrtcManager.triggerIceRestart();
    }
    lastConnectionType = state.type;
  });
}
