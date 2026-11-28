import { create } from 'zustand';

export type GuestPromptReason = 'quota_exhausted' | 'weekly_benefits_reminder' | 'restricted_feature';

export interface GuestPrompt {
  code: string;
  reason: GuestPromptReason;
  trigger_period_key: string;
  reset_at?: string;
}

interface PromptState {
  activePrompt: GuestPrompt | null;
  queue: GuestPrompt[];
  dismissedQuotaPeriods: Record<string, true>;
  setPassivePrompts: (prompts: GuestPrompt[]) => void;
  showPrompt: (prompt: GuestPrompt) => void;
  dismissPrompt: () => void;
  rememberQuotaDismissal: (periodKey: string) => void;
  isQuotaDismissed: (periodKey: string) => boolean;
  clearPrompts: () => void;
}

const priority = (reason: GuestPromptReason) => {
  if (reason === 'quota_exhausted') return 0;
  if (reason === 'restricted_feature') return 1;
  return 2;
};

function ordered(prompts: GuestPrompt[]) {
  return [...prompts].sort((a, b) => priority(a.reason) - priority(b.reason));
}

export const usePromptStore = create<PromptState>((set, get) => ({
  activePrompt: null,
  queue: [],
  dismissedQuotaPeriods: {},
  setPassivePrompts: (prompts) => {
    const passive = prompts.filter((prompt) => prompt.reason === 'weekly_benefits_reminder');
    if (!passive.length || get().activePrompt) return;
    const [next, ...rest] = ordered(passive);
    set({ activePrompt: next, queue: rest });
  },
  showPrompt: (prompt) => {
    const { activePrompt, queue } = get();
    if (!activePrompt) {
      set({ activePrompt: prompt });
      return;
    }
    const nextQueue = ordered([prompt, activePrompt, ...queue]);
    const [next, ...rest] = nextQueue;
    set({ activePrompt: next, queue: rest });
  },
  dismissPrompt: () => {
    const [next, ...rest] = get().queue;
    set({ activePrompt: next ?? null, queue: rest });
  },
  rememberQuotaDismissal: (periodKey) => {
    if (!periodKey) return;
    set((state) => ({
      dismissedQuotaPeriods: { ...state.dismissedQuotaPeriods, [periodKey]: true },
    }));
  },
  isQuotaDismissed: (periodKey) => Boolean(periodKey && get().dismissedQuotaPeriods[periodKey]),
  clearPrompts: () => set({ activePrompt: null, queue: [], dismissedQuotaPeriods: {} }),
}));
