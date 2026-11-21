import client from '../../core/api/client';
import type { CallSession } from './types';

export interface CallInvitation {
  call_session_id: string;
  participant_id: string;
  invitation_id: string;
  fallback_code: string;
  policy_mode: string;
  allowed_seconds?: number;
  expires_at?: string;
}

export interface JoinCallResponse {
  call_session_id: string;
  participant_id: string;
  media_type: 'voice';
  connection_route: 'direct_ipv6';
  policy_mode: string;
  state: 'awaiting_acceptance';
  allowed_seconds?: number;
}

export interface SignalTicket { ticket: string; expires_at: string }
export interface DirectTicketResponse {
  ticket_id: string;
  secret: string;
  rendezvous_host: string;
  rendezvous_port: number;
  expires_at: string;
}

export async function createCall(): Promise<CallInvitation> {
  const { data } = await client.post<CallInvitation>('/api/v1/calls', {
    media_type: 'voice',
    connection_route: 'direct_ipv6',
  });
  return data;
}

export async function joinCallByCode(code: string): Promise<JoinCallResponse> {
  const { data } = await client.post<JoinCallResponse>('/api/v1/calls/join', { code });
  return data;
}

export async function getCall(callID: string): Promise<CallSession> {
  const { data } = await client.get<CallSession>(`/api/v1/calls/${encodeURIComponent(callID)}`);
  return data;
}

export async function acceptCall(callID: string): Promise<void> {
  await client.post(`/api/v1/calls/${encodeURIComponent(callID)}/accept`);
}

export async function setCallLifecycle(callID: string, state: 'verifying' | 'connecting' | 'active'): Promise<void> {
  await client.post(`/api/v1/calls/${encodeURIComponent(callID)}/state`, { state });
}

export async function requestSignalTicket(callID: string): Promise<SignalTicket> {
  const { data } = await client.post<SignalTicket>(`/api/v1/calls/${encodeURIComponent(callID)}/signal-ticket`);
  return data;
}

export async function requestDirectTicket(callID: string): Promise<DirectTicketResponse> {
  const { data } = await client.post<DirectTicketResponse>(`/api/v1/calls/${encodeURIComponent(callID)}/direct-ticket`);
  return data;
}

export async function endCallSession(callSessionID: string, reason = 'normal'): Promise<void> {
  await client.post(`/api/v1/calls/${encodeURIComponent(callSessionID)}/end`, { reason });
}
