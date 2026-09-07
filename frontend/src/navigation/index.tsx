import React from 'react';
import { DefaultTheme, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../modules/auth/hooks';
import { useCallStore } from '../modules/call/store';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ContactsPage } from '../pages/ContactsPage';
import { CallsPage } from '../pages/CallsPage';
import { AddUserPage } from '../pages/AddUserPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ContactDetailsPage } from '../pages/ContactDetailsPage';
import { CallPage } from '../pages/CallPage';
import { View, ActivityIndicator, Modal, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { TabBar } from '../components/TabBar';
import { PromptCoordinator } from '../components/PromptCoordinator';
import { usePromptStore } from '../modules/prompts/store';
import { Ionicons } from '@expo/vector-icons';
import { bootstrapGuest } from '../modules/auth/api';

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
      <Tab.Screen name="Contacts">
        {() => isGuest ? <LockedFeaturePage title="Contacts" /> : <ContactsPage />}
      </Tab.Screen>
      <Tab.Screen name="Calls" component={CallsPage} />
      <Tab.Screen name="Add">
        {() => isGuest ? <LockedFeaturePage title="Add Users" /> : <AddUserPage />}
      </Tab.Screen>
      <Tab.Screen name="Settings" component={SettingsPage} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { hasIdentity, isGuest, isLoading } = useAuth();
  const { callState } = useCallStore();
  const [retryingGuest, setRetryingGuest] = React.useState(false);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Theme.colors.background }}>
        <ActivityIndicator size="large" color={Theme.colors.accent} />
      </View>
    );
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
              <Stack.Screen name="BootstrapRetry" options={{ headerShown: false }}>
                {() => (
                  <View style={lockedStyles.container}>
                    <View style={lockedStyles.card}>
                      <Ionicons name="cloud-offline-outline" size={38} color={Theme.colors.accent} />
                      <Text style={lockedStyles.title}>Could not reach the backend</Text>
                      <Text style={lockedStyles.body}>Guest mode needs a server connection before the app can open.</Text>
                      <TouchableOpacity
                        style={lockedStyles.button}
                        disabled={retryingGuest}
                        onPress={async () => {
                          setRetryingGuest(true);
                          try {
                            await bootstrapGuest();
                          } finally {
                            setRetryingGuest(false);
                          }
                        }}
                      >
                        <Text style={lockedStyles.buttonText}>{retryingGuest ? 'Retrying...' : 'Retry'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </Stack.Screen>
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
        <CallPage />
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
