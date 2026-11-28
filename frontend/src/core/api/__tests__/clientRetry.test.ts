import axios, { AxiosError, AxiosResponse, CanceledError, InternalAxiosRequestConfig } from 'axios';
import client, { shouldRetrySafeRead } from '../client';
import { useAuthStore } from '../../../modules/auth/store';
import { CredentialStorageError, getTokens, markRefreshUncertain, storeTokens } from '../../storage/secure';
import { refreshCredentials } from '../interceptors';
import { advanceIdentityGeneration, currentIdentityGeneration } from '../../../modules/auth/generation';

jest.mock('../../../config/env', () => ({ API_BASE_URL: 'https://example.test', APP_CONFIG: { TIMEOUT: 10000, RETRY_COUNT: 3 } }));
jest.mock('../../storage/secure', () => ({ getTokens: jest.fn(), markRefreshUncertain: jest.fn(), storeTokens: jest.fn(), clearTokens: jest.fn(), CredentialStorageError: jest.requireActual('../../storage/secure').CredentialStorageError }));

function errorFor(method: string, status?: number): AxiosError {
  const config = { method, headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('request failed', status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK', config, undefined,
    status ? { status, statusText: '', data: {}, headers: {}, config } : undefined);
}

describe('automatic retry policy', () => {
  it.each(['post', 'put', 'patch', 'delete'])('never retries %s on network failures or 5xx', (method) => {
    expect(shouldRetrySafeRead(errorFor(method))).toBe(false);
    expect(shouldRetrySafeRead(errorFor(method, 503))).toBe(false);
  });

  it('retries safe reads on network failures and 5xx, but not authorization errors', () => {
    expect(shouldRetrySafeRead(errorFor('get'))).toBe(true);
    expect(shouldRetrySafeRead(errorFor('get', 503))).toBe(true);
    expect(shouldRetrySafeRead(errorFor('get', 401))).toBe(false);
    expect(shouldRetrySafeRead(errorFor('get', 403))).toBe(false);
    const replay = errorFor('get', 503);
    Object.assign(replay.config!, { _retry: true });
    expect(shouldRetrySafeRead(replay)).toBe(false);
  });
});

it.each(['setup', 'restoring'] as const)('sends enrolled-key bootstrap during %s', async (status) => {
  (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
  useAuthStore.getState().setSessionStatus(status);
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
    expect(client.getUri(config)).toBe('https://example.test/api/v2/auth/bootstrap?include=device_key_fingerprint');
    expect(config.headers.get('Authorization')).toBe('Bearer access');
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  });
  await client.get('/api/v2/auth/bootstrap', { params: { include: 'device_key_fingerprint' }, adapter });
  expect(adapter).toHaveBeenCalledTimes(1);
  jest.clearAllMocks();
});

it('blocks protected requests while offline even if credentials remain in storage', async () => {
  (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'old', refreshToken: 'old-refresh' });
  useAuthStore.getState().setSessionStatus('offline');
  const adapter = jest.fn();
  await expect(client.get('/private', { adapter })).rejects.toThrow('Authenticated session required');
  expect(adapter).not.toHaveBeenCalled();
  expect(getTokens).not.toHaveBeenCalled();
});

it.each(['restricted', 'pending_deletion', 'quota_gated'] as const)('blocks ordinary API requests in %s', async (status) => {
  useAuthStore.getState().setSessionStatus(status);
  const adapter = jest.fn();
  await expect(client.get('/private', { adapter })).rejects.toThrow('Authenticated session required');
  expect(adapter).not.toHaveBeenCalled();
});

it('sends approved public recovery requests while signed out and strips credentials', async () => {
  useAuthStore.getState().clearAuth();
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
    expect(config.headers.has('Authorization')).toBe(false);
    expect(config.auth).toBeUndefined();
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  });
  await client.post('/api/v2/recovery/begin', {}, {
    public: true, headers: { Authorization: 'Bearer old' }, auth: { username: 'a', password: 'b' }, adapter,
  });
  await expect(client.post('/api/v2/account/password', {}, { public: true, adapter })).rejects.toThrow('approved endpoint');
  expect(adapter).toHaveBeenCalledTimes(1);
});

