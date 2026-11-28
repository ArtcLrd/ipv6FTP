import axios from 'axios';
import * as auth from '../api';
import { useAuthStore } from '../store';
import { useUserStore } from '../../user/store';
import { nativeVoiceCoordinator } from '../../call/nativeVoice';
import * as storage from '../../../core/storage/secure';
import client from '../../../core/api/client';
import { queryClient } from '../../../app/providers';
import { refreshCredentials } from '../../../core/api/interceptors';
import { enrollRegisteredDevice } from '../enrollment';
import VoiceEngine from '../../../../modules/voice-engine';
import { useCallStore } from '../../call/store';
import { advanceIdentityGeneration, currentIdentityGeneration } from '../generation';

jest.mock('../../../core/api/client', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
jest.mock('../../../core/api/interceptors', () => ({ refreshCredentials: jest.fn() }));
jest.mock('../../../core/storage/secure', () => ({ readRetainedProfile: jest.fn().mockResolvedValue(null), writeRetainedProfile: jest.fn().mockResolvedValue(undefined), readProfileRemoval: jest.fn().mockResolvedValue(null), writeProfileRemoval: jest.fn().mockResolvedValue(undefined), getTokens: jest.fn(), clearTokens: jest.fn(), storeTokens: jest.fn(), markRefreshUncertain: jest.fn(), getOrCreateInstallationID: jest.fn(), CredentialStorageError: jest.requireActual('../../../core/storage/secure').CredentialStorageError }));
jest.mock('../../../../modules/voice-engine', () => ({ __esModule: true, default: { identityFingerprint: jest.fn().mockResolvedValue('a'.repeat(64)), removeProfile: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../enrollment', () => ({ enrollRegisteredDevice: jest.fn() }));
jest.mock('../../call/nativeVoice', () => ({ nativeVoiceCoordinator: { stopForSessionEnd: jest.fn() } }));
jest.mock('../../../app/providers', () => ({ queryClient: { cancelQueries: jest.fn(), clear: jest.fn() } }));
jest.mock('../../../config/env', () => ({ API_BASE_URL: 'https://example.test' }));

beforeEach(() => {
  advanceIdentityGeneration();
  jest.clearAllMocks();
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
  (storage.clearTokens as jest.Mock).mockResolvedValue(undefined);
  (storage.getOrCreateInstallationID as jest.Mock).mockResolvedValue('install');
  (storage.storeTokens as jest.Mock).mockResolvedValue(undefined);
  (storage.markRefreshUncertain as jest.Mock).mockResolvedValue(undefined);
  (nativeVoiceCoordinator.stopForSessionEnd as jest.Mock).mockResolvedValue(undefined);
  useAuthStore.getState().setUser({ id: 'one', username: 'first' });
});

const enrolledID = '11111111-1111-4111-8111-111111111111';
const enrolledSnapshot = { schema_version: 2, revision: 2, principal_id: enrolledID, device_id: enrolledID,
  session_id: enrolledID, generation: 2, username: 'renamed', account_type: 'registered', account_state: 'active',
  capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) };

function useEnrolledCredentials() {
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session: {
    version: 2, principalId: enrolledID, deviceId: enrolledID, sessionId: enrolledID, generation: 2,
  } });
}

it('shows update guidance when bootstrap returns typed upgrade required', async () => {
  useEnrolledCredentials();
  (client.get as jest.Mock).mockRejectedValueOnce(new axios.AxiosError('upgrade', undefined, undefined, undefined, {
    status: 426, statusText: 'Upgrade Required', headers: {}, config: {} as any,
    data: { error: { code: 'upgrade_required', message: 'Update' } },
  }));
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('upgrade_required');
  expect(storage.clearTokens).not.toHaveBeenCalled();
  await auth.reconcileSession();
  expect(client.get).toHaveBeenCalledTimes(1);
});

it.each(['restricted', 'pending_deletion', 'quota_gated'] as const)('reconciles %s on resume', async (status) => {
  useEnrolledCredentials();
  useAuthStore.getState().setSessionStatus(status);
  (client.get as jest.Mock).mockResolvedValueOnce({ data: enrolledSnapshot });
  await auth.reconcileSession();
  expect(client.get).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().sessionStatus).toBe('authenticated');
});

it('throttles automatic checks but permits manual retry', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValue({ data: enrolledSnapshot });
  await auth.reconcileSession();
  await auth.reconcileSession();
  expect(client.get).toHaveBeenCalledTimes(1);
  await auth.restoreSession();
  expect(client.get).toHaveBeenCalledTimes(2);
});

