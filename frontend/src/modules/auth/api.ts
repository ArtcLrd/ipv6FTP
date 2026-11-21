import client from '../../core/api/client';
import { storeTokens, clearTokens, markRefreshUncertain, CredentialStorageError } from '../../core/storage/secure';
import { refreshCredentials } from '../../core/api/interceptors';
import { useAuthStore } from './store';
import { CheckUsernameResponseSchema, UserSchema } from '../../core/api/schemas';
import type { User } from '../../core/api/schemas';
import { usePromptStore } from '../prompts/store';
import { nativeVoiceCoordinator } from '../call/nativeVoice';
import axios from 'axios';
import { API_BASE_URL } from '../../config/env';
import { getTokens, readProfileRemoval, writeProfileRemoval, readRetainedProfile, writeRetainedProfile } from '../../core/storage/secure';
import { advanceIdentityGeneration, assertIdentityGeneration, currentIdentityGeneration } from './generation';
import { queryClient } from '../../app/providers';
import { useUserStore } from '../user/store';
import { useCallStore } from '../call/store';
import VoiceEngine from '../../../modules/voice-engine';
import { enrollRegisteredDevice } from './enrollment';
import { BootstrapSnapshotSchema } from '../../core/api/contractsV2';
import { acceptAccountEventCursor } from '../../realtime/accountEvents';

class UnsupportedBootstrapError extends Error {}
function isUpgradeRequired(error: unknown): boolean {
  return error instanceof UnsupportedBootstrapError || (axios.isAxiosError(error) &&
    error.response?.status === 426 && error.response.data?.error?.code === 'upgrade_required');
}
class BootstrapBindingError extends Error {}
class StaleBootstrapError extends Error {}
let acceptedRevision: { session: string; generation: number; revision: number } | undefined;
let lastAutomaticCheck: { generation: number; time: number } | undefined;

function clearPrivateAccountState(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  useUserStore.setState({ currentIP: null, searchResults: [] });
  usePromptStore.getState().clearPrompts();
}

function requireSignedOut(): void {
  if (useAuthStore.getState().sessionStatus !== 'signed_out') {
    throw new Error('Log out before signing in to another account.');
  }
}

async function enroll(mode: 'register' | 'resume', username: string, password: string): Promise<void> {
  requireSignedOut();
  useAuthStore.getState().setSessionStatus('enrolling');
  const generation = advanceIdentityGeneration();
  let grant: Awaited<ReturnType<typeof enrollRegisteredDevice>>;
  try { grant = await enrollRegisteredDevice(mode, username, password); }
  catch (error) { assertIdentityGeneration(generation); useAuthStore.getState().clearAuth(); throw error; }
  assertIdentityGeneration(generation);
  try {
    await storeTokens(grant.access_token, grant.refresh_token, generation, {
      version: 2, principalId: grant.principal_id, deviceId: grant.device_id,
      sessionId: grant.session_id, generation: grant.generation,
    });
  } catch (error) { assertIdentityGeneration(generation); useAuthStore.getState().clearAuth(); throw error; }
  assertIdentityGeneration(generation);
  clearPrivateAccountState();
  useAuthStore.getState().setSessionStatus('restoring');
  try { await bootstrapV2(); }
  catch (error) {
    assertIdentityGeneration(generation);
    if (error instanceof BootstrapBindingError) {
      await cleanupInvalidBinding(generation);
      throw error;
    }
    useAuthStore.getState().setSessionStatus(isUpgradeRequired(error) ? 'upgrade_required' : error instanceof CredentialStorageError
      ? error.kind === 'unavailable' ? 'storage_unavailable' : 'recovery_required'
      : 'offline');
    throw error;
  }
}

export async function login(username: string, password: string): Promise<void> {
  return enroll('resume', username, password);
}

export async function checkUsername(username: string): Promise<{ exists: boolean; username: string }> {
  const { data: rawData } = await client.get(
    `/api/v1/auth/check-username?username=${encodeURIComponent(username.trim())}`
  );
  const data = CheckUsernameResponseSchema.parse(rawData);
  return data;
}

export async function register(username: string, password: string): Promise<void> {
  return enroll('register', username, password);
}

