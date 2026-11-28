import { initializeSession, terminateSession } from '../authService';
import * as authApi from '../../modules/auth/api';
import { wsManager } from '../../realtime/websocket';
import { nativeVoiceCoordinator } from '../../modules/call/nativeVoice';

jest.mock('../../modules/auth/api', () => ({ restoreSession: jest.fn() }));
jest.mock('../../realtime/websocket', () => ({ wsManager: { disconnect: jest.fn() } }));
jest.mock('../../modules/call/nativeVoice', () => ({ nativeVoiceCoordinator: { stopForSessionEnd: jest.fn().mockResolvedValue(undefined) } }));

describe('session service', () => {
  beforeEach(() => jest.clearAllMocks());
  it('delegates restoration and propagates failures', async () => {
    (authApi.restoreSession as jest.Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('failure'));
    await expect(initializeSession()).resolves.toBeUndefined();
    await expect(initializeSession()).rejects.toThrow('failure');
  });
  it('starts local native termination and disconnects the socket', () => {
    terminateSession();
    expect(nativeVoiceCoordinator.stopForSessionEnd).toHaveBeenCalledTimes(1);
    expect(wsManager.disconnect).toHaveBeenCalledTimes(1);
  });
});
