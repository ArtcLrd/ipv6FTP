import { create } from 'zustand';
import { CallState } from './types';
import type { MediaStream } from 'react-native-webrtc';

interface CallStore {
  callState: CallState;
  callSessionID: string | null;
  remoteUser: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  setCallState: (state: CallState) => void;
  setCallSessionID: (callSessionID: string | null) => void;
  setRemoteUser: (user: string | null) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  resetCall: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  callState: 'idle',
  callSessionID: null,
  remoteUser: null,
  localStream: null,
  remoteStream: null,
  setCallState: (callState) => set({ callState }),
  setCallSessionID: (callSessionID) => set({ callSessionID }),
  setRemoteUser: (remoteUser) => set({ remoteUser }),
  setLocalStream: (localStream) => set({ localStream }),
  setRemoteStream: (remoteStream) => set({ remoteStream }),
  resetCall: () => set({ 
    callState: 'idle', 
    callSessionID: null,
    remoteUser: null, 
    localStream: null, 
    remoteStream: null 
  }),
}));