export async function bootstrapV2(): Promise<void> {
  const generation = currentIdentityGeneration();
  const tokens = await getTokens();
  assertIdentityGeneration(generation);
  if (!tokens?.session) throw new CredentialStorageError('partial');
  let fingerprint: string | null;
  try { fingerprint = await VoiceEngine.identityFingerprint(`principal:${tokens.session.principalId}`); }
  catch { throw new CredentialStorageError('unavailable'); }
  assertIdentityGeneration(generation);
  if (!fingerprint) throw new CredentialStorageError('recovery_required');
  const { data } = await client.get('/api/v2/auth/bootstrap', {
    params: { include: 'device_key_fingerprint', snapshot: 'extended' },
  });
  assertIdentityGeneration(generation);
  if (data && (data.schema_version !== 2 || !['registered', 'guest'].includes(data.account_type) || !['setup_pending', 'recovery_setup', 'active', 'restricted', 'pending_deletion'].includes(data.account_state))) {
    throw new UnsupportedBootstrapError();
  }
  const snapshot = BootstrapSnapshotSchema.parse(data);
  const session = tokens.session;
  if (snapshot.principal_id !== session.principalId || snapshot.device_id !== session.deviceId ||
      snapshot.session_id !== session.sessionId || snapshot.generation !== session.generation ||
      snapshot.account_type !== 'registered' || snapshot.device_key_fingerprint !== fingerprint) throw new BootstrapBindingError();
  const retained = await readRetainedProfile();
  assertIdentityGeneration(generation);
  if (retained && retained.principalId !== snapshot.principal_id) throw new BootstrapBindingError();
  if (acceptedRevision?.session === session.sessionId && acceptedRevision.generation === generation && snapshot.revision < acceptedRevision.revision) {
    throw new StaleBootstrapError();
  } else {
    acceptedRevision = { session: session.sessionId, generation, revision: snapshot.revision };
  }
  await writeRetainedProfile({ principalId: snapshot.principal_id, scope: `principal:${snapshot.principal_id}`, username: snapshot.username });
  assertIdentityGeneration(generation);
  if (snapshot.account_state === 'restricted' || snapshot.account_state === 'pending_deletion' || snapshot.eligibility?.all_services_gated) {
    useAuthStore.getState().setStateDeadline(snapshot.deletion_deadline ?? snapshot.reset_at ?? null);
    useAuthStore.getState().setSessionStatus(snapshot.account_state === 'restricted' ? 'restricted' : snapshot.account_state === 'pending_deletion' ? 'pending_deletion' : 'quota_gated');
    return;
  }
  if (snapshot.account_state === 'recovery_setup' || snapshot.account_state === 'setup_pending') {
    useAuthStore.getState().setSessionStatus('setup');
    return;
  }
  if (snapshot.account_state !== 'active') throw new CredentialStorageError('recovery_required');
  const previous = useAuthStore.getState().user;
  if (previous?.id === snapshot.principal_id && previous.username !== snapshot.username) {
    const nextGeneration = advanceIdentityGeneration();
    if (acceptedRevision) acceptedRevision.generation = nextGeneration;
    clearPrivateAccountState();
  }
  acceptAccountEventCursor(snapshot.event_cursor, currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: snapshot.principal_id, username: snapshot.username,
    account_type: 'registered', identity_scope: `principal:${snapshot.principal_id}` });
}

export async function activateSetup(): Promise<void> {
  const generation = currentIdentityGeneration();
  try {
    const tokens = await getTokens();
    assertIdentityGeneration(generation);
    const key = tokens?.session?.sessionId;
    await client.post('/api/v2/auth/setup/activate', {}, key ? { headers: { 'Idempotency-Key': key } } : undefined);
  } catch (error) {
    if (!axios.isAxiosError(error) || (error.response && error.response.status < 500)) throw error;
    // A lost response may follow a committed activation. Reconcile the durable
    // session before deciding whether the user needs to retry.
    assertIdentityGeneration(generation);
    try { await bootstrapV2(); } catch (bootstrapError) {
      assertIdentityGeneration(generation);
      if (bootstrapError instanceof BootstrapBindingError) await cleanupInvalidBinding(generation);
      else if (isUpgradeRequired(bootstrapError)) useAuthStore.getState().setSessionStatus('upgrade_required');
      else if (bootstrapError instanceof CredentialStorageError) useAuthStore.getState().setSessionStatus(bootstrapError.kind === 'unavailable' ? 'storage_unavailable' : 'recovery_required');
      else useAuthStore.getState().setSessionStatus('offline');
      throw bootstrapError;
    }
    if (useAuthStore.getState().sessionStatus === 'authenticated') return;
    throw error;
  }
  assertIdentityGeneration(generation);
  try { await bootstrapV2(); } catch (error) {
    assertIdentityGeneration(generation);
    if (error instanceof BootstrapBindingError) await cleanupInvalidBinding(generation);
    else if (isUpgradeRequired(error)) useAuthStore.getState().setSessionStatus('upgrade_required');
    else if (error instanceof CredentialStorageError) useAuthStore.getState().setSessionStatus(error.kind === 'unavailable' ? 'storage_unavailable' : 'recovery_required');
    else useAuthStore.getState().setSessionStatus('offline');
    throw error;
  }
}

