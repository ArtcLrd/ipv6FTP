import { PermissionsAndroid, Platform } from 'react-native';
import VoiceEngine from '../../../modules/voice-engine';
import { wsManager } from '../../realtime/websocket';
import { logger } from '../../core/logger/logger';
import { useAuthStore } from '../auth/store';
import { useCallStore } from './store';
import {
  acceptCall,
  createCall,
  endCallSession,
  getCall,
  joinCallByCode,
  requestDirectTicket,
  requestSignalTicket,
  setCallLifecycle,
  type CallInvitation,
} from './api';
import type { CallSession } from './types';
import type { PrepareCallOptions } from '../../../modules/voice-engine';
import { assertIdentityGeneration, currentIdentityGeneration } from '../auth/generation';

const POLL_MS = 1_000;
const SETUP_TIMEOUT_MS = 10 * 60 * 1_000;

class NativeVoiceCoordinator {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private setupStarted = false;
  private directStarted = false;
  private localRegistered = false;
  private pendingEndpoint: string | null = null;
  private keyEpoch = 1;
  private networkRecovery = false;
  private recoveryAttempts = 0;
  private nativeSubscriptions: Array<{ remove(): void }> = [];
  private socketSubscriptions: Array<() => void> = [];
  private activeAttempt: string | null = null;
  private pendingNativePrepare: Promise<void> | null = null;
  private nativeTeardown: Promise<void> = Promise.resolve();

  private async prepareNative(options: PrepareCallOptions, generation: number): Promise<void> {
    await this.nativeTeardown;
    assertIdentityGeneration(generation);
    if (!this.hasAuthorizedCall() || useCallStore.getState().callSessionID !== options.callId) throw new Error('Call was superseded');
    this.activeAttempt = options.attemptId;
    const pending = VoiceEngine.prepareCall(options);
    this.pendingNativePrepare = pending;
    try { await pending; } finally { if (this.pendingNativePrepare === pending) this.pendingNativePrepare = null; }
    assertIdentityGeneration(generation);
  }

  private stopNative(reason: string): Promise<void> {
    // Dispatch immediately, even when prepare is pending. If prepare wins the
    // native scheduling race, stop again before allowing another prepare.
    const previous = this.nativeTeardown;
    const preparing = this.pendingNativePrepare;
    const immediate = VoiceEngine.endCall(reason);
    const teardown = (async () => {
      const results = await Promise.allSettled([previous, immediate, ...(preparing ? [preparing] : [])]);
      if (preparing) await VoiceEngine.endCall(reason);
      const immediateResult = results[1];
      if (immediateResult.status === 'rejected') throw immediateResult.reason;
    })();
    this.nativeTeardown = teardown;
    return teardown;
  }

  private hasAuthorizedCall(): boolean {
    return useAuthStore.getState().sessionStatus === 'authenticated' && !!useCallStore.getState().callSessionID;
  }

  private isCurrentEvent(callId: string, attemptId: string): boolean {
    return this.hasAuthorizedCall() && typeof callId === 'string' && typeof attemptId === 'string' &&
      callId === useCallStore.getState().callSessionID && !!this.activeAttempt && attemptId === this.activeAttempt;
  }

