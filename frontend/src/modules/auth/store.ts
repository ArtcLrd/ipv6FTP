import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
  identity_scope?: string;
  account_type?: 'guest' | 'registered' | string;
  plan_code?: string;
  auth_version?: number;
  device_installation_id?: string;
  roles?: string[];
  permissions?: string[];
  capabilities?: Record<string, any>;
  pending_prompts?: Array<{
    code: string;
    reason: string;
    trigger_period_key: string;
    snooze_duration_seconds?: number;
    due_at?: string | null;
  }>;
  role?: string;
  status?: string;
  ip_addr?: string | null;
  last_seen?: string | null;
  trial_expires_at?: string | null;
}

export type IdentityMode = 'initializing' | 'guest' | 'registered' | 'anonymous';
export type SessionStatus = 'restoring' | 'signed_out' | 'enrolling' | 'setup' | 'authenticated' | 'restricted' | 'pending_deletion' | 'quota_gated' | 'password_changing' | 'password_changed' | 'password_change_uncertain' | 'offline' | 'storage_unavailable' | 'recovery_required' | 'terminating' | 'logout_failed' | 'logout_unconfirmed' | 'upgrade_required';

interface AuthState {
  user: User | null;
  stateDeadline: string | null;
  setStateDeadline: (value: string | null) => void;
  sessionStatus: SessionStatus;
  setSessionStatus: (status: SessionStatus) => void;
  identityMode: IdentityMode;
  hasIdentity: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  stateDeadline: null,
  setStateDeadline: (stateDeadline) => set({ stateDeadline }),
  sessionStatus: 'restoring',
  setSessionStatus: (sessionStatus) => set(sessionStatus === 'authenticated' || sessionStatus === 'password_changing' ? { sessionStatus } : { sessionStatus, user: null, hasIdentity: false, isAuthenticated: false, isLoading: sessionStatus === 'restoring' || sessionStatus === 'terminating' }),
  identityMode: 'initializing',
  hasIdentity: false,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => {
    const isGuest = user.account_type === 'guest' || user.role === 'guest';
    set({
      user,
      sessionStatus: 'authenticated',
      identityMode: isGuest ? 'guest' : 'registered',
      hasIdentity: true,
      isAuthenticated: !isGuest,
      isLoading: false,
    });
  },
  clearAuth: () => set({ sessionStatus: 'signed_out', user: null, stateDeadline: null, identityMode: 'anonymous', hasIdentity: false, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));
