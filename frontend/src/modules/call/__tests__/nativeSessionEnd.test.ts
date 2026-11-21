import { useAuthStore } from '../../auth/store';
import { useCallStore } from '../store';
import { advanceIdentityGeneration } from '../../auth/generation';
import { createCall, getCall } from '../api';
import { wsManager } from '../../../realtime/websocket';
import VoiceEngine from '../../../../modules/voice-engine';
import { currentIdentityGeneration } from '../../auth/generation';

const mockListeners: Record<string, (event: any) => void> = {};
jest.mock('../../../../modules/voice-engine', () => ({ __esModule: true, default: {
  addListener: (event: string, callback: (value: any) => void) => { mockListeners[event] = callback; return { remove: jest.fn() }; },
  endCall: jest.fn().mockResolvedValue(undefined),
  prepareCall: jest.fn().mockResolvedValue(undefined),
} }));
jest.mock('../../../realtime/websocket', () => ({ wsManager: { send: jest.fn(), disconnect: jest.fn(), on: jest.fn(), waitFor: jest.fn() } }));
jest.mock('../api', () => ({ createCall: jest.fn(), getCall: jest.fn(), endCallSession: jest.fn() }));
const { nativeVoiceCoordinator } = require('../nativeVoice');

afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); useCallStore.getState().resetCall(); useAuthStore.getState().clearAuth(); });

it('ignores late native events after terminating the authenticated call', async () => {
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  useCallStore.getState().setCall({ callSessionID: 'call-one', callState: 'connecting' });
  advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('terminating');
  await nativeVoiceCoordinator.stopForSessionEnd();
  mockListeners.onCallState({ state: 'active' });
  mockListeners.onVerification({ code: '123456', remembered: true });
  mockListeners.onError({ message: 'late' });
  expect(useCallStore.getState().callState).toBe('idle');
  expect(useCallStore.getState().callSessionID).toBeNull();
});

it('does not republish an invitation returned after session termination', async () => {
  let finish!: (value: unknown) => void;
  (createCall as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  const pending = nativeVoiceCoordinator.createInviteCall();
  advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('terminating');
  await nativeVoiceCoordinator.stopForSessionEnd();
  finish({ call_session_id: 'old-call', fallback_code: '123456' });
  await expect(pending).rejects.toThrow();
  expect(useCallStore.getState().callState).toBe('idle');
});

it('ignores events from another call or an earlier attempt of the same call', () => {
  useAuthStore.getState().setUser({ id: 'two', username: 'bob' });
  useCallStore.getState().setCall({ callSessionID: 'call-two', callState: 'connecting' });
  (nativeVoiceCoordinator as any).activeAttempt = 'new-attempt';
  mockListeners.onCallState({ callId: 'call-one', attemptId: 'old-attempt', state: 'active' });
  mockListeners.onCallState({ callId: 'call-two', attemptId: 'old-attempt', state: 'active' });
  mockListeners.onCallState({ state: 'active' });
  mockListeners.onHandshakeFrame({ callId: 'call-two', attemptId: 'old-attempt', frame: 'stale-frame' });
  mockListeners.onVerification({ callId: 'call-two', attemptId: 'old-attempt', code: '111111', remembered: false });
  mockListeners.onError({ callId: 'call-two', attemptId: 'old-attempt', message: 'stale-error' });
  expect(wsManager.send).not.toHaveBeenCalledWith('noise-handshake', expect.anything());
  expect(useCallStore.getState().callState).toBe('connecting');
  mockListeners.onCallState({ callId: 'call-two', attemptId: 'new-attempt', state: 'active' });
  expect(useCallStore.getState().callState).toBe('active');
  mockListeners.onHandshakeFrame({ callId: 'call-two', attemptId: 'new-attempt', frame: 'current-frame' });
  expect(wsManager.send).toHaveBeenCalledWith('noise-handshake', { frame: 'current-frame' });
});

it('does not reschedule or publish an in-flight poll after session termination', async () => {
  jest.useFakeTimers();
  let finish!: (value: unknown) => void;
  (createCall as jest.Mock).mockResolvedValueOnce({ call_session_id: 'call-one', fallback_code: '123456' });
  (getCall as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  await nativeVoiceCoordinator.createInviteCall();
  expect(finish).toBeDefined();
  advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('terminating');
  await nativeVoiceCoordinator.stopForSessionEnd();
  finish({ id: 'call-one', state: 'awaiting_acceptance', remote_username: 'old-peer' });
  await Promise.resolve(); await Promise.resolve();
  await jest.advanceTimersByTimeAsync(2000);
  expect(getCall).toHaveBeenCalledTimes(1);
  expect(useCallStore.getState().callState).toBe('idle');
  expect(useCallStore.getState().remoteUser).toBeNull();
});

it('stops immediately, settles an older preparation, and stops again before preparing the next call', async () => {
  const events: string[] = [];
  let finishOld!: () => void;
  (VoiceEngine.prepareCall as jest.Mock).mockImplementationOnce(() => {
    events.push('old-prepare');
    return new Promise<void>((resolve) => { finishOld = resolve; });
  }).mockImplementationOnce(async () => { events.push('new-prepare'); });
  (VoiceEngine.endCall as jest.Mock).mockImplementation(async () => { events.push('stop'); });
  useAuthStore.getState().setUser({ id: 'one', username: 'alice' });
  useCallStore.getState().setCall({ callSessionID: 'old-call', callState: 'connecting' });
  const options = { callId: 'old-call', attemptId: 'old', accountScope: 'alice', initiator: true, expectedRemotePublicKey: 'key', remoteDeviceId: 'device', keyEpoch: 1 };
  const oldPrepare = nativeVoiceCoordinator.prepareNative(options, currentIdentityGeneration());
  const oldRejected = expect(oldPrepare).rejects.toThrow();
  await Promise.resolve();
  expect(events).toEqual(['old-prepare']);
  advanceIdentityGeneration();
  useAuthStore.getState().setSessionStatus('terminating');
  const stopped = nativeVoiceCoordinator.stopForSessionEnd();
  expect(events).toEqual(['old-prepare', 'stop']);
  useAuthStore.getState().setUser({ id: 'two', username: 'bob' });
  useCallStore.getState().setCall({ callSessionID: 'new-call', callState: 'connecting' });
  const next = nativeVoiceCoordinator.prepareNative({ ...options, callId: 'new-call', attemptId: 'new' }, currentIdentityGeneration());
  await Promise.resolve();
  expect(events).toEqual(['old-prepare', 'stop']);
  finishOld();
  await oldRejected;
  await stopped;
  await next;
  expect(events).toEqual(['old-prepare', 'stop', 'stop', 'new-prepare']);
});

it('allows local shutdown to be retried after the native stop fails', async () => {
  (VoiceEngine.endCall as jest.Mock).mockReset().mockRejectedValueOnce(new Error('native stop failed')).mockResolvedValueOnce(undefined);
  await expect(nativeVoiceCoordinator.stopForSessionEnd()).rejects.toThrow('native stop failed');
  await expect(nativeVoiceCoordinator.stopForSessionEnd()).resolves.toBeUndefined();
  expect(VoiceEngine.endCall).toHaveBeenCalledTimes(2);
});

