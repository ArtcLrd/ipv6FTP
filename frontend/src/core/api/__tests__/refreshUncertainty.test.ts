import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { setupInterceptors, refreshCredentials, currentCredentialVersion } from '../interceptors';
import { currentIdentityGeneration, advanceIdentityGeneration } from '../../../modules/auth/generation';
import * as storage from '../../storage/secure';
import { useAuthStore } from '../../../modules/auth/store';

jest.mock('../../../config/env', () => ({ API_BASE_URL: 'https://example.test' }));
jest.mock('../../storage/secure', () => ({ getTokens: jest.fn(), storeTokens: jest.fn(), clearTokens: jest.fn(), markRefreshUncertain: jest.fn(), CredentialStorageError: jest.requireActual('../../storage/secure').CredentialStorageError }));
jest.mock('../../../modules/call/nativeVoice', () => ({ nativeVoiceCoordinator: { stopForSessionEnd: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../../services/signalingService', () => ({ terminateSignaling: jest.fn() }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

const getTokens = storage.getTokens as jest.Mock;
const mark = storage.markRefreshUncertain as jest.Mock;
const clear = storage.clearTokens as jest.Mock;

function expiredClient(): AxiosInstance {
  const client = axios.create({
    adapter: async (config) => {
      throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config,
      });
    },
  });
  setupInterceptors(client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  getTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
  mark.mockResolvedValue(undefined);
  clear.mockResolvedValue(undefined);
  (storage.storeTokens as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

it.each(['quota_exhausted', 'pending_operation', 'rate_limited', 'upgrade_required'])('does not refresh for %s', async (code) => {
  const post = jest.spyOn(axios, 'post');
  const client = axios.create({ adapter: async (config) => {
    throw new AxiosError('denied', 'ERR_BAD_REQUEST', config, undefined, {
      status: code === 'pending_operation' ? 409 : code === 'upgrade_required' ? 426 : 429,
      statusText: 'Denied', data: { error: { code, message: 'denied' } }, headers: {}, config,
    });
  } });
  setupInterceptors(client);
  await expect(client.get('/protected')).rejects.toThrow('denied');
  expect(post).not.toHaveBeenCalled();
});

it('shows update guidance when legacy credential renewal is disabled', async () => {
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('Upgrade required', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 426, statusText: 'Upgrade Required', headers: {}, config: {} as InternalAxiosRequestConfig,
    data: { error: { code: 'upgrade_required' } },
  }));
  await expect(refreshCredentials(currentIdentityGeneration())).rejects.toThrow('Upgrade required');
  expect(useAuthStore.getState().sessionStatus).toBe('upgrade_required');
});

it('requires sign-in when activation rejects a superseded session', async () => {
  const client = axios.create({ adapter: async (config) => {
    throw new AxiosError('invalid session', 'ERR_BAD_REQUEST', config, undefined, {
      status: 401, statusText: 'Unauthorized', headers: {}, config,
      data: { error: { code: 'session_invalid', message: 'Sign in required' } },
    });
  } });
  setupInterceptors(client);
  useAuthStore.getState().setSessionStatus('setup');
  await expect(client.post('/api/v2/auth/setup/activate', {})).rejects.toThrow();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(clear).toHaveBeenCalled();
});

it('rotates v2 credentials through the v2 endpoint and preserves their session binding', async () => {
  const session = { version: 2, principalId: 'principal', deviceId: 'device', sessionId: 'session', generation: 2 };
  getTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'old-refresh', session });
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh-token-123', expires_in_seconds: 900 } });
  await refreshCredentials(currentIdentityGeneration());
  expect(post).toHaveBeenCalledWith('https://example.test/api/v2/auth/refresh', { refresh_token: 'old-refresh' }, expect.any(Object));
  expect(storage.storeTokens).toHaveBeenCalledWith('new-access', 'new-refresh-token-123', expect.any(Number), session);
});

it('persists uncertainty before dispatch and preserves it on network failure', async () => {
  const events: string[] = [];
  mark.mockImplementation(async () => { events.push('marker'); });
  jest.spyOn(axios, 'post').mockImplementation(async () => { events.push('dispatch'); throw new AxiosError('offline', 'ERR_NETWORK'); });
  await expect(expiredClient().get('/protected')).rejects.toThrow('offline');
  expect(events).toEqual(['marker', 'dispatch']);
  expect(clear).not.toHaveBeenCalled();
});

it('does not dispatch a refresh when the uncertainty marker cannot be written', async () => {
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  mark.mockRejectedValue(new storage.CredentialStorageError('unavailable'));
  const post = jest.spyOn(axios, 'post');
  await expect(expiredClient().get('/protected')).rejects.toThrow('storage unavailable');
  expect(post).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('storage_unavailable');
});

it('lets an expired read cancel while the shared replacement is being persisted', async () => {
  const caller = new AbortController();
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  let finishWrite!: () => void;
  let writing!: () => void;
  const writeStarted = new Promise<void>((resolve) => { writing = resolve; });
  (storage.storeTokens as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishWrite = resolve;
    writing();
  }));
  const version = currentCredentialVersion();
  const read = expiredClient().get('/protected', { signal: caller.signal });
  const rejected = expect(read).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  await writeStarted;
  const rotation = refreshCredentials(currentIdentityGeneration());
  expect(currentCredentialVersion()).toBe(version);
  caller.abort();
  try { await rejected; }
  finally { finishWrite(); }
  await rotation;
  expect(currentCredentialVersion()).toBe(version + 1);
  expect(storage.storeTokens).toHaveBeenCalledTimes(1);
});

