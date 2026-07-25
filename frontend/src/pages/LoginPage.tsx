import React, { useState, useRef, useCallback } from "react";
import { useLogin, useCheckUsername } from "../modules/auth/hooks";
import { getApiErrorMessage } from "../core/api/appErrors";
import { logger } from "../core/logger/logger";
import { LoginPageView, LoginPageViewRef } from "./LoginPageView";

export function LoginPage({ navigation }: any) {
  const [step, setStep] = useState<"username" | "password">("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

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
    />
  );
}

