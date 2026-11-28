import { clearTokens, CredentialStorageError, getTokens, markRefreshUncertain, storeTokens, readRetainedProfile, writeRetainedProfile } from '../secure';
import * as SecureStore from 'expo-secure-store';
import { advanceIdentityGeneration } from '../../../modules/auth/generation';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));

const values = new Map<string, string>();
const get = SecureStore.getItemAsync as jest.Mock;
const set = SecureStore.setItemAsync as jest.Mock;
const remove = SecureStore.deleteItemAsync as jest.Mock;

beforeEach(() => {
  values.clear();
  jest.resetAllMocks();
  get.mockImplementation(async (key: string) => values.get(key) ?? null);
  set.mockImplementation(async (key: string, value: string) => { values.set(key, value); });
  remove.mockImplementation(async (key: string) => { values.delete(key); });
});

it('retains the verified profile across logout until explicitly removed', async () => {
  const profile = { principalId: 'account', scope: 'principal:account', username: 'alice' };
  await writeRetainedProfile(profile);
  await clearTokens();
  expect(await readRetainedProfile()).toEqual(profile);
  await writeRetainedProfile(null);
  expect(await readRetainedProfile()).toBeNull();
});

it('rejects malformed retained profiles', async () => {
  values.set('ipv6ftp_retained_profile_v1', JSON.stringify({ version: 1, principalId: 'one', scope: 'principal:other', username: 'alice' }));
  await expect(readRetainedProfile()).rejects.toMatchObject({ kind: 'corrupt' });
});

it('propagates retained-profile write failures', async () => {
  set.mockRejectedValueOnce(new Error('locked'));
  await expect(writeRetainedProfile({ principalId: 'one', scope: 'principal:one', username: 'alice' }))
    .rejects.toMatchObject({ kind: 'unavailable' });
});

it('migrates refresh-only legacy credentials before removing them', async () => {
  values.set('ipv6ftp_refresh_token', 'refresh');
  await expect(getTokens()).resolves.toEqual({ accessToken: '', refreshToken: 'refresh' });
  expect(values.has('ipv6ftp_refresh_token')).toBe(false);
  expect(values.has('ipv6ftp_credentials_v1')).toBe(true);
});

it('preserves legacy credentials when migration storage fails', async () => {
  values.set('ipv6ftp_access_token', 'access');
  values.set('ipv6ftp_refresh_token', 'refresh');
  set.mockRejectedValueOnce(new Error('storage failure'));
  await expect(getTokens()).rejects.toMatchObject({ kind: 'unavailable' });
  expect(values.get('ipv6ftp_access_token')).toBe('access');
  expect(values.get('ipv6ftp_refresh_token')).toBe('refresh');
});

it('does not use legacy credentials after signed-out intent', async () => {
  values.set('ipv6ftp_access_token', 'old');
  values.set('ipv6ftp_refresh_token', 'old-refresh');
  await clearTokens();
  values.set('ipv6ftp_refresh_token', 'old-refresh');
  await expect(getTokens()).resolves.toBeNull();
});

it('finishes interrupted legacy credential deletion before restoring the signed-out state', async () => {
  values.set('ipv6ftp_access_token', 'old');
  values.set('ipv6ftp_refresh_token', 'old-refresh');
  remove.mockRejectedValueOnce(new Error('locked'));
  await expect(clearTokens()).rejects.toMatchObject({ kind: 'unavailable' });
  expect(JSON.parse(values.get('ipv6ftp_credentials_v1')!)).toMatchObject({ state: 'signed_out', cleanupPending: true });
  await expect(getTokens()).resolves.toBeNull();
  expect(values.has('ipv6ftp_access_token')).toBe(false);
  expect(values.has('ipv6ftp_refresh_token')).toBe(false);
  expect(JSON.parse(values.get('ipv6ftp_credentials_v1')!)).toEqual({ version: 1, state: 'signed_out' });
});

