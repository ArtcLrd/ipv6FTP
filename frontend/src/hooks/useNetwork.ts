import { useEffect, useState } from 'react';
import { networkManager } from '../core/network/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';

export function useNetwork() {
  const [state, setState] = useState<NetInfoState | null>(networkManager.getState());

  useEffect(() => {
    return networkManager.subscribe((newState) => {
      setState(newState);
    });
  }, []);

  return {
    state,
    isConnected: state?.isConnected ?? true,
    isInternetReachable: state?.isInternetReachable ?? true,
    type: state?.type,
  };
}
