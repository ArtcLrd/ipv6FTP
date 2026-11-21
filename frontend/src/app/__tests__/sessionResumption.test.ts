import { AppState, type AppStateStatus } from 'react-native';
import { NetInfoStateType } from '@react-native-community/netinfo';
import { observeSessionResumption } from '../bootstrap';
import { networkManager, type NetworkCallback } from '../../core/network/netinfo';
import { reconcileSession } from '../../modules/auth/api';

jest.mock('@sentry/react-native', () => ({}));
jest.mock('../../modules/auth/api', () => ({ reconcileSession: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/networkService', () => ({}));
jest.mock('../../services/authService', () => ({}));

it('reconciles on foreground and confirmed reconnect, and disposes both listeners', () => {
  let stateChange!: (state: AppStateStatus) => void;
  let networkChange!: NetworkCallback;
  const remove = jest.fn();
  const unsubscribe = jest.fn();
  const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateChange = listener;
    return { remove };
  });
  const network = jest.spyOn(networkManager, 'subscribe').mockImplementation((listener) => {
    networkChange = listener;
    return unsubscribe;
  });
  const offline = { type: NetInfoStateType.none, isConnected: false, isInternetReachable: false, details: null } as const;
  const online = { type: NetInfoStateType.other, isConnected: true, isInternetReachable: true, details: { isConnectionExpensive: false } } as const;
  const dispose = observeSessionResumption();
  try {
    stateChange('background');
    networkChange(offline);
    networkChange(online);
    expect(reconcileSession).not.toHaveBeenCalled();

    stateChange('active');
    stateChange('active');
    expect(reconcileSession).toHaveBeenCalledTimes(1);

    networkChange({ ...online, isInternetReachable: false });
    networkChange({ type: NetInfoStateType.unknown, isConnected: null, isInternetReachable: null, details: null });
    networkChange(online);
    networkChange(online);
    expect(reconcileSession).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    appState.mockRestore();
    network.mockRestore();
  }
  expect(remove).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
