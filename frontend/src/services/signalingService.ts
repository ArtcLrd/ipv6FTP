import { wsManager } from '../realtime/websocket';

// Call setup signaling is scoped to NativeVoiceCoordinator and starts only after consent.
export function initializeSignaling() {}

export function terminateSignaling() {
  wsManager.disconnect();
}

export function consumePendingOffer() {
  return null;
}
