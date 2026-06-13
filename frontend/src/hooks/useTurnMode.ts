import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'voipv6_turn_mode';

interface TurnModeState {
  turnEnabled: boolean;
  isLoading: boolean;
  setTurnEnabled: (value: boolean) => Promise<void>;
  load: () => Promise<void>;
}

export const useTurnStore = create<TurnModeState>((set) => ({
  turnEnabled: false,
  isLoading: true,
  setTurnEnabled: async (value: boolean) => {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, value ? 'true' : 'false');
      set({ turnEnabled: value });
    } catch (error) {
      console.error('Failed to save TURN mode', error);
    }
  },
  load: async () => {
    try {
      const value = await SecureStore.getItemAsync(STORAGE_KEY);
      set({ turnEnabled: value === 'true', isLoading: false });
    } catch (error) {
      console.error('Failed to load TURN mode', error);
      set({ isLoading: false });
    }
  },
}));

// Initialize load immediately
useTurnStore.getState().load();

export function useTurnMode() {
  const { turnEnabled, isLoading, setTurnEnabled } = useTurnStore();
  return {
    turnEnabled,
    isLoading,
    setTurnEnabled,
  };
}