it('shares one rotation among concurrent callers and applies the deadline', async () => {
  let complete!: (value: any) => void;
  const post = jest.spyOn(axios, 'post').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const generation = currentIdentityGeneration();
  const first = refreshCredentials(generation);
  const second = refreshCredentials(generation);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][2]).toMatchObject({ timeout: 10000 });
  complete({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  await Promise.all([first, second]);
  expect(storage.storeTokens).toHaveBeenCalledTimes(1);
});

it('retries concurrent expired reads once after one shared rotation', async () => {
  let finishRefresh!: (response: any) => void;
  let dispatched!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { dispatched = resolve; });
  const post = jest.spyOn(axios, 'post').mockImplementation(() => { dispatched(); return new Promise((resolve) => { finishRefresh = resolve; }); });
  const counts = new Map<string, number>();
  const client = axios.create({ adapter: async (config) => {
    const url = config.url!;
    const count = (counts.get(url) ?? 0) + 1;
    counts.set(url, count);
    if (count === 1) throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
      { status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config });
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  } });
  setupInterceptors(client);
  const first = client.get('/one');
  const second = client.get('/two');
  await refreshStarted;
  finishRefresh({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(post).toHaveBeenCalledTimes(1);
  expect(counts.get('/one')).toBe(2);
  expect(counts.get('/two')).toBe(2);
});

it('does not replay a mutation after refreshing its expired session', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
      { status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config });
  });
  const client = axios.create({ adapter });
  setupInterceptors(client);
  await expect(client.post('/mutation', { value: 1 })).rejects.toThrow('expired');
  expect(post).toHaveBeenCalledTimes(1);
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('does not rotate again when an old expired response arrives after rotation', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  let rejectSlow!: () => void;
  const counts = new Map<string, number>();
  const client = axios.create({ adapter: (config) => {
    const count = (counts.get(config.url!) ?? 0) + 1;
    counts.set(config.url!, count);
    if (count > 1) return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    const expired = () => new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
      { status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config });
    if (config.url === '/slow') return new Promise((_resolve, reject) => { rejectSlow = () => reject(expired()); });
    return Promise.reject(expired());
  } });
  setupInterceptors(client);
  const version = currentCredentialVersion();
  const slow = client.get('/slow', { credentialVersion: version } as any);
  await client.get('/fast', { credentialVersion: version } as any);
  rejectSlow();
  await expect(slow).resolves.toMatchObject({ status: 200 });
  expect(post).toHaveBeenCalledTimes(1);
  expect(counts.get('/slow')).toBe(2);
});