export async function beginPasswordChange() {
  if (useAuthStore.getState().sessionStatus !== 'authenticated') throw new Error('Sign in required');
  const callID = useCallStore.getState().callSessionID;
  const generation = advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('password_changing');
  try {
    await boundedLocalStop(nativeVoiceCoordinator.stopForSessionEnd());
  } catch (error) {
    assertIdentityGeneration(generation);
    useAuthStore.getState().setSessionStatus('logout_failed');
    throw error;
  }
  try {
    const tokens = await getTokens();
    assertIdentityGeneration(generation);
    if (!tokens?.accessToken || !tokens.refreshToken) throw new CredentialStorageError('partial');
    await markRefreshUncertain(generation);
    if (callID) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(); }, 2000);
      });
      try {
        await Promise.race([
          axios.post(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callID)}/end`, { reason: 'session_ended' }, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` }, timeout: 2000, signal: controller.signal,
          }).then(() => undefined, () => undefined),
          deadline,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
      assertIdentityGeneration(generation);
    }
    return { generation, tokens };
  } catch (error) {
    assertIdentityGeneration(generation);
    useAuthStore.getState().setSessionStatus(error instanceof CredentialStorageError && error.kind !== 'unavailable'
      ? 'recovery_required' : 'storage_unavailable');
    throw error;
  }
}

export async function rejectPasswordChange(context: Awaited<ReturnType<typeof beginPasswordChange>>): Promise<void> {
  const { generation, tokens } = context;
  try {
    await storeTokens(tokens.accessToken, tokens.refreshToken, generation, tokens.session);
    assertIdentityGeneration(generation);
    useAuthStore.getState().setSessionStatus('authenticated');
  } catch (error) {
    assertIdentityGeneration(generation);
    useAuthStore.getState().setSessionStatus('storage_unavailable');
    throw error;
  }
}

export async function finishPasswordChange(generation: number, confirmed: boolean): Promise<void> {
  assertIdentityGeneration(generation);
  clearPrivateAccountState();
  try { await clearTokens(generation); }
  catch (error) {
    assertIdentityGeneration(generation);
    useAuthStore.getState().setSessionStatus('storage_unavailable');
    throw error;
  }
  assertIdentityGeneration(generation);
  useAuthStore.getState().setSessionStatus(confirmed ? 'password_changed' : 'password_change_uncertain');
}

let logoutFlight: Promise<void> | null = null;
let pendingProfileRemoval: { scope: string; username: string } | null = null;
let unconfirmedAccessToken: string | null = null;
let unconfirmedSessionVersion: 1 | 2 = 1;
const LOCAL_STOP_DEADLINE_MS = 5000;

