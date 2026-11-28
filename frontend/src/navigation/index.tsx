import React from 'react';
import { DefaultTheme, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../modules/auth/hooks';
import { useCallStore } from '../modules/call/store';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { RecoveryPage } from '../pages/RecoveryPage';
import { AccountSetupPage } from '../pages/AccountSetupPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { RecoveryCodesPage } from '../pages/RecoveryCodesPage';
import { ContactsPage } from '../pages/ContactsPage';
import { CallsPage } from '../pages/CallsPage';
import { AddUserPage } from '../pages/AddUserPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ContactDetailsPage } from '../pages/ContactDetailsPage';
import { NativeCallPage } from '../pages/NativeCallPage';
import { View, ActivityIndicator, Modal, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { TabBar } from '../components/TabBar';
import { PromptCoordinator } from '../components/PromptCoordinator';
import { usePromptStore } from '../modules/prompts/store';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../modules/auth/store';
import { canRetryServerLogout, dismissServerLogoutWarning, retryLocalLogout, restoreSession, retryServerLogout, logout } from '../modules/auth/api';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Theme.colors.background,
    card: Theme.colors.surface,
    text: Theme.colors.textPrimary,
    border: Theme.colors.border,
    primary: Theme.colors.accent,
  },
};

function LockedFeaturePage({ title }: { title: string }) {
  const showPrompt = usePromptStore((state) => state.showPrompt);
  const openPrompt = () => {
    showPrompt({
      code: 'guest_restricted_feature',
      reason: 'restricted_feature',
      trigger_period_key: `feature:${title.toLowerCase()}`,
    });
  };

  return (
    <View style={lockedStyles.container}>
      <View style={lockedStyles.card}>
        <Ionicons name="lock-closed-outline" size={36} color={Theme.colors.accent} />
        <Text style={lockedStyles.title}>{title} is for accounts</Text>
        <Text style={lockedStyles.body}>Sign up to unlock contacts, search, devices, and registered calling benefits.</Text>
        <TouchableOpacity style={lockedStyles.button} onPress={openPrompt}>
          <Text style={lockedStyles.buttonText}>See benefits</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TabNavigator({ isGuest }: { isGuest: boolean }) {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Calls" component={CallsPage} />
      <Tab.Screen name="Settings" component={SettingsPage} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { hasIdentity, isGuest, isLoading } = useAuth();
  const status = useAuthStore((state) => state.sessionStatus);
  const { callState } = useCallStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Theme.colors.background }}>
        <ActivityIndicator size="large" color={Theme.colors.accent} />
      </View>
    );
  }

  if (status === 'setup') return <AccountSetupPage />;

  if (status === 'restricted' || status === 'pending_deletion' || status === 'quota_gated') {
    const deadline = useAuthStore.getState().stateDeadline;
    return <View style={lockedStyles.container}><View style={lockedStyles.card}>
      <Text style={lockedStyles.title}>{status === 'restricted' ? 'Account restricted' : status === 'pending_deletion' ? 'Account deletion pending' : 'Service limit reached'}</Text>
      {deadline && <Text style={lockedStyles.body}>{deadline}</Text>}
      <TouchableOpacity style={lockedStyles.button} onPress={() => void restoreSession()}><Text style={lockedStyles.buttonText}>Retry</Text></TouchableOpacity>
      {status === 'quota_gated' && <TouchableOpacity onPress={() => void logout().catch(() => undefined)}><Text style={lockedStyles.body}>Sign in or register</Text></TouchableOpacity>}
      <TouchableOpacity onPress={() => void logout().catch(() => undefined)}><Text style={lockedStyles.body}>Sign out</Text></TouchableOpacity>
    </View></View>;
  }

  if (status === 'password_changed' || status === 'password_change_uncertain') {
    return <View style={lockedStyles.container}><View style={lockedStyles.card}>
      <Text style={lockedStyles.title}>{status === 'password_changed' ? 'Password changed' : 'Password change unconfirmed'}</Text>
      <Text style={lockedStyles.body}>{status === 'password_changed'
        ? 'Your sessions have been signed out. Sign in again with your new password.'
        : 'The server response was lost. Try signing in with your new password. If it does not work, try your previous password.'}</Text>
      <TouchableOpacity style={lockedStyles.button} onPress={() => useAuthStore.getState().clearAuth()}><Text style={lockedStyles.buttonText}>Sign in</Text></TouchableOpacity>
    </View></View>;
  }

  if (status === 'upgrade_required') {
    return <View style={lockedStyles.container}>
      <Text style={lockedStyles.title}>Update the app to continue</Text>
    </View>;
  }
  if (status === 'logout_unconfirmed') {
    return <View style={lockedStyles.container}><View style={lockedStyles.card}>
      <Text style={lockedStyles.title}>Server logout unconfirmed</Text>
      <Text style={lockedStyles.body}>This device has signed out locally, but the server could not confirm session revocation. Retry when connected, or continue to sign in.</Text>
      {canRetryServerLogout() && <TouchableOpacity style={lockedStyles.button} onPress={() => void retryServerLogout()}><Text style={lockedStyles.buttonText}>Retry server logout</Text></TouchableOpacity>}
      <TouchableOpacity onPress={dismissServerLogoutWarning}><Text style={lockedStyles.body}>Continue to sign in</Text></TouchableOpacity>
    </View></View>;
  }
  if (status === 'offline' || status === 'storage_unavailable' || status === 'recovery_required' || status === 'logout_failed') {
    return <View style={lockedStyles.container}><View style={lockedStyles.card}>
      <Text style={lockedStyles.title}>{status === 'offline' ? 'Connection unavailable' : status === 'logout_failed' ? 'Logout incomplete' : status === 'storage_unavailable' ? 'Secure storage unavailable' : 'Sign in again'}</Text>
      <Text style={lockedStyles.body}>{status === 'offline' ? 'Your credentials are retained. Check your connection and retry.' : status === 'logout_failed' ? 'The app could not confirm that media stopped and credentials were cleared. Unlock your device if needed and retry.' : status === 'storage_unavailable' ? 'Unlock your device or retry when secure storage is available.' : 'Your session could not be restored safely. Sign in to continue.'}</Text>
      <TouchableOpacity style={lockedStyles.button} onPress={() => status === 'recovery_required' ? useAuthStore.getState().clearAuth() : status === 'logout_failed' ? void retryLocalLogout().catch(() => undefined) : void restoreSession()}><Text style={lockedStyles.buttonText}>{status === 'recovery_required' ? 'Sign in' : 'Retry'}</Text></TouchableOpacity>
    </View></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef} theme={appTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: {
              backgroundColor: Theme.colors.surface,
            },
            headerTintColor: Theme.colors.textPrimary,
            headerTitleStyle: {
              fontWeight: 'bold',
            },
            headerShadowVisible: false,
          }}
        >
          {hasIdentity ? (
            <>
              <Stack.Screen
                name="MainTabs"
                children={() => <TabNavigator isGuest={isGuest} />}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ContactDetails"
                component={ContactDetailsPage}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="ChangePassword" component={ChangePasswordPage} options={{ headerShown: false }} />
              <Stack.Screen name="RecoveryCodes" component={RecoveryCodesPage} options={{ headerShown: false }} />
              <Stack.Screen
                name="Login"
                component={LoginPage}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Register"
                component={RegisterPage}
                options={{ headerShown: false }}
              />
            </>
          ) : (
            <>
              <Stack.Screen name="Login" component={LoginPage} options={{ headerShown: false }} />
              <Stack.Screen name="Register" component={RegisterPage} options={{ headerShown: false }} />
              <Stack.Screen name="Recovery" component={RecoveryPage} options={{ headerShown: false }} />
            </>
          )}
        </Stack.Navigator>
        <PromptCoordinator navigateTo={(screen) => {
          if (navigationRef.isReady()) {
            navigationRef.navigate(screen as never);
          }
        }} />
      </NavigationContainer>

      <Modal
        visible={callState !== 'idle'}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <NativeCallPage />
      </Modal>
    </View>
  );
}

const lockedStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.lg,
    alignItems: 'center',
  },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    textAlign: 'center',
  },
  body: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Theme.spacing.lg,
  },
  button: {
    minHeight: 46,
    borderRadius: 6,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  buttonText: {
    color: Theme.colors.textPrimary,
    fontWeight: '800',
  },
});