it('does not persist a refresh response after the identity changes', async () => {
  let complete!: (value: any) => void;
  jest.spyOn(axios, 'post').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const pending = refreshCredentials(currentIdentityGeneration());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  advanceIdentityGeneration();
  complete({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  await expect(pending).rejects.toThrow();
  expect(storage.storeTokens).not.toHaveBeenCalled();
});

it('does not dispatch a refresh when logout supersedes an in-progress marker write', async () => {
  let finish!: () => void;
  let started!: () => void;
  const markerStarted = new Promise<void>((resolve) => { started = resolve; });
  mark.mockImplementation(() => { started(); return new Promise<void>((resolve) => { finish = resolve; }); });
  const post = jest.spyOn(axios, 'post');
  const pending = refreshCredentials(currentIdentityGeneration());
  await markerStarted;
  advanceIdentityGeneration();
  finish();
  await expect(pending).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
  expect(storage.storeTokens).not.toHaveBeenCalled();
});

it('requires reauthentication and retains the uncertain marker when replacement persistence fails', async () => {
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  (storage.storeTokens as jest.Mock).mockRejectedValueOnce(new Error('secure storage unavailable'));
  await expect(refreshCredentials(currentIdentityGeneration())).rejects.toThrow('secure storage unavailable');
  expect(mark).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
});

it('requires reauthentication when a refresh response times out after dispatch', async () => {
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED'));
  await expect(refreshCredentials(currentIdentityGeneration())).rejects.toThrow('timeout');
  expect(mark).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
});

it('retains uncertainty without writing a malformed legacy refresh response', async () => {
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access' } });
  await expect(refreshCredentials(currentIdentityGeneration())).rejects.toThrow('Invalid refresh response');
  expect(storage.storeTokens).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
});

it('blocks authorization immediately when a rejected refresh cannot be cleared', async () => {
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const config = { headers: {} } as any;
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined,
    { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config }));
  let finish!: (reason: Error) => void;
  clear.mockImplementationOnce(() => new Promise((_resolve, reject) => { finish = reject; }));
  const pending = refreshCredentials(currentIdentityGeneration());
  const rejected = expect(pending).rejects.toThrow('locked');
  // The refresh pipeline awaits storage and the HTTP layer before it blocks
  // authorization, so flush a full macrotask rather than a fixed microtask count.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
  finish(new Error('locked'));
  await rejected;
  expect(useAuthStore.getState().sessionStatus).toBe('storage_unavailable');
});

it('rejects a successful protected response from an older identity generation', async () => {
  let finish!: (response: any) => void;
  const client = axios.create({ adapter: (config) => new Promise((resolve) => { finish = () => resolve({ data: { private: true }, status: 200, statusText: 'OK', headers: {}, config }); }) });
  setupInterceptors(client);
  const request = client.get('/private', { identityGeneration: currentIdentityGeneration() } as any);
  const rejected = expect(request).rejects.toMatchObject({ name: 'StaleIdentityError' });
  advanceIdentityGeneration();
  finish({});
  await rejected;
});

it('invalidates concurrent successful work when another request confirms an invalid session', async () => {
  let finish!: () => void;
  const client = axios.create({ adapter: (config) => {
    if (config.url === '/invalid') {
      return Promise.reject(new AxiosError('invalid', 'ERR_BAD_REQUEST', config, undefined,
        { status: 401, statusText: 'Unauthorized', data: { code: 'SESSION_INVALID' }, headers: {}, config }));
    }
    return new Promise((resolve) => { finish = () => resolve({ data: { private: true }, status: 200, statusText: 'OK', headers: {}, config }); });
  } });
  setupInterceptors(client);
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const generation = currentIdentityGeneration();
  const late = client.get('/me', { identityGeneration: generation } as any);
  const rejected = expect(late).rejects.toMatchObject({ name: 'StaleIdentityError' });
  await expect(client.get('/invalid', { identityGeneration: generation } as any)).rejects.toThrow();
  finish();
  await rejected;
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
  expect(useAuthStore.getState().hasIdentity).toBe(false);
});

it('invalidates concurrent successful work when a dispatched refresh becomes uncertain', async () => {
  let finish!: () => void;
  const client = axios.create({ adapter: (config) => new Promise((resolve) => { finish = () => resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }); }) });
  setupInterceptors(client);
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const generation = currentIdentityGeneration();
  const late = client.get('/me', { identityGeneration: generation } as any);
  const rejected = expect(late).rejects.toMatchObject({ name: 'StaleIdentityError' });
  jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('offline', 'ERR_NETWORK'));
  await expect(refreshCredentials(generation)).rejects.toThrow('offline');
  finish();
  await rejected;
  expect(useAuthStore.getState().sessionStatus).toBe('recovery_required');
});
