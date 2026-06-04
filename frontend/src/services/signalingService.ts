import { wsManager } from '../realtime/websocket';
import { webrtcManager } from '../modules/call/webrtc';
import { logger } from '../core/logger/logger';
import { useCallStore } from '../modules/call/store';
import { connectSSE } from '../realtime/sse';

let isInitialized = false;
let sseConnection: any = null;
let unsubscribers: Array<() => void> = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

// Buffer to hold an offer that arrived before the listener was ready
let pendingOffer: { from: string; offer: any } | null = null;

async function requestMicPermission() {
  try {
    const { PermissionsAndroid, Platform } = require('react-native');
    if (Platform.OS === 'android') {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'This app needs access to your microphone for calls.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );
    }
  } catch (e) {
    logger.warn('Failed to request mic permission', e);
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleSSEReconnect() {
  if (!isInitialized || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    sseConnection?.close?.();
    sseConnection = null;
    connectSignalingEvents();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
}

function handleSignalingEvent(event: any) {
  if (event.type === 'call-invite') {
    const payload = event.payload ?? {};
    logger.info('Received call invite', payload);
    useCallStore.getState().setRemoteUser(payload.from_username ?? payload.from_id ?? null);
    useCallStore.getState().setCallState('incoming');
    if (payload.room_id) {
      wsManager.connect(payload.room_id);
    }
  }
}

function connectSignalingEvents() {
  connectSSE(handleSignalingEvent).then((connection) => {
    if (!isInitialized || !connection) return;

    sseConnection = connection;
    reconnectDelay = 1000;
    connection.addEventListener?.('open', () => {
      reconnectDelay = 1000;
      logger.info('SSE connected');
    });
    connection.addEventListener?.('error', (error: any) => {
      logger.warn('SSE connection error, scheduling reconnect', error);
      scheduleSSEReconnect();
    });
  }).catch((error) => {
    logger.warn('Failed to connect SSE, scheduling reconnect', error);
    scheduleSSEReconnect();
  });
}

export function initializeSignaling() {
  if (isInitialized) return;
  isInitialized = true;

  // Request mic permission proactively so it's ready when a call arrives
  requestMicPermission();

  connectSignalingEvents();

  unsubscribers.push(wsManager.on('offer', async (data: any) => {
    const payload = data.payload ?? {};
    const from = useCallStore.getState().remoteUser ?? '';
    logger.info('Received call offer');
    // Store as pending in case UI hasn't registered yet
    pendingOffer = { from, offer: payload.offer };
    webrtcManager.setIncomingOffer(payload.offer);
    if (useCallStore.getState().callState !== 'connecting') {
      useCallStore.getState().setCallState('incoming');
    }
  }));

  unsubscribers.push(wsManager.on('answer', async (data: any) => {
    logger.info('Received call answer');
    await webrtcManager.handleAnswer(data.payload?.answer);
  }));

  unsubscribers.push(wsManager.on('ice-candidate', async (data: any) => {
    await webrtcManager.handleIceCandidate(data.payload?.candidate);
  }));

  unsubscribers.push(wsManager.on('call-ended', () => {
    logger.info('Received call ended');
    webrtcManager.cleanup();
  }));
}

/** Called by CallScreen when it mounts to replay any offer that arrived early */
export function consumePendingOffer() {
  const offer = pendingOffer;
  pendingOffer = null;
  return offer;
}

export function terminateSignaling() {
  clearReconnectTimer();
  sseConnection?.close?.();
  sseConnection = null;
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  isInitialized = false;
  reconnectDelay = 1000;
}
