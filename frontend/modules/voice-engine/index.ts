import { requireNativeModule } from 'expo-modules-core';

export type VoiceCallState =
  | 'idle'
  | 'preparing'
  | 'handshaking'
  | 'verifying'
  | 'discovering'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'failed';

export type VoiceEngineEventMap = {
  onCallState: { callId: string; attemptId: string; state: VoiceCallState; reason?: string };
  onHandshakeFrame: { callId: string; attemptId: string; frame: string };
  onVerification: { callId: string; attemptId: string; code: string; remembered: boolean; remotePublicKey: string };
  onQuality: { jitterMs: number; packetsLost: number; packetsReceived: number };
  onError: { callId: string; attemptId: string; code: string; message: string };
};

export interface DeviceIdentity {
  publicKey: string;
}

export interface PrepareCallOptions {
  callId: string;
  attemptId: string;
  accountScope: string;
  initiator: boolean;
  expectedRemotePublicKey: string;
  remoteDeviceId: string;
  keyEpoch: number;
}

export interface DirectTicket {
  ticketId: string;
  secret: string;
  rendezvousHost: string;
  rendezvousPort: number;
}

export interface Diagnostics {
  state: VoiceCallState;
  muted: boolean;
  speaker: boolean;
  keyEpoch: number;
  sentPackets: number;
  receivedPackets: number;
  droppedPackets: number;
  lastError?: string;
}

type Subscription = { remove(): void };

interface NativeVoiceEngine {
  beginEnrollmentProof(options: {
    challengeId: string;
    principalId: string;
    nonce: string;
    serverKey: string;
    keyId: string;
    origin: string;
    ttlSeconds: number;
    legacyScope?: string;
    rotation?: { signer: string; signature: string; epoch: number };
  }): Promise<string>;
  finishEnrollmentProof(challengeId: string, handshake: string): Promise<string>;
  cancelEnrollmentProof(challengeId: string): Promise<void>;
  getOrCreateIdentity(accountScope: string): Promise<DeviceIdentity>;
  identityFingerprint(accountScope: string): Promise<string | null>;
  removeProfile(accountScope: string, username: string): Promise<void>;
  hasIdentity(accountScope: string): Promise<boolean>;
  prepareCall(options: PrepareCallOptions): Promise<void>;
  consumeHandshakeFrame(frame: string): Promise<void>;
  registerDirectEndpoint(ticket: DirectTicket): Promise<string>;
  setDirectEndpoint(endpoint: string): Promise<void>;
  confirmPeerVerification(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setOutputRoute(route: 'earpiece' | 'speaker'): Promise<void>;
  endCall(reason?: string): Promise<void>;
  getDiagnostics(): Promise<Diagnostics>;
  addListener<K extends keyof VoiceEngineEventMap>(
    eventName: K,
    listener: (event: VoiceEngineEventMap[K]) => void,
  ): Subscription;
}

export default requireNativeModule<NativeVoiceEngine>('IPv6VoiceEngine');
