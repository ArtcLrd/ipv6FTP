export type CallState = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected' | 'ended';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-ended';
  payload: any;
  from: string;
  to: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}