it('distinguishes absent, partial, corrupt and unavailable storage', async () => {
  await expect(getTokens()).resolves.toBeNull();
  values.set('ipv6ftp_access_token', 'access');
  await expect(getTokens()).rejects.toMatchObject({ kind: 'partial' });
  values.set('ipv6ftp_credentials_v1', '{');
  await expect(getTokens()).rejects.toMatchObject({ kind: 'corrupt' });
  get.mockRejectedValueOnce(new Error('locked'));
  await expect(getTokens()).rejects.toBeInstanceOf(CredentialStorageError);
});

it('propagates credential write failures', async () => {
  set.mockRejectedValueOnce(new Error('failed'));
  await expect(storeTokens('access', 'refresh')).rejects.toMatchObject({ kind: 'unavailable' });
});

it('persists v2 session binding and retains it through refresh uncertainty', async () => {
  const generation = advanceIdentityGeneration();
  const session = { version: 2 as const, principalId: 'principal', deviceId: 'device', sessionId: 'session', generation: 2 };
  await storeTokens('access', 'refresh', generation, session);
  expect(await getTokens()).toEqual({ accessToken: 'access', refreshToken: 'refresh', session });
  await markRefreshUncertain(generation);
  await storeTokens('new-access', 'new-refresh', generation, session);
  expect(await getTokens()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh', session });
});

it('persists uncertainty and refuses to return the old refresh token after restart', async () => {
  const generation = advanceIdentityGeneration();
  await storeTokens('old-access', 'old-refresh', generation);
  await markRefreshUncertain(generation);
  await expect(getTokens()).rejects.toMatchObject({ kind: 'recovery_required' });
  expect(JSON.parse(values.get('ipv6ftp_credentials_v1')!).state).toBe('refresh_uncertain');
  await storeTokens('new-access', 'new-refresh', generation);
  await expect(getTokens()).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
});

it('does not mark credentials uncertain if the marker write fails', async () => {
  const generation = advanceIdentityGeneration();
  await storeTokens('access', 'refresh', generation);
  set.mockRejectedValueOnce(new Error('locked'));
  await expect(markRefreshUncertain(generation)).rejects.toMatchObject({ kind: 'unavailable' });
  await expect(getTokens()).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
});

it('does not overwrite an uncertain record with malformed refresh credentials', async () => {
  const generation = advanceIdentityGeneration();
  await storeTokens('access', 'refresh', generation);
  await markRefreshUncertain(generation);
  await expect(storeTokens({} as unknown as string, 'new-refresh', generation)).rejects.toMatchObject({ kind: 'partial' });
  await expect(getTokens()).rejects.toMatchObject({ kind: 'recovery_required' });
});

it('tombstones a credential write that finishes after its generation is superseded', async () => {
  const generation = advanceIdentityGeneration();
  let finishWrite!: () => void;
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const blocked = new Promise<void>((resolve) => { finishWrite = resolve; });
  set.mockImplementationOnce(async (key: string, value: string) => {
    notifyStarted();
    await blocked;
    values.set(key, value);
  });
  const write = storeTokens('old-access', 'old-refresh', generation);
  await started;
  advanceIdentityGeneration();
  finishWrite();
  await expect(write).rejects.toMatchObject({ name: 'StaleIdentityError' });
  await expect(getTokens()).resolves.toBeNull();
});

it('finishes logout after an in-flight write and permits only a later identity to persist', async () => {
  const oldGeneration = advanceIdentityGeneration();
  let release!: () => void;
  let notify!: () => void;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  set.mockImplementationOnce(async (key: string, value: string) => {
    notify(); await blocked; values.set(key, value);
  });
  const staleWrite = storeTokens('old-access', 'old-refresh', oldGeneration);
  await started;
  advanceIdentityGeneration();
  const logout = clearTokens();
  release();
  await expect(staleWrite).rejects.toMatchObject({ name: 'StaleIdentityError' });
  await logout;
  expect(JSON.parse(values.get('ipv6ftp_credentials_v1')!).state).toBe('signed_out');
  const nextGeneration = advanceIdentityGeneration();
  await storeTokens('new-access', 'new-refresh', nextGeneration);
  await expect(getTokens()).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
});