function boundedLocalStop(stop: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native shutdown could not be confirmed; retry logout.')), LOCAL_STOP_DEADLINE_MS);
    stop.then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
export function canRetryServerLogout(): boolean { return unconfirmedAccessToken !== null; }

async function revokeRemotely(token: string, version: 1 | 2, callID?: string | null): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const headers = { Authorization: `Bearer ${token}` };
  // The deadline also covers transports or mocks that ignore abort signals.
  const deadline = new Promise<false>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(false); }, 5000); });
  const endCall = callID ? axios.post(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callID)}/end`, { reason: 'session_ended' }, { timeout: 5000, signal: controller.signal, headers }).catch(() => undefined) : undefined;
  const revoke = axios.post(`${API_BASE_URL}/api/v${version}/auth/logout`, {}, { timeout: 5000, signal: controller.signal, headers }).then(() => true, () => false);
  try {
    const [confirmed] = await Promise.all([Promise.race([revoke, deadline]), Promise.race([endCall, deadline])]);
    return confirmed;
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}

let serverLogoutRetry: Promise<void> | null = null;

export function retryServerLogout(): Promise<void> {
  if (serverLogoutRetry) return serverLogoutRetry;
  const token = unconfirmedAccessToken;
  if (!token || useAuthStore.getState().sessionStatus !== 'logout_unconfirmed') return Promise.resolve();
  const generation = currentIdentityGeneration();
  serverLogoutRetry = revokeRemotely(token, unconfirmedSessionVersion).then((confirmed) => {
    if (confirmed && token === unconfirmedAccessToken && generation === currentIdentityGeneration() &&
        useAuthStore.getState().sessionStatus === 'logout_unconfirmed') dismissServerLogoutWarning();
  }).finally(() => { serverLogoutRetry = null; });
  return serverLogoutRetry;
}

export function dismissServerLogoutWarning(): void {
  unconfirmedAccessToken = null;
  useAuthStore.getState().clearAuth();
}

export async function retryLocalLogout(): Promise<void> {
  const removal = pendingProfileRemoval ?? await readProfileRemoval();
  await logout(removal ?? undefined);
}

export function removeLocalProfile(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return Promise.reject(new Error('Sign in required'));
  return logout({ scope: user.identity_scope || user.username, username: user.username });
}

export async function removeSignedOutProfile(): Promise<void> {
  requireSignedOut();
  const generation = currentIdentityGeneration();
  const profile = await readRetainedProfile();
  assertIdentityGeneration(generation);
  requireSignedOut();
  if (profile) await logout({ scope: profile.scope, username: profile.username });
}

export function logout(removal?: { scope: string; username: string }): Promise<void> {
  if (logoutFlight) return logoutFlight;
  if (removal) pendingProfileRemoval = removal;
  const generation = advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('terminating');
  const callID = useCallStore.getState().callSessionID;
  const localStop = nativeVoiceCoordinator.stopForSessionEnd();
  const previousTokens = getTokens();
  const stop = boundedLocalStop(localStop);
  const clearing = removal ? writeProfileRemoval(removal).then(async () => {
    await clearTokens(generation);
    await stop;
    assertIdentityGeneration(generation);
    await VoiceEngine.removeProfile(removal.scope, removal.username);
    await writeRetainedProfile(null);
    await writeProfileRemoval(null);
    pendingProfileRemoval = null;
  }) : clearTokens(generation);
  const localCleanup = Promise.allSettled([stop, clearing]);
  clearPrivateAccountState();
  logoutFlight = (async () => {
    let confirmed = false;
    let hadCredentials = true;
    try {
      const tokens = await previousTokens;
      if (tokens?.accessToken) { unconfirmedAccessToken = tokens.accessToken; unconfirmedSessionVersion = tokens.session ? 2 : 1; }
      else if (!tokens && !unconfirmedAccessToken) hadCredentials = false;
      if (unconfirmedAccessToken) confirmed = await revokeRemotely(unconfirmedAccessToken, unconfirmedSessionVersion, callID);
      if (confirmed) unconfirmedAccessToken = null;
    } catch { /* Local clearing still proceeds when storage is unavailable. */ }
    const results = await localCleanup;
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assertIdentityGeneration(generation);
    if (failed) { useAuthStore.getState().setSessionStatus('logout_failed'); throw failed.reason; }
    if (!confirmed && (hadCredentials || removal)) useAuthStore.getState().setSessionStatus('logout_unconfirmed');
    else { unconfirmedAccessToken = null; useAuthStore.getState().clearAuth(); }
  })();
  void logoutFlight.finally(() => { logoutFlight = null; }).catch(() => undefined);
  return logoutFlight;
}

export async function getMe(): Promise<User | null> {
  const generation = currentIdentityGeneration();
  try {
    const { data: rawData } = await client.get('/api/v1/auth/me');
    const data = UserSchema.parse(rawData);
    assertIdentityGeneration(generation);
    useAuthStore.getState().setUser(data);
    return data;
  } catch (error) { assertIdentityGeneration(generation); throw error; }
}

let reconciliation: { generation: number; promise: Promise<void> } | undefined;

async function cleanupInvalidBinding(generation: number): Promise<void> {
  assertIdentityGeneration(generation);
  const cleanupGeneration = advanceIdentityGeneration();
  acceptedRevision = undefined;
  useAuthStore.getState().setSessionStatus('recovery_required');
  clearPrivateAccountState();
  try { require('../../services/signalingService').terminateSignaling(); } catch { /* startup */ }
  try {
    await boundedLocalStop(nativeVoiceCoordinator.stopForSessionEnd());
    await clearTokens(cleanupGeneration);
  } catch {
    assertIdentityGeneration(cleanupGeneration);
    useAuthStore.getState().setSessionStatus('logout_failed');
  }
}

export function reconcileSession(): Promise<void> {
  const status = useAuthStore.getState().sessionStatus;
  const generation = currentIdentityGeneration();
  if (reconciliation?.generation === generation) return reconciliation.promise;
  if (!['authenticated', 'offline', 'restricted', 'pending_deletion', 'quota_gated'].includes(status)) return Promise.resolve();
  if (lastAutomaticCheck?.generation === generation && Date.now() - lastAutomaticCheck.time < 2000) return Promise.resolve();
  lastAutomaticCheck = { generation, time: Date.now() };
  return runRestore(status === 'authenticated', generation);
}

export function restoreSession(): Promise<void> {
  return runRestore(false, currentIdentityGeneration());
}

export function reconcileEventSession(): Promise<void> {
  return runRestore(true, currentIdentityGeneration());
}

function runRestore(inForeground: boolean, generation: number): Promise<void> {
  if (reconciliation?.generation === generation) return reconciliation.promise;
  const promise = restoreStoredSession(inForeground, generation).finally(() => {
    if (reconciliation?.promise === promise) reconciliation = undefined;
  });
  reconciliation = { generation, promise };
  return promise;
}

async function restoreStoredSession(inForeground: boolean, generation: number): Promise<void> {
  if (useAuthStore.getState().sessionStatus === 'upgrade_required') return;
  if (!inForeground) useAuthStore.getState().setSessionStatus('restoring');
  try {
    const removal = await readProfileRemoval();
    assertIdentityGeneration(generation);
    if (removal) {
      await logout(removal);
      return;
    }
    const tokens = await getTokens();
    assertIdentityGeneration(generation);
    if (inForeground && tokens && !tokens.session) return;
    if (!tokens) { useAuthStore.getState().clearAuth(); return; }
    if (!tokens.accessToken) await refreshCredentials(generation);
    if (tokens.session) await bootstrapV2();
    else await getMe();
  } catch (error) {
    if (['upgrade_required', 'logout_failed', 'storage_unavailable', 'recovery_required'].includes(useAuthStore.getState().sessionStatus)) return;
    assertIdentityGeneration(generation);
    if (error instanceof BootstrapBindingError) {
      await cleanupInvalidBinding(generation);
    } else if (isUpgradeRequired(error)) {
      useAuthStore.getState().setSessionStatus('upgrade_required');
    } else if (error instanceof CredentialStorageError) {
      useAuthStore.getState().setSessionStatus(error.kind === 'unavailable' ? 'storage_unavailable' : 'recovery_required');
    } else if (axios.isAxiosError(error) && error.response?.status === 401) {
      try { await clearTokens(generation); } catch {
        assertIdentityGeneration(generation);
        useAuthStore.getState().setSessionStatus('storage_unavailable');
        return;
      }
      assertIdentityGeneration(generation);
      useAuthStore.getState().setSessionStatus('recovery_required');
    } else {
      useAuthStore.getState().setSessionStatus('offline');
    }
  } finally {
    if (inForeground && generation === currentIdentityGeneration() && useAuthStore.getState().sessionStatus !== 'authenticated') {
      const nextGeneration = advanceIdentityGeneration();
      if (acceptedRevision?.generation === generation) acceptedRevision.generation = nextGeneration;
      clearPrivateAccountState();
      await boundedLocalStop(nativeVoiceCoordinator.stopForSessionEnd()).catch(() => undefined);
    }
  }
}
