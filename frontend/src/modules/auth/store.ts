import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
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

interface AuthState {
  user: User | null;
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
  identityMode: 'initializing',
  hasIdentity: false,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => {
    const isGuest = user.account_type === 'guest' || user.role === 'guest';
    set({
      user,
      identityMode: isGuest ? 'guest' : 'registered',
      hasIdentity: true,
      isAuthenticated: !isGuest,
      isLoading: false,
    });
  },
  clearAuth: () => set({ user: null, identityMode: 'anonymous', hasIdentity: false, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));