  constructor() {
    this.nativeSubscriptions.push(
      VoiceEngine.addListener('onHandshakeFrame', ({ frame, callId, attemptId }) => {
        if (!this.isCurrentEvent(callId, attemptId)) return;
        wsManager.send('noise-handshake', { frame });
      }),
      VoiceEngine.addListener('onVerification', ({ code, remembered, callId, attemptId }) => {
        if (!this.isCurrentEvent(callId, attemptId)) return;
        const current = useCallStore.getState();
        current.setCall({ callState: 'verifying', verificationCode: code, verificationRemembered: remembered });
        if (current.role === 'creator' && !this.networkRecovery && current.callSessionID) {
          setCallLifecycle(current.callSessionID, 'verifying').catch((error) => logger.warn('Failed to persist verifying state', error));
        }
        if (remembered) this.beginDirectConnection().catch((error) => { if (this.isCurrentEvent(callId, attemptId)) this.fail(error); });
      }),
      VoiceEngine.addListener('onCallState', ({ state, reason, callId, attemptId }) => {
        if (!this.isCurrentEvent(callId, attemptId)) return;
        if (state === 'active') {
          const current = useCallStore.getState();
          current.setCall({ callState: 'active', error: null });
          if (current.role === 'creator' && !this.networkRecovery && current.callSessionID) {
            setCallLifecycle(current.callSessionID, 'active').catch((error) => logger.warn('Failed to persist active state', error));
          }
          this.networkRecovery = false;
        } else if (state === 'failed') {
          useCallStore.getState().setCall({ callState: 'failed', error: reason ?? 'Direct IPv6 connection failed.' });
        } else if (state === 'ended' && useCallStore.getState().callState !== 'idle') {
          useCallStore.getState().setCall({ callState: 'ended' });
        }
      }),
      VoiceEngine.addListener('onError', ({ message, callId, attemptId }) => {
        if (!this.isCurrentEvent(callId, attemptId)) return;
        useCallStore.getState().setCall({ callState: 'failed', error: message });
      }),
    );
  }

  async createInviteCall(): Promise<CallInvitation> {
    const generation = currentIdentityGeneration();
    this.resetSetupFlags();
    const invitation = await createCall();
    assertIdentityGeneration(generation);
    useCallStore.getState().setCall({
      callState: 'waiting',
      callSessionID: invitation.call_session_id,
      role: 'creator',
      remoteUser: null,
      invitationCode: invitation.fallback_code,
      error: null,
    });
    this.pollUntilReady(invitation.call_session_id, Date.now() + SETUP_TIMEOUT_MS);
    return invitation;
  }

  async joinCallWithCode(code: string): Promise<void> {
    const generation = currentIdentityGeneration();
    this.resetSetupFlags();
    const joined = await joinCallByCode(code);
    assertIdentityGeneration(generation);
    useCallStore.getState().setCall({
      callState: 'awaiting_acceptance',
      callSessionID: joined.call_session_id,
      role: 'joiner',
      invitationCode: null,
      error: null,
    });
    this.pollUntilReady(joined.call_session_id, Date.now() + SETUP_TIMEOUT_MS);
  }

  async acceptParticipant(): Promise<void> {
    const generation = currentIdentityGeneration();
    const callID = useCallStore.getState().callSessionID;
    if (!callID) return;
    await acceptCall(callID);
    assertIdentityGeneration(generation);
    const call = await getCall(callID);
    assertIdentityGeneration(generation);
    if (useCallStore.getState().callSessionID !== callID) return;
    await this.beginHandshake(call);
  }

  async confirmVerification(): Promise<void> {
    const generation = currentIdentityGeneration();
    const callID = useCallStore.getState().callSessionID;
    await VoiceEngine.confirmPeerVerification();
    assertIdentityGeneration(generation);
    if (!callID || useCallStore.getState().callSessionID !== callID) return;
    await this.beginDirectConnection();
  }

  async setMuted(muted: boolean): Promise<void> {
    const generation = currentIdentityGeneration();
    await VoiceEngine.setMuted(muted);
    assertIdentityGeneration(generation);
    useCallStore.getState().setCall({ muted });
  }

  async setSpeaker(speaker: boolean): Promise<void> {
    const generation = currentIdentityGeneration();
    await VoiceEngine.setOutputRoute(speaker ? 'speaker' : 'earpiece');
    assertIdentityGeneration(generation);
    useCallStore.getState().setCall({ speaker });
  }

  async hangUp(reason = 'normal'): Promise<void> {
    const generation = currentIdentityGeneration();
    this.activeAttempt = null;
    const callID = useCallStore.getState().callSessionID;
    this.clearPoll();
    wsManager.send('call-ended', { reason });
    wsManager.disconnect();
    this.clearSocketListeners();
    await this.stopNative(reason);
    if (callID) await endCallSession(callID, reason).catch((error) => logger.warn('Failed to persist call end', error));
    assertIdentityGeneration(generation);
    useCallStore.getState().resetCall();
    this.resetSetupFlags();
  }