it('blocks continuation on a stale snapshot until a current snapshot arrives', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, revision: 20 } })
    .mockResolvedValueOnce({ data: { ...enrolledSnapshot, revision: 19, username: 'old' } })
    .mockResolvedValueOnce({ data: { ...enrolledSnapshot, revision: 20 } });
  await auth.restoreSession();
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('offline');
  await auth.restoreSession();
  expect(useAuthStore.getState().user?.username).toBe('renamed');
});

it('continues rejecting stale snapshots across foreground recovery', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, revision: 30 } })
    .mockResolvedValue({ data: { ...enrolledSnapshot, revision: 29 } });
  await auth.restoreSession();
  await auth.reconcileSession();
  expect(useAuthStore.getState().sessionStatus).toBe('offline');
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('offline');
});

it.each(['restricted', 'pending_deletion', 'quota_gated'] as const)('signs out from %s', async (status) => {
  useEnrolledCredentials();
  useAuthStore.getState().setSessionStatus(status);
  const post = jest.spyOn(axios, 'post').mockResolvedValue({});
  try {
    await auth.logout();
    expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
    expect(storage.clearTokens).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('https://example.test/api/v2/auth/logout', {}, expect.any(Object));
  } finally { post.mockRestore(); }
});

it('routes an activation with a mismatched bootstrap to credential cleanup', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  useAuthStore.getState().setSessionStatus('setup');
  (client.post as jest.Mock).mockResolvedValueOnce({});
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, generation: 3 } });
  await expect(auth.activateSetup()).rejects.toThrow();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(storage.clearTokens).toHaveBeenCalled();
});

it('cleans up a session when its bootstrap binding differs', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, generation: 3 } });
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(storage.clearTokens).toHaveBeenCalledTimes(1);
  expect(nativeVoiceCoordinator.stopForSessionEnd).toHaveBeenCalled();
  expect(queryClient.clear).toHaveBeenCalled();
});

it('keeps cleanup retry available when mismatched credentials cannot be cleared', async () => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (storage.clearTokens as jest.Mock).mockRejectedValueOnce(new Error('locked'));
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, generation: 3 } });
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('logout_failed');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it.each([
  ['restricted', {}, 'restricted'],
  ['pending_deletion', {}, 'pending_deletion'],
  ['active', { eligibility: { all_services_gated: true } }, 'quota_gated'],
] as const)('routes verified %s snapshots to %s', async (accountState, extra, expected) => {
  advanceIdentityGeneration();
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, account_state: accountState, ...extra } });
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe(expected);
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('coalesces foreground reconciliation and publishes the current username', async () => {
  useEnrolledCredentials();
  useAuthStore.getState().setUser({ id: enrolledID, username: 'before' });
  const generation = currentIdentityGeneration();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: enrolledSnapshot });
  const first = auth.reconcileSession();
  expect(auth.reconcileSession()).toBe(first);
  await first;
  expect(client.get).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().user?.username).toBe('renamed');
  expect(currentIdentityGeneration()).toBe(generation + 1);
  expect(queryClient.clear).toHaveBeenCalledTimes(1);
});

it.each([{ schema_version: 3 }, { account_type: 'unknown' }])('requires an update for an unsupported snapshot %j', async (change) => {
  useEnrolledCredentials();
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { ...enrolledSnapshot, ...change } });
  await auth.reconcileSession();
  expect(useAuthStore.getState().sessionStatus).toBe('upgrade_required');
  expect(useAuthStore.getState().user).toBeNull();
  expect(nativeVoiceCoordinator.stopForSessionEnd).toHaveBeenCalledTimes(1);
  await auth.reconcileSession();
  expect(client.get).toHaveBeenCalledTimes(1);
});

