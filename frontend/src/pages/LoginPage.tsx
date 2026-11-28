import React, { useState, useRef, useCallback, useEffect } from "react";
import { Alert } from 'react-native';
import { readRetainedProfile } from '../core/storage/secure';
import { removeSignedOutProfile } from '../modules/auth/api';
import { useLogin, useCheckUsername } from "../modules/auth/hooks";
import { getApiErrorMessage } from "../core/api/appErrors";
import { logger } from "../core/logger/logger";
import { LoginPageView, LoginPageViewRef } from "./LoginPageView";
import { useAuthStore } from '../modules/auth/store';

export function LoginPage({ navigation }: any) {
  const [step, setStep] = useState<"username" | "password">("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasRetainedProfile, setHasRetainedProfile] = useState(false);
  useEffect(() => { void readRetainedProfile().then((profile) => setHasRetainedProfile(!!profile)).catch(() => setHasRetainedProfile(true)); }, []);
  const tryRemoveProfile = useCallback(async () => {
    try {
      await removeSignedOutProfile();
      setHasRetainedProfile(false);
    } catch {
      if (useAuthStore.getState().sessionStatus === 'signed_out') {
        Alert.alert('Could not remove profile', 'Unlock secure storage and try again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => { void tryRemoveProfile(); } },
        ]);
      }
    }
  }, []);

  const viewRef = useRef<LoginPageViewRef>(null);

  const checkMutation = useCheckUsername();
  const loginMutation = useLogin();

  const handleContinue = useCallback(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      viewRef.current?.triggerShake();
      return;
    }
    checkMutation.mutate(trimmed, {
      onSuccess: (result) => {
        if (result.exists) {
          viewRef.current?.transitionToPassword(() => {
            setStep("password");
          });
        } else {
          navigation.navigate("Register", { username: trimmed });
        }
      },
      onError: (error) => {
        logger.error("Username check failed", getApiErrorMessage(error, "Could not verify username."));
        viewRef.current?.triggerShake();
      },
    });
  }, [username, checkMutation, navigation]);

  const handleLogin = useCallback(() => {
    if (!password) {
      viewRef.current?.triggerShake();
      return;
    }
    loginMutation.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          if (useAuthStore.getState().sessionStatus !== 'authenticated') return;
          if (typeof navigation.reset === "function") {
            navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
          } else {
            navigation.navigate("MainTabs");
          }
        },
        onError: (error) => {
          logger.error("Login failed", getApiErrorMessage(error, "Wrong password."));
          viewRef.current?.triggerShake();
        },
      }
    );
  }, [password, loginMutation, username]);

  const handleBackToUsername = useCallback(() => {
    viewRef.current?.resetToUsername(() => {
      setStep("username");
      setPassword("");
      loginMutation.reset();
      checkMutation.reset();
    });
  }, [loginMutation, checkMutation]);

  const handleRegister = useCallback(() => {
    navigation.navigate("Register", { username: "" });
  }, [navigation]);

  const isPending = checkMutation.isPending || loginMutation.isPending;

  const usernameError = checkMutation.isError
    ? getApiErrorMessage(checkMutation.error, "Could not verify username.")
    : null;
  const passwordError = loginMutation.isError
    ? getApiErrorMessage(loginMutation.error, "Wrong password.")
    : null;

  return (
    <LoginPageView
      ref={viewRef}
      username={username}
      setUsername={(val) => {
        setUsername(val);
        checkMutation.reset();
      }}
      password={password}
      setPassword={(val) => {
        setPassword(val);
        loginMutation.reset();
      }}
      step={step}
      isPending={isPending}
      usernameError={usernameError}
      passwordError={passwordError}
      onContinue={handleContinue}
      onLogin={handleLogin}
      onRegister={handleRegister}
      onBackToUsername={handleBackToUsername}
      onForgotPassword={() => navigation.navigate("Recovery")}
      onRemoveProfile={hasRetainedProfile ? () => Alert.alert('Remove profile from this device?', 'This removes the saved keys and trusted peers for this profile.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove profile', style: 'destructive', onPress: () => { void tryRemoveProfile(); } },
      ]) : undefined}
    />
  );
}
