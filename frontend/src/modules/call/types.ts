export type CallState =
  | 'idle'
  | 'waiting'
  | 'awaiting_acceptance'
  | 'handshaking'
  | 'verifying'
  | 'discovering'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'failed';

export type CallRole = 'creator' | 'joiner';

export interface CallSession {
  id: string;
  creator_principal_id: string;
  state: Exclude<CallState, 'idle' | 'discovering' | 'failed'>;
  media_type: 'voice';
  connection_route: 'direct_ipv6' | 'blind_relay_ipv4';
  created_at: string;
  accepted_at?: string;
  connected_at?: string;
  ended_at?: string;
  end_reason?: string;
  remote_principal_id?: string;
  remote_device_id?: string;
  remote_username?: string;
  remote_noise_static_public_key?: string;
}

export interface SignalingMessage {
  type: 'noise-handshake' | 'direct-endpoint' | 'call-ended' | 'state' | 'peer-joined' | 'peer-left';
  payload?: Record<string, unknown>;
}
