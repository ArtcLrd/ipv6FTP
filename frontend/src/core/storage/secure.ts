const ACCESS_KEY = 'ipv6ftp_access_token';
const REFRESH_KEY = 'ipv6ftp_refresh_token';
const BUNDLE_KEY = 'ipv6ftp_credentials_v1';
const PROFILE_REMOVAL_KEY = 'ipv6ftp_profile_removal';
const RETAINED_PROFILE_KEY = 'ipv6ftp_retained_profile_v1';
const INSTALLATION_KEY = 'ipv6ftp_installation_id';
import { assertIdentityGeneration } from '../../modules/auth/generation';

export class CredentialStorageError extends Error {
  constructor(public readonly kind: 'unavailable' | 'partial' | 'corrupt' | 'recovery_required') {
    super(`Credential storage ${kind}`);
    this.name = 'CredentialStorageError';
  }
}

export type SessionMetadata = { version: 2; principalId: string; deviceId: string; sessionId: string; generation: number };
type Tokens = { accessToken: string; refreshToken: string; session?: SessionMetadata };
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

function secureStore(): typeof import('expo-secure-store') {
  try { return require('expo-secure-store'); }
  catch { throw new CredentialStorageError('unavailable'); }
}

async function access<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CredentialStorageError) throw error;
    throw new CredentialStorageError('unavailable');
  }
}

export function storeTokens(accessToken: string, refreshToken: string, generation?: number, session?: SessionMetadata): Promise<void> {
  return serialize(async () => {
    if (generation !== undefined) assertIdentityGeneration(generation);
    await access(async () => {
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !accessToken || !refreshToken) throw new CredentialStorageError('partial');
    await secureStore().setItemAsync(BUNDLE_KEY, JSON.stringify({ version: 1, state: 'active', accessToken, refreshToken, ...(session ? { session } : {}) }));
    });
    if (generation !== undefined) {
      try { assertIdentityGeneration(generation); }
      catch (error) {
        await access(() => secureStore().setItemAsync(BUNDLE_KEY, JSON.stringify({ version: 1, state: 'signed_out' })));
        throw error;
      }
    }
  });
}

export function getTokens(): Promise<Tokens | null> {
  return serialize(() => access(async () => {
    const store = secureStore();
    const raw = await store.getItemAsync(BUNDLE_KEY);
    if (raw !== null) {
      let bundle: unknown;
      try { bundle = JSON.parse(raw); } catch { throw new CredentialStorageError('corrupt'); }
      if (!bundle || typeof bundle !== 'object') throw new CredentialStorageError('corrupt');
      const value = bundle as Record<string, unknown>;
      if (value.version !== 1) throw new CredentialStorageError('corrupt');
      if (value.state === 'signed_out') {
        if (value.cleanupPending === true) await finishCredentialClear(store);
        return null;
      }
      if (value.state === 'refresh_uncertain') throw new CredentialStorageError('recovery_required');
      if (value.state !== 'active' || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || !value.refreshToken) {
        throw new CredentialStorageError('corrupt');
      }
      if (value.session !== undefined) {
        const session = value.session as SessionMetadata | null;
        if (!session || session.version !== 2 || typeof session.principalId !== 'string' || !session.principalId ||
            typeof session.deviceId !== 'string' || !session.deviceId || typeof session.sessionId !== 'string' || !session.sessionId ||
            !Number.isSafeInteger(session.generation) || session.generation < 1) throw new CredentialStorageError('corrupt');
        return { accessToken: value.accessToken, refreshToken: value.refreshToken, session };
      }
      return { accessToken: value.accessToken, refreshToken: value.refreshToken };
    }
    const [accessToken, refreshToken] = await Promise.all([store.getItemAsync(ACCESS_KEY), store.getItemAsync(REFRESH_KEY)]);
    if (!accessToken && !refreshToken) return null;
    if (!refreshToken) throw new CredentialStorageError('partial');
    const tokens = { accessToken: accessToken || '', refreshToken };
    await store.setItemAsync(BUNDLE_KEY, JSON.stringify({ version: 1, state: 'active', ...tokens }));
    await store.deleteItemAsync(ACCESS_KEY);
    await store.deleteItemAsync(REFRESH_KEY);
    return tokens;
  }));
}