it.each(['active', 'recovery_setup'] as const)('reconciles an uncertain activation in %s state', async (state) => {
  const id = '11111111-1111-4111-8111-111111111111';
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session: { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 } });
  (client.post as jest.Mock).mockRejectedValueOnce(new axios.AxiosError('Network Error'));
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 2, username: 'alice', account_type: 'registered', account_state: state, capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) } });
  if (state === 'active') await expect(auth.activateSetup()).resolves.toBeUndefined();
  else await expect(auth.activateSetup()).rejects.toThrow('Network Error');
  expect(useAuthStore.getState().sessionStatus).toBe(state === 'active' ? 'authenticated' : 'setup');
});

it('reconciles an activation after a server error', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session: { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 } });
  (client.post as jest.Mock).mockRejectedValueOnce(new axios.AxiosError('Server error', undefined, undefined, undefined, { status: 503, statusText: 'Unavailable', headers: {}, config: {} as any, data: {} }));
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 2, username: 'alice', account_type: 'registered', account_state: 'active', capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) } });
  await expect(auth.activateSetup()).resolves.toBeUndefined();
});

it('stops the call and marks credentials uncertain before a password change', async () => {
  const context = await auth.beginPasswordChange();
  expect(nativeVoiceCoordinator.stopForSessionEnd).toHaveBeenCalledTimes(1);
  expect(storage.markRefreshUncertain).toHaveBeenCalledWith(context.generation);
  expect(useAuthStore.getState().sessionStatus).toBe('password_changing');
  await auth.finishPasswordChange(context.generation, true);
  expect(storage.clearTokens).toHaveBeenCalledWith(context.generation);
  expect(useAuthStore.getState().sessionStatus).toBe('password_changed');
});

it('keeps the session when a password change is definitively rejected', async () => {
  const context = await auth.beginPasswordChange();
  await auth.rejectPasswordChange(context);
  expect(storage.storeTokens).toHaveBeenCalledWith('access', 'refresh', context.generation, undefined);
  expect(useAuthStore.getState().sessionStatus).toBe('authenticated');
});

it('attempts to end an active call before submitting a password change', async () => {
  useCallStore.getState().setCall({ callSessionID: 'call-one', callState: 'active' });
  const post = jest.spyOn(axios, 'post').mockResolvedValue({});
  const context = await auth.beginPasswordChange();
  expect(post).toHaveBeenCalledWith('https://example.test/api/v1/calls/call-one/end',
    { reason: 'session_ended' }, expect.objectContaining({ headers: { Authorization: 'Bearer access' } }));
  await auth.rejectPasswordChange(context);
  useCallStore.getState().resetCall();
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); auth.dismissServerLogoutWarning(); });

it('stops locally and clears private projections before remote logout completes; repeated logout shares work', async () => {
  let finish!: () => void;
  jest.spyOn(axios, 'post').mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
  useUserStore.setState({ currentIP: 'private', searchResults: [] });
  const first = auth.logout();
  const second = auth.logout();
  expect(second).toBe(first);
  expect(nativeVoiceCoordinator.stopForSessionEnd).toHaveBeenCalledTimes(1);
  expect(queryClient.clear).toHaveBeenCalledTimes(1);
  expect(useUserStore.getState().currentIP).toBeNull();
  expect(useAuthStore.getState().sessionStatus).toBe('terminating');
  await Promise.resolve(); await Promise.resolve();
  expect(finish).toBeDefined();
  finish();
  await first;
  expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
});

it('reports unconfirmed remote revocation after the deadline', async () => {
  jest.useFakeTimers();
  jest.spyOn(axios, 'post').mockImplementation(() => new Promise(() => undefined));
  const pending = auth.logout();
  await Promise.resolve(); await Promise.resolve();
  await jest.advanceTimersByTimeAsync(5000);
  await pending;
  expect(useAuthStore.getState().sessionStatus).toBe('logout_unconfirmed');
});

