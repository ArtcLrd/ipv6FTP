import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { CredentialStorageError, getTokens } from '../storage/secure';
import { API_BASE_URL, APP_CONFIG } from '../../config/env';
import { currentCredentialVersion, setupInterceptors, waitForActiveRefresh } from './interceptors';
import { assertIdentityGeneration, currentIdentityGeneration, identitySignal } from '../../modules/auth/generation';
import { useAuthStore } from '../../modules/auth/store';

declare module 'axios' {
  interface AxiosRequestConfig {
    public?: boolean;
  }
}

const publicPostPaths = new Set([
  '/api/v2/recovery/begin',
  '/api/v2/recovery/prove',
  '/api/v2/recovery/complete',
  '/api/v2/auth/registered/begin',
  '/api/v2/auth/setup/resume',
  '/api/v2/auth/enroll/challenge',
  '/api/v2/auth/enroll/finish',
]);
const setupPaths = new Set([
  '/api/v2/auth/bootstrap', '/api/v2/account/reauth', '/api/v2/account/recovery-codes',
  '/api/v2/auth/setup/ack-recovery-codes', '/api/v2/auth/setup/activate', '/api/v2/auth/logout',
]);

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: APP_CONFIG.TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

type ManagedRequest = { identityGeneration?: number; credentialVersion?: number; cleanupIdentitySignal?: () => void; _retry?: boolean };

// Remove cancellation listeners when a request settles, including before a retry.
client.interceptors.response.use(
  (response) => { (response.config as ManagedRequest).cleanupIdentitySignal?.(); return response; },
  (error) => { (error.config as ManagedRequest | undefined)?.cleanupIdentitySignal?.(); return Promise.reject(error); },
);

// Register interceptors
setupInterceptors(client);

// Inject Bearer token on every request
client.interceptors.request.use(async (config) => {
  const request = config as typeof config & ManagedRequest;
  if (request.identityGeneration === undefined) request.identityGeneration = currentIdentityGeneration();
  assertIdentityGeneration(request.identityGeneration);
  const bindCancellation = () => {
    const sessionSignal = identitySignal();
    const callerSignal = config.signal;
    if (!callerSignal) { config.signal = sessionSignal; return; }
    if (callerSignal === sessionSignal) return;
    const combined = new AbortController();
    const abort = () => combined.abort();
    if (callerSignal.aborted || sessionSignal.aborted) abort();
    else {
      callerSignal.addEventListener?.('abort', abort, { once: true });
      sessionSignal.addEventListener('abort', abort, { once: true });
      request.cleanupIdentitySignal = () => {
        callerSignal.removeEventListener?.('abort', abort);
        sessionSignal.removeEventListener('abort', abort);
        config.signal = callerSignal;
        delete request.cleanupIdentitySignal;
      };
    }
    config.signal = combined.signal;
  };
  const path = config.url ?? '';
  if (config.public) {
    const approved = (config.method === 'post' && publicPostPaths.has(path)) ||
      (config.method === 'get' && path === '/api/v2/auth/server-key');
    if (config.baseURL !== API_BASE_URL || !approved) {
      throw new Error('Public requests require an approved endpoint');
    }
    config.headers.delete('Authorization');
    config.auth = undefined;
    bindCancellation();
    return config;
  }
  if (path.includes('/api/v1/auth/login') || path.includes('/api/v1/auth/register') || path.includes('/api/v1/auth/check-username')) { bindCancellation(); return config; }
  const status = useAuthStore.getState().sessionStatus;
  const allowed = (state: string) => state === 'authenticated' ||
    (state === 'setup' && setupPaths.has(path)) ||
    (['restricted', 'pending_deletion', 'quota_gated'].includes(state) && ['/api/v2/auth/bootstrap', '/api/v2/auth/logout'].includes(path)) ||
    (state === 'restoring' && (path === '/api/v1/auth/me' || path === '/api/v2/auth/bootstrap'));
  if (!allowed(status)) {
    throw new Error('Authenticated session required');
  }
  let version: number;
  let tokens: Awaited<ReturnType<typeof getTokens>> = null;
  do {
    version = currentCredentialVersion();
    await waitForActiveRefresh(request.identityGeneration, config.signal);
    try {
      tokens = await getTokens();
    } catch (error) {
      if (!(error instanceof CredentialStorageError) || error.kind !== 'recovery_required') throw error;
      // Rotation may have started after the first wait and written its marker.
      await waitForActiveRefresh(request.identityGeneration, config.signal);
      if (version === currentCredentialVersion()) throw error;
    }
    assertIdentityGeneration(request.identityGeneration);
  } while (version !== currentCredentialVersion());
  const currentStatus = useAuthStore.getState().sessionStatus;
  if (!allowed(currentStatus)) {
    throw new Error('Authenticated session required');
  }
  if (!tokens?.accessToken) throw new Error('Authenticated session required');
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  request.credentialVersion = version;
  bindCancellation();
  return config;
});

// Mutations need operation-specific idempotency before they can be retried.
export function shouldRetrySafeRead(err: AxiosError): boolean {
  if ((err.config as ManagedRequest | undefined)?._retry) return false;
  if (err.config?.url === '/api/v2/auth/bootstrap') return false;
  const method = err.config?.method?.toLowerCase();
  if (method !== 'get' && method !== 'head' && method !== 'options') return false;
  return axiosRetry.isNetworkOrIdempotentRequestError(err) || (err.response?.status ?? 0) >= 500;
}

axiosRetry(client, {
  retries: APP_CONFIG.RETRY_COUNT,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: shouldRetrySafeRead,
});

// Axios runs asynchronous request interceptors in a later microtask. Capture the
// identity at the public call boundary so work queued before logout cannot be
// dispatched later under a different account.
const noBodyMethods = new Set(['get', 'delete', 'head', 'options']);
const bodyMethods = new Set(['post', 'put', 'patch', 'postForm', 'putForm', 'patchForm']);
function withIdentity(config: any) {
  return { ...config, identityGeneration: config?.identityGeneration ?? currentIdentityGeneration() };
}
const identityBoundClient = new Proxy(client, {
  apply(target, thisArg, args) {
    const index = typeof args[0] === 'string' ? 1 : 0;
    args[index] = withIdentity(args[index]);
    return Reflect.apply(target, thisArg, args);
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof property !== 'string' || typeof value !== 'function') return value;
    if (noBodyMethods.has(property) || bodyMethods.has(property) || property === 'request') {
      return (...args: any[]) => {
        const index = property === 'request' ? (typeof args[0] === 'string' ? 1 : 0) : bodyMethods.has(property) ? 2 : 1;
        args[index] = withIdentity(args[index]);
        return value(...args);
      };
    }
    return value;
  },
});

export default identityBoundClient;
