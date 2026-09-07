import { initializeSession, terminateSession } from '../authService';
import * as authApi from '../../modules/auth/api';
import { wsManager } from '../../realtime/websocket';
import { getTokens } from '../../core/storage/secure';
import { initializeSignaling, terminateSignaling } from '../signalingService';
import { getOrCreateKeyPair } from '../../crypto/ecdh';
import { sendHeartbeat, uploadPublicKey } from '../../modules/phonebook/api';

jest.mock('../../modules/auth/api');
jest.mock('../../realtime/websocket');
jest.mock('../../core/storage/secure');
jest.mock('../signalingService');
jest.mock('../../crypto/ecdh');
jest.mock('../../modules/phonebook/api');
jest.mock('../../core/logger/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeSession', () => {
    it('should initialize presence and signaling when a user has active tokens', async () => {
      const mockUser = { id: 'u-1', username: 'alice' };
      (authApi.getMe as jest.Mock).mockResolvedValue(mockUser);
      (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access-123', refreshToken: 'refresh-123' });
      (getOrCreateKeyPair as jest.Mock).mockResolvedValue({ publicKey: 'pubkey-abc', privateKey: 'privkey-123' });
      (uploadPublicKey as jest.Mock).mockResolvedValue(undefined);
      (sendHeartbeat as jest.Mock).mockResolvedValue(undefined);

      const user = await initializeSession();

      expect(user).toEqual(mockUser);
      expect(authApi.getMe).toHaveBeenCalledTimes(1);
      expect(getTokens).toHaveBeenCalledTimes(1);
      expect(initializeSignaling).toHaveBeenCalledTimes(1);
      expect(getOrCreateKeyPair).toHaveBeenCalledTimes(1);
      expect(uploadPublicKey).toHaveBeenCalledWith('pubkey-abc');
      expect(sendHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('should return null and not initialize signaling/presence if user is null', async () => {
      (authApi.getMe as jest.Mock).mockResolvedValue(null);

      const user = await initializeSession();

      expect(user).toBeNull();
      expect(getTokens).not.toHaveBeenCalled();
      expect(initializeSignaling).not.toHaveBeenCalled();
    });

    it('should handle presence initialization errors gracefully without failing session init', async () => {
      const mockUser = { id: 'u-1', username: 'alice' };
      (authApi.getMe as jest.Mock).mockResolvedValue(mockUser);
      (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access-123', refreshToken: 'refresh-123' });
      (getOrCreateKeyPair as jest.Mock).mockRejectedValue(new Error('Crypto failed'));

      const user = await initializeSession();

      expect(user).toEqual(mockUser);
      expect(initializeSignaling).toHaveBeenCalledTimes(1);
      // KeyPair failed but we didn't throw out of initializeSession
      expect(uploadPublicKey).not.toHaveBeenCalled();
    });
  });

  describe('terminateSession', () => {
    it('should terminate signaling and disconnect WebSocket', () => {
      terminateSession();

      expect(terminateSignaling).toHaveBeenCalledTimes(1);
      expect(wsManager.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