  async stopForSessionEnd(): Promise<void> {
    this.activeAttempt = null;
    this.clearPoll();
    wsManager.disconnect();
    this.clearSocketListeners();
    const stopped = this.stopNative('session_ended');
    useCallStore.getState().resetCall();
    this.resetSetupFlags();
    await stopped;
  }

  async handleNetworkChange(): Promise<void> {
    const generation = currentIdentityGeneration();
    const current = useCallStore.getState();
    if (!current.callSessionID || current.callState === 'idle' || current.callState === 'ended') return;
    if (this.recoveryAttempts >= 1) {
      await this.hangUp('direct_ipv6_route_changed');
      useCallStore.getState().setCall({ callState: 'failed', error: 'The direct IPv6 route changed and reconnection failed.' });
      return;
    }
    this.recoveryAttempts++;
    this.activeAttempt = null;
    this.networkRecovery = true;
    this.keyEpoch++;
    this.setupStarted = false;
    this.directStarted = false;
    this.localRegistered = false;
    this.pendingEndpoint = null;
    wsManager.disconnect();
    await this.stopNative('network_changed');
    assertIdentityGeneration(generation);
    if (useCallStore.getState().callSessionID !== current.callSessionID) return;
    const call = await getCall(current.callSessionID);
    assertIdentityGeneration(generation);
    if (useCallStore.getState().callSessionID !== current.callSessionID) return;
    await this.beginHandshake(call);
  }

  private pollUntilReady(callID: string, deadline: number) {
    this.clearPoll();
    const generation = currentIdentityGeneration();
    const poll = async () => {
      try {
        const call = await getCall(callID);
        assertIdentityGeneration(generation);
        if (useCallStore.getState().callSessionID !== callID) return;
        const store = useCallStore.getState();
        store.setCall({ remoteUser: call.remote_username || store.remoteUser });
        if (call.state === 'awaiting_acceptance') {
          store.setCall({ callState: 'awaiting_acceptance' });
        } else if (call.state === 'handshaking' || call.state === 'verifying' || call.state === 'connecting' || call.state === 'active') {
          await this.beginHandshake(call);
          return;
        } else if (call.state === 'ended') {
          store.setCall({ callState: 'ended', error: call.end_reason || null });
          return;
        }
      } catch (error) {
        try { assertIdentityGeneration(generation); } catch { return; }
        if (useCallStore.getState().callSessionID !== callID) return;
        logger.warn('Call status poll failed', error);
      }
      if (Date.now() >= deadline) {
        await this.hangUp('setup_timeout');
        useCallStore.getState().setCall({ callState: 'failed', error: 'The call setup timed out.' });
        return;
      }
      this.pollTimer = setTimeout(poll, POLL_MS);
    };
    void poll();
  }

  private async beginHandshake(call: CallSession): Promise<void> {
    const generation = currentIdentityGeneration();
    if (this.setupStarted) return;
    if (!call.remote_device_id || !call.remote_noise_static_public_key) return;
    this.setupStarted = true;
    this.clearPoll();
    await requestMicrophonePermission();
    assertIdentityGeneration(generation);
    const signalTicket = await requestSignalTicket(call.id);
    assertIdentityGeneration(generation);
    const connecting = wsManager.connectCall(call.id, signalTicket.ticket);
    const peerReady = wsManager.waitFor('peer-joined', 20_000);
    void peerReady.catch(() => undefined);
    await connecting;
    assertIdentityGeneration(generation);
    this.attachSocketListeners();
    await wsManager.waitFor('open', 10_000);
    assertIdentityGeneration(generation);
    await peerReady;
    assertIdentityGeneration(generation);
    const user = useAuthStore.getState().user;
    if (!user?.username) throw new Error('Signed-in account is required');
    useCallStore.getState().setCall({ callState: 'handshaking', remoteUser: call.remote_username || 'Peer' });
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const attemptId = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    await this.prepareNative({
      callId: call.id,
      attemptId,
      accountScope: user.identity_scope || user.username,
      initiator: call.creator_principal_id === user.id,
      expectedRemotePublicKey: call.remote_noise_static_public_key,
      remoteDeviceId: call.remote_device_id,
      keyEpoch: this.keyEpoch,
    }, generation);
  }

