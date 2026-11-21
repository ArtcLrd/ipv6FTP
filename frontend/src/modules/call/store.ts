import { create } from 'zustand';
import type { CallRole, CallState } from './types';

interface CallStore {
  callState: CallState;
  callSessionID: string | null;
  role: CallRole | null;
  remoteUser: string | null;
  invitationCode: string | null;
  verificationCode: string | null;
  verificationRemembered: boolean;
  muted: boolean;
  speaker: boolean;
  error: string | null;
  setCall: (values: Partial<CallStore>) => void;
  resetCall: () => void;
}

const initial = {
  callState: 'idle' as CallState,
  callSessionID: null,
  role: null,
  remoteUser: null,
  invitationCode: null,
  verificationCode: null,
  verificationRemembered: false,
  muted: false,
  speaker: false,
  error: null,
};

export const useCallStore = create<CallStore>((set) => ({
  ...initial,
  setCall: (values) => set(values),
  resetCall: () => set(initial),
}));
