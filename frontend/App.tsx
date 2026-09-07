import React, { useEffect } from 'react';
import { AppProviders } from './src/app/providers';
import { AppShell } from './src/app/AppShell';
import { bootstrapApp } from './src/app/bootstrap';

export default function App() {
  useEffect(() => {
    bootstrapApp();
  }, []);

  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}