it('gives call-end delivery its bounded window even when revocation settles first', async () => {
  jest.useFakeTimers();
  useCallStore.getState().setCall({ callSessionID: 'active-call' });
  let signal: AbortSignal | undefined;
  jest.spyOn(axios, 'post').mockImplementation((url, _data, config) => {
    if (!url.includes('/calls/')) return Promise.resolve({});
    signal = config?.signal as AbortSignal;
    return new Promise(() => undefined);
  });
  try {
    const logout = auth.logout();
    await jest.advanceTimersByTimeAsync(4999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await logout;
    expect(signal?.aborted).toBe(true);
    expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
  } finally { useCallStore.getState().resetCall(); }
});

it('reports failed durable clearing and does not claim logout completed', async () => {
  (storage.clearTokens as jest.Mock).mockRejectedValue(new Error('locked'));
  jest.spyOn(axios, 'post').mockResolvedValue({});
  await expect(auth.logout()).rejects.toThrow('locked');
  expect(useAuthStore.getState().sessionStatus).toBe('logout_failed');
});

it('reports an unconfirmed local stop after five seconds and permits a retry', async () => {
  jest.useFakeTimers();
  (nativeVoiceCoordinator.stopForSessionEnd as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(undefined);
  jest.spyOn(axios, 'post').mockResolvedValue({});
  const pending = auth.logout();
  const rejected = expect(pending).rejects.toThrow('Native shutdown could not be confirmed');
  await jest.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(storage.clearTokens).toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('logout_failed');
  await auth.logout();
  expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
});

it('allows retrying unconfirmed server revocation without restoring local credentials', async () => {
  const post = jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  await auth.logout();
  expect(useAuthStore.getState().sessionStatus).toBe('logout_unconfirmed');
  await auth.retryServerLogout();
  expect(post).toHaveBeenCalledTimes(2);
  expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
  expect(storage.storeTokens).not.toHaveBeenCalled();
});

it('shares server logout retries and leaves a subsequent sign-in intact', async () => {
  let confirm!: () => void;
  const post = jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise((resolve) => { confirm = () => resolve({}); }));
  await auth.logout();
  const retry = auth.retryServerLogout();
  expect(auth.retryServerLogout()).toBe(retry);
  auth.dismissServerLogoutWarning();
  useAuthStore.getState().setUser({ id: 'two', username: 'later' });
  confirm();
  await retry;
  expect(post).toHaveBeenCalledTimes(2);
  expect(useAuthStore.getState().user?.id).toBe('two');
});

it('rejects a late enrollment response after logout without storing credentials', async () => {
  let finish!: (value: unknown) => void;
  (enrollRegisteredDevice as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  jest.spyOn(axios, 'post').mockResolvedValue({});
  useAuthStore.getState().clearAuth();
  const pending = auth.login('first', 'password');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(finish).toBeDefined();
  await auth.logout();
  finish({ access_token: 'late', refresh_token: 'late' });
  await expect(pending).rejects.toThrow();
  expect(storage.storeTokens).not.toHaveBeenCalled();
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('requires explicit logout before switching accounts', async () => {
  await expect(auth.login('second', 'password')).rejects.toThrow('Log out before');
  expect(client.post).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.username).toBe('first');
});

it('clears old private projections before publishing the newly signed-in account', async () => {
  useAuthStore.getState().clearAuth();
  useUserStore.setState({ currentIP: 'previous-account-ip', searchResults: [] });
  const id = '11111111-2222-4333-8444-555555555555';
  (enrollRegisteredDevice as jest.Mock).mockResolvedValue({ access_token: 'new', refresh_token: 'refresh', principal_id: id, device_id: id, session_id: id, generation: 2, account_state: 'active' });
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'new', refreshToken: 'refresh', session: { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 } });
  (client.get as jest.Mock).mockResolvedValue({ data: { schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 2, username: 'second', account_type: 'registered', account_state: 'active', capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) } });
  await auth.login('second', 'password');
  expect(queryClient.cancelQueries).toHaveBeenCalled();
  expect(queryClient.clear).toHaveBeenCalled();
  expect(useUserStore.getState().currentIP).toBeNull();
  expect(useAuthStore.getState().user?.id).toBe(id);
});