  private attachSocketListeners() {
    this.clearSocketListeners();
    this.socketSubscriptions.push(
      wsManager.on('noise-handshake', (message) => {
        const frame = message.payload?.frame;
        if (typeof frame === 'string') VoiceEngine.consumeHandshakeFrame(frame).catch((error) => this.fail(error));
      }),
      wsManager.on('direct-endpoint', (message) => {
        const endpoint = message.payload?.endpoint;
        if (typeof endpoint !== 'string') return;
        if (this.localRegistered) VoiceEngine.setDirectEndpoint(endpoint).catch((error) => this.fail(error));
        else this.pendingEndpoint = endpoint;
      }),
      wsManager.on('call-ended', () => {
        const generation = currentIdentityGeneration();
        const callId = useCallStore.getState().callSessionID;
        this.activeAttempt = null;
        void this.stopNative('peer_hangup').then(() => {
          try { assertIdentityGeneration(generation); } catch { return; }
          if (!callId || useCallStore.getState().callSessionID !== callId) return;
          wsManager.disconnect();
          useCallStore.getState().setCall({ callState: 'ended' });
        }).catch((error) => {
          try { assertIdentityGeneration(generation); } catch { return; }
          if (callId && useCallStore.getState().callSessionID === callId) this.fail(error);
        });
      }),
      wsManager.on('close', () => {
        if (!['idle', 'active', 'ended'].includes(useCallStore.getState().callState)) {
          this.fail(new Error('The secure setup connection closed.'));
        }
      }),
    );
  }

  private async beginDirectConnection(): Promise<void> {
    const generation = currentIdentityGeneration();
    if (this.directStarted) return;
    const current = useCallStore.getState();
    if (!current.callSessionID) return;
    this.directStarted = true;
    current.setCall({ callState: 'discovering' });
    if (current.role === 'creator' && !this.networkRecovery) {
      await setCallLifecycle(current.callSessionID, 'connecting');
      assertIdentityGeneration(generation);
    }
    const ticket = await requestDirectTicket(current.callSessionID);
    assertIdentityGeneration(generation);
    await VoiceEngine.registerDirectEndpoint({
      ticketId: ticket.ticket_id,
      secret: ticket.secret,
      rendezvousHost: ticket.rendezvous_host,
      rendezvousPort: ticket.rendezvous_port,
    });
    assertIdentityGeneration(generation);
    this.localRegistered = true;
    current.setCall({ callState: 'connecting' });
    if (this.pendingEndpoint) {
      const endpoint = this.pendingEndpoint;
      this.pendingEndpoint = null;
      await VoiceEngine.setDirectEndpoint(endpoint);
    }
  }

  private fail(error: unknown) {
    if (!this.hasAuthorizedCall()) return;
    const message = error instanceof Error ? error.message : 'Direct IPv6 call failed.';
    logger.error('Native voice call failed', error);
    useCallStore.getState().setCall({ callState: 'failed', error: message });
  }

  private clearPoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private resetSetupFlags() {
    this.activeAttempt = null;
    this.clearPoll();
    this.clearSocketListeners();
    this.setupStarted = false;
    this.directStarted = false;
    this.localRegistered = false;
    this.pendingEndpoint = null;
    this.keyEpoch = 1;
    this.networkRecovery = false;
    this.recoveryAttempts = 0;
  }

  private clearSocketListeners() {
    this.socketSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.socketSubscriptions = [];
  }
}

async function requestMicrophonePermission(): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Direct voice is available on Android 10 or newer.');
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone permission',
    message: 'Microphone access is required for direct voice calls.',
    buttonPositive: 'Allow',
    buttonNegative: 'Cancel',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission was not granted.');
}

export const nativeVoiceCoordinator = new NativeVoiceCoordinator();
