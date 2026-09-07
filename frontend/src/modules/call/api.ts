import client from '../../core/api/client';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallInvitation {
  call_session_id: string;
  participant_id: string;
  invitation_id: string;
  link_token: string;
  join_url?: string;
  fallback_code: string;
  policy_mode: string;
  allowed_seconds?: number;
  expires_at?: string;
}

export interface JoinCallResponse {
  call_session_id: string;
  participant_id: string;
  media_type: string;
  network_family: string;
  policy_mode: string;
  allowed_seconds?: number;
}

export async function createRoom(): Promise<string> {
  const { data } = await client.post<{ room_id: string }>('/api/rooms/create');
  return data.room_id;
}

export async function sendRoomInvite(contactID: string, roomID: string, type = 'call'): Promise<void> {
  await client.post('/api/rooms/invite', {
    contact_id: contactID,
    room_id: roomID,
    type,
  });
}

export async function getTurnServers(): Promise<IceServer[]> {
  const { data } = await client.get<{ servers: IceServer[] }>('/api/v1/turn/credentials');
  return data.servers ?? [];
}

export async function createCallInvitation(mediaType = 'voice'): Promise<CallInvitation> {
  const { data } = await client.post<CallInvitation>('/api/v1/calls/invitations', {
    media_type: mediaType,
    network_family: 'ipv6',
  });
  return data;
}

export async function joinCallByCode(code: string): Promise<JoinCallResponse> {
  const { data } = await client.post<JoinCallResponse>('/api/v1/calls/join', { code });
  return data;
}

export async function joinCallByToken(token: string): Promise<JoinCallResponse> {
  const { data } = await client.post<JoinCallResponse>('/api/v1/calls/join', { token });
  return data;
}

export async function markCallStarted(callSessionID: string): Promise<void> {
  await client.post(`/api/v1/calls/${encodeURIComponent(callSessionID)}/start`);
}

export async function endCallSession(callSessionID: string, reason = 'normal'): Promise<void> {
  await client.post(`/api/v1/calls/${encodeURIComponent(callSessionID)}/end`, { reason });
}
