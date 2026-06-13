import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from './src/app/providers';
import { RootNavigator } from './src/navigation';
import { initializeSession } from './src/services/authService';
import { initializeNetworkService } from './src/services/networkService';
import { useAuthStore } from './src/modules/auth/store';

import { ToastNotification } from './src/components/ToastNotification';

export default function App() {
  const setLoading = useAuthStore((state) => state.setLoading);

  useEffect(() => {
    initializeNetworkService();
    async function initAuth() {
      try {
        await initializeSession();
      } catch (error) {
        console.log('No existing session found');
      } finally {
        setLoading(false);
      }
    }
    initAuth();
  }, [setLoading]);

  return (
    <AppProviders>
      <RootNavigator />
      <ToastNotification />
      <StatusBar style="light" />
    </AppProviders>
  );
}