it('keeps a newly enrolled account restricted until recovery setup completes', async () => {
  useAuthStore.getState().clearAuth();
  const id = '11111111-2222-4333-8444-555555555555';
  const session = { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 };
  (enrollRegisteredDevice as jest.Mock).mockResolvedValue({ access_token: 'new', refresh_token: 'refresh', principal_id: id, device_id: id, session_id: id, generation: 2, account_state: 'recovery_setup' });
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'new', refreshToken: 'refresh', session });
  (client.get as jest.Mock).mockResolvedValue({ data: { schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 2, username: 'alice', account_type: 'registered', account_state: 'recovery_setup', capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) } });
  await auth.register('alice', 'a long password');
  expect(storage.storeTokens).toHaveBeenCalledWith('new', 'refresh', expect.any(Number), session);
  expect(useAuthStore.getState().sessionStatus).toBe('setup');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('allows password sign-in after enrollment commits but secure storage fails', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const grant = { principal_id: id, device_id: id, session_id: id, generation: 2,
    access_token: 'new', refresh_token: 'refresh', account_state: 'recovery_setup' };
  const replacement = { ...grant, generation: 3 };
  useAuthStore.getState().clearAuth();
  (enrollRegisteredDevice as jest.Mock).mockResolvedValueOnce(grant).mockResolvedValueOnce(replacement);
  (storage.storeTokens as jest.Mock).mockRejectedValueOnce(new storage.CredentialStorageError('unavailable'));
  await expect(auth.register('alice', 'password')).rejects.toMatchObject({ kind: 'unavailable' });
  expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
  expect(client.get).not.toHaveBeenCalled();
  (storage.getTokens as jest.Mock).mockResolvedValueOnce({ accessToken: 'new', refreshToken: 'refresh',
    session: { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 3 } });
  (client.get as jest.Mock).mockResolvedValueOnce({ data: {
    schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 3,
    username: 'alice', account_type: 'registered', account_state: 'recovery_setup', capabilities: [],
    policy_version: 1, device_key_fingerprint: 'a'.repeat(64),
  } });
  await auth.login('alice', 'password');
  expect(enrollRegisteredDevice).toHaveBeenLastCalledWith('resume', 'alice', 'password');
  expect(useAuthStore.getState().sessionStatus).toBe('setup');
});

it('requires sign-in again when the enrolled native key is missing', async () => {
  const session = { version: 2, principalId: 'principal', deviceId: 'device', sessionId: 'session', generation: 2 };
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session });
  (VoiceEngine.identityFingerprint as jest.Mock).mockResolvedValueOnce(null);
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(client.get).not.toHaveBeenCalled();
});

