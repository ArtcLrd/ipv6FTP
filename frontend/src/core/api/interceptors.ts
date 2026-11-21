import axios, { AxiosInstance, CanceledError, GenericAbortSignal } from 'axios';
import { getTokens, storeTokens, clearTokens, markRefreshUncertain, CredentialStorageError } from '../storage/secure';
import { useAuthStore } from '../../modules/auth/store';
import { API_BASE_URL } from '../../config/env';
import { advanceIdentityGeneration, assertIdentityGeneration, currentIdentityGeneration, identitySignal, StaleIdentityError } from '../../modules/auth/generation';
import { RefreshResponseSchema } from './contractsV2';

let refreshFlight: { generation: number; promise: Promise<void> } | null = null;
let credentialVersion = 0;
export function currentCredentialVersion(): number { return credentialVersion; }
export async function waitForActiveRefresh(generation: number, callerSignal?: GenericAbortSignal): Promise<void> {
  const active = refreshFlight;
  if (callerSignal?.aborted) throw new CanceledError('Request cancelled');
  if (active && active.generation === generation && callerSignal?.addEventListener) {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { cleanup(); reject(new CanceledError('Request cancelled')); };
      const cleanup = () => callerSignal.removeEventListener?.('abort', cancel);
      callerSignal.addEventListener!('abort', cancel, { once: true });
      if (callerSignal.aborted) { cancel(); return; }
      active.promise.then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
    });
  } else if (active && active.generation === generation) await active.promise;
  assertIdentityGeneration(generation);
}

async function requestRefresh(token: string, version: 1 | 2): Promise<any> {
  const sessionSignal = identitySignal();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new StaleIdentityError()); };
    timer = setTimeout(() => { controller.abort(); reject(new Error('Refresh request timed out')); }, 10000);
    sessionSignal.addEventListener('abort', cancel, { once: true });
    if (sessionSignal.aborted) cancel();
  });
  try {
    return await Promise.race([
      axios.post(`${API_BASE_URL}/api/v${version}/auth/refresh`, { refresh_token: token }, { timeout: 10000, signal: controller.signal }),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    sessionSignal.removeEventListener('abort', cancel);
  }
}

export function refreshCredentials(generation: number): Promise<void> {
  if (refreshFlight?.generation === generation) return refreshFlight.promise;
  const promise = (async () => {
    let dispatched = false;
    try {
      const tokens = await getTokens();
      assertIdentityGeneration(generation);
      if (!tokens?.refreshToken) throw new Error('No refresh token available');
      await markRefreshUncertain(generation);
      assertIdentityGeneration(generation);
      dispatched = true;
      const { data: rawData } = await requestRefresh(tokens.refreshToken, tokens.session ? 2 : 1);
      const data = tokens.session ? RefreshResponseSchema.parse(rawData) : rawData;
      assertIdentityGeneration(generation);
      if (typeof data?.access_token !== 'string' || !data.access_token ||
          typeof data?.refresh_token !== 'string' || !data.refresh_token) throw new Error('Invalid refresh response');
      if (tokens.session) await storeTokens(data.access_token, data.refresh_token, generation, tokens.session);
      else await storeTokens(data.access_token, data.refresh_token, generation);
      assertIdentityGeneration(generation);
      credentialVersion++;
    } catch (error) {
      try { assertIdentityGeneration(generation); } catch { throw error; }
      if (dispatched || error instanceof CredentialStorageError) {
        const terminatedGeneration = advanceIdentityGeneration();
        const upgradeRequired = axios.isAxiosError(error) && error.response?.status === 426 &&
          error.response.data?.error?.code === 'upgrade_required';
        useAuthStore.getState().setSessionStatus(upgradeRequired ? 'upgrade_required' :
          !dispatched && error instanceof CredentialStorageError && error.kind === 'unavailable' ? 'storage_unavailable' : 'recovery_required');
        try { void require('../../modules/call/nativeVoice').nativeVoiceCoordinator.stopForSessionEnd().catch(() => undefined); } catch { /* startup */ }
        try { require('../../services/signalingService').terminateSignaling(); } catch { /* startup */ }
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          try { await clearTokens(terminatedGeneration); } catch (storageError) {
            assertIdentityGeneration(terminatedGeneration);
            useAuthStore.getState().setSessionStatus('storage_unavailable');
            throw storageError;
          }
          assertIdentityGeneration(terminatedGeneration);
        }
      }
      throw error;
    }
  })();
  refreshFlight = { generation, promise };
  void promise.finally(() => { if (refreshFlight?.promise === promise) refreshFlight = null; }).catch(() => undefined);
  return promise;
}

export const setupInterceptors = (client: AxiosInstance) => {
  client.interceptors.response.use(
    (res) => {
      const generation = (res.config as typeof res.config & { identityGeneration?: number }).identityGeneration;
      if (generation !== undefined) assertIdentityGeneration(generation);
      return res;
    },
    async (error) => {
      const request = error.config;
      if (!request) throw error;
      const generation = request.identityGeneration ?? currentIdentityGeneration();
      assertIdentityGeneration(generation);
      if (request.public) throw error;
      const errorCode = error.response?.data?.error?.code ?? error.response?.data?.code;
      if (error.response?.status === 401 && (errorCode === 'SESSION_INVALID' || errorCode === 'session_invalid')) {
        const terminatedGeneration = advanceIdentityGeneration();
        useAuthStore.getState().setSessionStatus('recovery_required');
        try { void require('../../modules/call/nativeVoice').nativeVoiceCoordinator.stopForSessionEnd().catch(() => undefined); } catch { /* startup */ }
        try { require('../../services/signalingService').terminateSignaling(); } catch { /* startup */ }
        try { await clearTokens(terminatedGeneration); } catch {
          try { assertIdentityGeneration(terminatedGeneration); useAuthStore.getState().setSessionStatus('storage_unavailable'); } catch { /* superseded */ }
        }
        throw error;
      }
      if (error.response?.status !== 401 || !['ACCESS_EXPIRED', 'access_expired'].includes(errorCode) || request._retry ||
          request.url?.includes('/api/v1/auth/login') || request.url?.includes('/api/v1/auth/register')) throw error;
      if (request.signal?.aborted) throw new CanceledError('Request cancelled');
      request._retry = true;
      // Another request may have rotated the token before this old 401 arrived.
      // In that case reuse the persisted replacement instead of rotating again.
      if (typeof request.credentialVersion !== 'number' || request.credentialVersion >= credentialVersion) {
        void refreshCredentials(generation);
      }
      await waitForActiveRefresh(generation, request.signal);
      if (!['get', 'head', 'options'].includes((request.method ?? 'get').toLowerCase())) throw error;
      return client(request);
    }
  );
};
