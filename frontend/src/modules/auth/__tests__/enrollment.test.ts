import VoiceEngine from '../../../../modules/voice-engine';
import client from '../../../core/api/client';
import { enrollRegisteredDevice } from '../enrollment';
import { advanceIdentityGeneration } from '../generation';
import { readRetainedProfile } from '../../../core/storage/secure';

jest.mock('../../../../modules/voice-engine', () => ({
  beginEnrollmentProof: jest.fn(),
  finishEnrollmentProof: jest.fn(),
  cancelEnrollmentProof: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../core/api/client', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../../config/env', () => ({ API_BASE_URL: 'https://example.test' }));
jest.mock('../../../core/storage/secure', () => ({ readRetainedProfile: jest.fn().mockResolvedValue(null), writeRetainedProfile: jest.fn().mockResolvedValue(undefined) }));

const principal = '11111111-2222-4333-8444-555555555555';
const challenge = '99999999-2222-4333-8444-555555555555';
const grant = {
  principal_id: principal, device_id: principal, session_id: principal,
  generation: 2, account_state: 'recovery_setup',
  access_token: 'access', refresh_token: 'abcdefghijklmnop', expires_in_seconds: 900,
};
const post = client.post as jest.Mock;
const begin = VoiceEngine.beginEnrollmentProof as jest.Mock;
const finish = VoiceEngine.finishEnrollmentProof as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (readRetainedProfile as jest.Mock).mockResolvedValue(null);
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/resume')) return { data: { setup_grant: 'setup', expires_in_seconds: 900 } };
    if (path.endsWith('/challenge')) return { data: {
      challenge_id: challenge, principal_id: principal, nonce: 'A'.repeat(43),
      server_key_id: 'k1', expires_in_seconds: 120,
    } };
    return { data: { handshake: 'A'.repeat(64) } };
  });
  (client.get as jest.Mock).mockResolvedValue({ data: { key_id: 'k1', public_key: 'A'.repeat(43) } });
  begin.mockResolvedValue('A'.repeat(128));
  finish.mockResolvedValue(JSON.stringify(grant));
});

it('rejects a different principal before native proof', async () => {
  (readRetainedProfile as jest.Mock).mockResolvedValue({ principalId: challenge, scope: `principal:${challenge}`, username: 'old' });
  await expect(enrollRegisteredDevice('resume', 'alice', 'password')).rejects.toThrow('Remove the current profile');
  expect(begin).not.toHaveBeenCalled();
});

it('allows the retained principal to enroll after a username change', async () => {
  (readRetainedProfile as jest.Mock).mockResolvedValue({ principalId: principal, scope: `principal:${principal}`, username: 'old' });
  await expect(enrollRegisteredDevice('resume', 'newname', 'password')).resolves.toEqual(grant);
  expect(begin).toHaveBeenCalledTimes(1);
});

it('requires profile removal before registration', async () => {
  (readRetainedProfile as jest.Mock).mockResolvedValue({ principalId: principal, scope: `principal:${principal}`, username: 'old' });
  await expect(enrollRegisteredDevice('register', 'newname', 'password')).rejects.toThrow('Remove the current profile');
  expect(post).not.toHaveBeenCalled();
});

it('returns the scoped grant after native proof and marks all proof requests public', async () => {
  await expect(enrollRegisteredDevice('resume', 'Alice', 'password')).resolves.toEqual(grant);
  expect(begin).toHaveBeenCalledWith(expect.objectContaining({ challengeId: challenge, principalId: principal, legacyScope: 'alice' }));
  expect(post).toHaveBeenCalledWith('/api/v2/auth/enroll/finish', {
    challenge_id: challenge, handshake: 'A'.repeat(128),
  }, expect.objectContaining({ public: true }));
  expect(finish).toHaveBeenCalledWith(challenge, 'A'.repeat(64));
  expect(VoiceEngine.cancelEnrollmentProof).toHaveBeenCalledWith(challenge);
});

it('discards a proof superseded by an identity change before submitting it', async () => {
  begin.mockImplementationOnce(async () => {
    advanceIdentityGeneration();
    return 'A'.repeat(128);
  });
  await expect(enrollRegisteredDevice('resume', 'alice', 'password')).rejects.toMatchObject({ name: 'StaleIdentityError' });
  expect(post.mock.calls.map(([path]) => path)).not.toContain('/api/v2/auth/enroll/finish');
  expect(VoiceEngine.cancelEnrollmentProof).toHaveBeenCalledWith(challenge);
});

it('rejects a grant belonging to a different principal', async () => {
  finish.mockResolvedValueOnce(JSON.stringify({ ...grant, principal_id: challenge }));
  await expect(enrollRegisteredDevice('resume', 'alice', 'password')).rejects.toThrow('Enrollment account changed');
});