it('rejects a bootstrap response bound to a different device', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const other = '99999999-2222-4333-8444-555555555555';
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session: { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 } });
  (client.get as jest.Mock).mockResolvedValue({ data: { schema_version: 2, revision: 1, principal_id: id, device_id: other, session_id: id, generation: 2, username: 'alice', account_type: 'registered', account_state: 'active', capabilities: [], policy_version: 1, device_key_fingerprint: 'a'.repeat(64) } });
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('requires sign-in when the installed key differs from the enrolled key', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const session = { version: 2, principalId: id, deviceId: id, sessionId: id, generation: 2 };
  (storage.getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', session });
  (client.get as jest.Mock).mockResolvedValue({ data: {
    schema_version: 2, revision: 1, principal_id: id, device_id: id, session_id: id, generation: 2,
    username: 'alice', account_type: 'registered', account_state: 'active', capabilities: [],
    policy_version: 1, device_key_fingerprint: 'b'.repeat(64),
  } });
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('retains credentials and blocks protected UI when restoration is offline', async () => {
  (client.get as jest.Mock).mockRejectedValue(new axios.AxiosError('offline', 'ERR_NETWORK'));
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe('offline');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
  expect(storage.clearTokens).not.toHaveBeenCalled();
});

it('finishes interrupted profile removal before allowing sign-in', async () => {
  const removal = { scope: 'principal:alice', username: 'alice' };
  (storage.readProfileRemoval as jest.Mock).mockResolvedValueOnce(removal);
  (storage.getTokens as jest.Mock).mockResolvedValueOnce(null);
  await auth.restoreSession();
  expect(storage.clearTokens).toHaveBeenCalled();
  expect(VoiceEngine.removeProfile).toHaveBeenCalledWith(removal.scope, removal.username);
  expect(storage.writeProfileRemoval).toHaveBeenLastCalledWith(null);
  expect(useAuthStore.getState().sessionStatus).toBe('logout_unconfirmed');
});

it('keeps a retained profile when native removal fails and retries cleanup', async () => {
  const profile = { principalId: enrolledID, scope: `principal:${enrolledID}`, username: 'alice' };
  useAuthStore.getState().clearAuth();
  (storage.readRetainedProfile as jest.Mock).mockResolvedValueOnce(profile);
  (VoiceEngine.removeProfile as jest.Mock).mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined);
  (storage.getTokens as jest.Mock).mockResolvedValue(null);
  await expect(auth.removeSignedOutProfile()).rejects.toThrow('locked');
  expect(storage.writeRetainedProfile).not.toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('logout_failed');
  await auth.retryLocalLogout();
  expect(storage.writeRetainedProfile).toHaveBeenCalledWith(null);
  expect(VoiceEngine.removeProfile).toHaveBeenCalledTimes(2);
});

it('does not remove a profile if sign-in begins while its record is being read', async () => {
  useAuthStore.getState().clearAuth();
  let finishRead!: (value: unknown) => void;
  (storage.readRetainedProfile as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  const removal = auth.removeSignedOutProfile();
  const rejected = expect(removal).rejects.toThrow();
  (enrollRegisteredDevice as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined));
  void auth.login('alice', 'password');
  finishRead({ principalId: enrolledID, scope: `principal:${enrolledID}`, username: 'alice' });
  await rejected;
  expect(VoiceEngine.removeProfile).not.toHaveBeenCalled();
  expect(storage.clearTokens).not.toHaveBeenCalled();
});

it('leaves the app signed out when sign-in fails after profile removal', async () => {
  const profile = { principalId: enrolledID, scope: `principal:${enrolledID}`, username: 'alice' };
  useAuthStore.getState().clearAuth();
  (storage.readRetainedProfile as jest.Mock).mockResolvedValueOnce(profile);
  (storage.getTokens as jest.Mock).mockResolvedValue(null);
  await auth.removeSignedOutProfile();
  if (useAuthStore.getState().sessionStatus === 'logout_unconfirmed') auth.dismissServerLogoutWarning();
  (enrollRegisteredDevice as jest.Mock).mockRejectedValueOnce(new Error('wrong password'));
  await expect(auth.login('other', 'wrong')).rejects.toThrow('wrong password');
  expect(useAuthStore.getState().sessionStatus).toBe('signed_out');
});

it('restores refresh-only legacy credentials before loading the profile', async () => {
  (storage.getTokens as jest.Mock).mockResolvedValueOnce({ accessToken: '', refreshToken: 'legacy-refresh' });
  (refreshCredentials as jest.Mock).mockResolvedValueOnce(undefined);
  (client.get as jest.Mock).mockResolvedValueOnce({ data: { id: 'one', username: 'alice' } });
  await auth.restoreSession();
  expect(refreshCredentials).toHaveBeenCalledTimes(1);
  expect(client.get).toHaveBeenCalledWith('/api/v1/auth/me');
  expect(useAuthStore.getState().user?.username).toBe('alice');
});

it.each([
  ['unavailable', 'storage_unavailable'],
  ['partial', 'recovery_required'],
  ['corrupt', 'recovery_required'],
  ['recovery_required', 'recovery_required'],
] as const)('shows %s storage as %s without clearing identity material', async (kind, status) => {
  (storage.getTokens as jest.Mock).mockRejectedValueOnce(new storage.CredentialStorageError(kind));
  await auth.restoreSession();
  expect(useAuthStore.getState().sessionStatus).toBe(status);
  expect(useAuthStore.getState().hasIdentity).toBe(false);
  expect(storage.clearTokens).not.toHaveBeenCalled();
});

it('clears rejected credentials and requires sign-in on confirmed unauthorized restoration', async () => {
  (client.get as jest.Mock).mockRejectedValue(new axios.AxiosError('unauthorized', 'ERR_BAD_REQUEST', undefined, undefined,
    { status: 401, statusText: 'Unauthorized', data: { code: 'SESSION_INVALID' }, headers: {}, config: {} as any }));
  await auth.restoreSession();
  expect(storage.clearTokens).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
});

it('rejects a late profile response after logout', async () => {
  let finish!: (value: unknown) => void;
  (client.get as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  jest.spyOn(axios, 'post').mockResolvedValue({});
  const profile = auth.getMe();
  await auth.logout();
  finish({ data: { id: 'one', username: 'first' } });
  await expect(profile).rejects.toThrow();
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});