export function markRefreshUncertain(generation: number): Promise<void> {
  return serialize(async () => {
    assertIdentityGeneration(generation);
    await access(async () => {
      const store = secureStore();
      const raw = await store.getItemAsync(BUNDLE_KEY);
      let value: unknown;
      try { value = raw === null ? null : JSON.parse(raw); } catch { throw new CredentialStorageError('corrupt'); }
      if (!value || typeof value !== 'object') throw new CredentialStorageError('partial');
      const bundle = value as Record<string, unknown>;
      if (bundle.version !== 1 || bundle.state !== 'active' || typeof bundle.refreshToken !== 'string' || !bundle.refreshToken || typeof bundle.accessToken !== 'string') {
        throw new CredentialStorageError('corrupt');
      }
      await store.setItemAsync(BUNDLE_KEY, JSON.stringify({ ...bundle, state: 'refresh_uncertain' }));
    });
    assertIdentityGeneration(generation);
  });
}

export type ProfileRemoval = { scope: string; username: string };
export type RetainedProfile = ProfileRemoval & { principalId: string };

export function readRetainedProfile(): Promise<RetainedProfile | null> {
  return serialize(() => access(async () => {
    const raw = await secureStore().getItemAsync(RETAINED_PROFILE_KEY);
    if (raw === null) return null;
    let value: any;
    try { value = JSON.parse(raw); } catch { throw new CredentialStorageError('corrupt'); }
    if (value?.version !== 1 || typeof value.principalId !== 'string' || !value.principalId ||
        value.scope !== `principal:${value.principalId}` || typeof value.username !== 'string' || !value.username) {
      throw new CredentialStorageError('corrupt');
    }
    return { principalId: value.principalId, scope: value.scope, username: value.username };
  }));
}

export function writeRetainedProfile(profile: RetainedProfile | null): Promise<void> {
  return serialize(() => access(() => profile
    ? secureStore().setItemAsync(RETAINED_PROFILE_KEY, JSON.stringify({ version: 1, ...profile }))
    : secureStore().deleteItemAsync(RETAINED_PROFILE_KEY)));
}

export function readProfileRemoval(): Promise<ProfileRemoval | null> {
  return serialize(() => access(async () => {
    const raw = await secureStore().getItemAsync(PROFILE_REMOVAL_KEY);
    if (raw === null) return null;
    const intent = JSON.parse(raw);
    if (typeof intent?.scope !== 'string' || !intent.scope || typeof intent.username !== 'string') {
      throw new CredentialStorageError('corrupt');
    }
    return intent;
  }));
}

export function writeProfileRemoval(intent: ProfileRemoval | null): Promise<void> {
  return serialize(() => access(() => intent
    ? secureStore().setItemAsync(PROFILE_REMOVAL_KEY, JSON.stringify(intent))
    : secureStore().deleteItemAsync(PROFILE_REMOVAL_KEY)));
}

export function clearTokens(generation?: number): Promise<void> {
  return serialize(() => access(async () => {
    if (generation !== undefined) assertIdentityGeneration(generation);
    const store = secureStore();
    await store.setItemAsync(BUNDLE_KEY, JSON.stringify({ version: 1, state: 'signed_out', cleanupPending: true }));
    await finishCredentialClear(store);
  }));
}

async function finishCredentialClear(store: ReturnType<typeof secureStore>): Promise<void> {
  await store.deleteItemAsync(ACCESS_KEY);
  await store.deleteItemAsync(REFRESH_KEY);
  await store.setItemAsync(BUNDLE_KEY, JSON.stringify({ version: 1, state: 'signed_out' }));
}

export function getOrCreateInstallationID(): Promise<string> {
  return serialize(() => access(async () => {
    const store = secureStore();
    const existing = await store.getItemAsync(INSTALLATION_KEY);
    if (existing) return existing;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const generated = `app_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    await store.setItemAsync(INSTALLATION_KEY, generated);
    return generated;
  }));
}