it.each(['identity change', 'caller cancellation'])('cancels a request with its own signal on %s', async (reason) => {
  (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const caller = new AbortController();
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  const adapter = jest.fn((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((_resolve, reject) => {
    started();
    config.signal?.addEventListener?.('abort', () => reject(new CanceledError('cancelled')));
  }));
  const request = client.get('/private', { signal: caller.signal, adapter });
  const rejected = expect(request).rejects.toThrow();
  await dispatched;
  if (reason === 'identity change') advanceIdentityGeneration(); else caller.abort();
  await rejected;
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('removes the caller cancellation listener after a successful request', async () => {
  (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const caller = new AbortController();
  const remove = jest.spyOn(caller.signal, 'removeEventListener');
  await client.get('/private', { signal: caller.signal, adapter: async (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config }) });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('rejects work queued before an identity switch even before its interceptor runs', async () => {
  (getTokens as jest.Mock).mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config }));
  const request = client.get('/private', { adapter });
  advanceIdentityGeneration();
  useAuthStore.getState().setUser({ id: 'two', username: 'bob' });
  await expect(request).rejects.toMatchObject({ name: 'StaleIdentityError' });
  expect(adapter).not.toHaveBeenCalled();
});

it('uses persisted replacement credentials for a late expired read without rotating again', async () => {
  let accessToken = 'old-access';
  (getTokens as jest.Mock).mockImplementation(async () => ({ accessToken, refreshToken: 'refresh' }));
  (markRefreshUncertain as jest.Mock).mockResolvedValue(undefined);
  (storeTokens as jest.Mock).mockImplementation(async (access: string) => { accessToken = access; });
  const refresh = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  let rejectSlow!: () => void;
  let slowStarted!: () => void;
  const started = new Promise<void>((resolve) => { slowStarted = resolve; });
  const counts = new Map<string, number>();
  const adapter = jest.fn((config: InternalAxiosRequestConfig) => {
    const count = (counts.get(config.url!) ?? 0) + 1;
    counts.set(config.url!, count);
    if (count > 1) {
      expect(config.headers.Authorization).toBe('Bearer new-access');
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    }
    const expired = () => new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
      { status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config });
    if (config.url === '/slow') return new Promise<AxiosResponse>((_resolve, reject) => { rejectSlow = () => reject(expired()); slowStarted(); });
    return Promise.reject(expired());
  });
  try {
    const slow = client.get('/slow', { adapter });
    await started;
    await client.get('/fast', { adapter });
    rejectSlow();
    await slow;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(counts.get('/slow')).toBe(2);
  } finally { refresh.mockRestore(); }
});

it('waits for an active rotation before dispatching a new protected request', async () => {
  let accessToken = 'old-access';
  (getTokens as jest.Mock).mockImplementation(async () => ({ accessToken, refreshToken: 'refresh' }));
  (markRefreshUncertain as jest.Mock).mockResolvedValue(undefined);
  (storeTokens as jest.Mock).mockImplementation(async (access: string) => { accessToken = access; });
  let finishRefresh!: (response: any) => void;
  let notifyRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { notifyRefresh = resolve; });
  const refresh = jest.spyOn(axios, 'post').mockImplementation(() => { notifyRefresh(); return new Promise((resolve) => { finishRefresh = resolve; }); });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const calls: string[] = [];
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
    calls.push(config.url!);
    if (config.url === '/first' && config.headers.Authorization === 'Bearer old-access') {
      throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
        { status: 401, statusText: 'Unauthorized', data: { code: 'ACCESS_EXPIRED' }, headers: {}, config });
    }
    expect(config.headers.Authorization).toBe('Bearer new-access');
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  });
  try {
    const first = client.get('/first', { adapter });
    await refreshStarted;
    const second = client.get('/second', { adapter });
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toEqual(['/first']);
    finishRefresh({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
    await Promise.all([first, second]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toContain('/second');
  } finally { refresh.mockRestore(); }
});

it('waits when rotation writes the marker during the request credential read', async () => {
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const reads = getTokens as jest.Mock;
  reads.mockResolvedValue({ accessToken: 'fresh', refreshToken: 'replacement' });
  let rotation!: Promise<void>;
  reads.mockImplementationOnce(async () => {
    rotation = refreshCredentials(currentIdentityGeneration());
    throw new CredentialStorageError('recovery_required');
  });
  reads.mockResolvedValueOnce({ accessToken: 'old', refreshToken: 'old-refresh' });
  (markRefreshUncertain as jest.Mock).mockResolvedValue(undefined);
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'fresh', refresh_token: 'replacement' } });
  try {
    await client.get('/private', { adapter: async (config) => {
      expect(config.headers.Authorization).toBe('Bearer fresh');
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    } });
    await rotation;
    expect(post).toHaveBeenCalledTimes(1);
  } finally { post.mockRestore(); }
});
