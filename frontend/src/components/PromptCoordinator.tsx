import React, { useEffect, useMemo, useRef } from 'react';
import { GuestBenefitsModal } from './GuestBenefitsModal';
import { useAuthStore } from '../modules/auth/store';
import { useCallStore } from '../modules/call/store';
import { recordPromptAction } from '../modules/prompts/api';
import { usePromptStore } from '../modules/prompts/store';

interface Props {
  navigateTo: (screen: 'Login' | 'Register') => void;
}

export function PromptCoordinator({ navigateTo }: Props) {
  const user = useAuthStore((state) => state.user);
  const callState = useCallStore((state) => state.callState);
  const activePrompt = usePromptStore((state) => state.activePrompt);
  const setPassivePrompts = usePromptStore((state) => state.setPassivePrompts);
  const dismissPrompt = usePromptStore((state) => state.dismissPrompt);
  const rememberQuotaDismissal = usePromptStore((state) => state.rememberQuotaDismissal);
  const shownKeyRef = useRef<string | null>(null);
  const isCallStable = callState === 'idle';

  useEffect(() => {
    if (!user?.pending_prompts?.length) return;
    setPassivePrompts(user.pending_prompts.map((prompt) => ({
      code: prompt.code,
      reason: prompt.reason as any,
      trigger_period_key: prompt.trigger_period_key || 'default',
    })));
  }, [setPassivePrompts, user?.pending_prompts]);

  const activeKey = useMemo(() => (
    activePrompt ? `${activePrompt.code}:${activePrompt.trigger_period_key}` : null
  ), [activePrompt]);

  useEffect(() => {
    if (!activePrompt || !isCallStable || shownKeyRef.current === activeKey) return;
    shownKeyRef.current = activeKey;
    recordPromptAction(activePrompt, 'shown').catch(() => undefined);
  }, [activeKey, activePrompt, isCallStable]);

  if (!activePrompt || !isCallStable) {
    return null;
  }

  const saveForLater = () => {
    if (activePrompt.reason === 'quota_exhausted') {
      rememberQuotaDismissal(activePrompt.trigger_period_key);
    }
    recordPromptAction(activePrompt, 'snoozed').catch(() => undefined);
    dismissPrompt();
  };

  const signUp = () => {
    recordPromptAction(activePrompt, 'signup').catch(() => undefined);
    dismissPrompt();
    navigateTo('Register');
  };

  const signIn = () => {
    recordPromptAction(activePrompt, 'signin').catch(() => undefined);
    dismissPrompt();
    navigateTo('Login');
  };

  return (
    <GuestBenefitsModal
      visible
      reason={activePrompt.reason}
      resetAt={activePrompt.reset_at}
      onSignUp={signUp}
      onSignIn={signIn}
      onSaveForLater={saveForLater}
    />
  );
}
