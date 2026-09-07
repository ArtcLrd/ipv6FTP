import { create } from 'zustand';
import { useEffect } from 'react';

const STORAGE_KEY = 'voipv6_turn_mode';
let memoryTurnMode = 'false';

function getSecureStore() {
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
}

interface TurnModeState {
  turnEnabled: boolean;
  isLoading: boolean;
  hasLoaded: boolean;
  setTurnEnabled: (value: boolean) => Promise<void>;
  load: () => Promise<void>;
}

export const useTurnStore = create<TurnModeState>((set) => ({
  turnEnabled: false,
  isLoading: true,
  hasLoaded: false,
  setTurnEnabled: async (value: boolean) => {
    try {
      const SecureStore = getSecureStore();
      if (SecureStore) {
        await SecureStore.setItemAsync(STORAGE_KEY, value ? 'true' : 'false');
      } else {
        memoryTurnMode = value ? 'true' : 'false';
      }
      set({ turnEnabled: value });
    } catch (error) {
      console.error('Failed to save TURN mode', error);
    }
  },
  load: async () => {
    try {
      const SecureStore = getSecureStore();
      const value = SecureStore
        ? await SecureStore.getItemAsync(STORAGE_KEY)
        : memoryTurnMode;
      set({ turnEnabled: value === 'true', isLoading: false, hasLoaded: true });
    } catch (error) {
      console.error('Failed to load TURN mode', error);
      set({ isLoading: false, hasLoaded: true });
    }
  },
}));

export function useTurnMode() {
  const { turnEnabled, isLoading, hasLoaded, setTurnEnabled, load } = useTurnStore();

  useEffect(() => {
    if (!hasLoaded) {
      load();
    }
  }, [hasLoaded, load]);

  return {
    turnEnabled,
    isLoading,
    setTurnEnabled,
  };
}
