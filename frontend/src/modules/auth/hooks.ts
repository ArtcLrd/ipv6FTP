import { useMutation, useQuery } from '@tanstack/react-query';
import * as authApi from './api';
import { useAuthStore } from './store';

export function useAuth() {
  const { user, identityMode, hasIdentity, isAuthenticated, isLoading } = useAuthStore();
  return {
    user,
    identityMode,
    hasIdentity,
    isAuthenticated,
    isGuest: identityMode === 'guest',
    isExpiredGuest: false,
    isLoading,
  };
}

export function useLogin() {
  return useMutation({
    mutationFn: ({ username, password }: any) => authApi.login(username, password),
  });
}

export function useCheckUsername() {
  return useMutation({
    mutationFn: (username: string) => authApi.checkUsername(username),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: ({ username, password }: any) => authApi.register(username, password),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => authApi.logout(),
  });
}

export function useGetMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.getMe(),
    enabled: false, // Usually triggered manually or on app start
  });
}
