import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
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
import { View, ActivityIndicator, Modal } from 'react-native';
import { Theme } from '../theme';
import { TabBar } from '../components/TabBar';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

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

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Contacts" component={ContactsPage} />
      <Tab.Screen name="Calls" component={CallsPage} />
      <Tab.Screen name="Add" component={AddUserPage} />
      <Tab.Screen name="Settings" component={SettingsPage} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { callState } = useCallStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Theme.colors.background }}>
        <ActivityIndicator size="large" color={Theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer theme={appTheme}>
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
          {isAuthenticated ? (
            <>
              <Stack.Screen
                name="MainTabs"
                component={TabNavigator}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ContactDetails"
                component={ContactDetailsPage}
                options={{ headerShown: false }}
              />
            </>
          ) : (
            <>
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
          )}
        </Stack.Navigator>
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
