import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetworkCallback = (state: NetInfoState) => void;

class NetworkManager {
  private listeners: Set<NetworkCallback> = new Set();
  private currentState: NetInfoState | null = null;

  constructor() {
    NetInfo.addEventListener((state) => {
      this.currentState = state;
      this.listeners.forEach((callback) => callback(state));
    });
  }

  subscribe(callback: NetworkCallback) {
    this.listeners.add(callback);
    if (this.currentState) {
      callback(this.currentState);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  async isConnected() {
    const state = await NetInfo.fetch();
    return state.isConnected;
  }

  getState() {
    return this.currentState;
  }
}

export const networkManager = new NetworkManager();
