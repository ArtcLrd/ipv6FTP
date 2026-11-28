import { AxiosError } from 'axios';
import { ApiErrorSchema } from '../../core/api/schemas';
import { usePromptStore } from './store';

export function handlePossibleQuotaPrompt(error: unknown): string | null {
  const axiosError = error as AxiosError;
  const parsed = ApiErrorSchema.safeParse(axiosError.response?.data);
  const details = parsed.success ? parsed.data.details : undefined;
  if (details?.reason_code !== 'quota_exhausted') {
    return null;
  }

  const periodKey = details.reset_at ? `quota:${details.reset_at}` : 'quota:current';
  const promptCode = details.eligible_conversion_prompt || 'guest_quota_exhausted';
  const store = usePromptStore.getState();
  if (store.isQuotaDismissed(periodKey)) {
    return details.reset_at ? `Quota exhausted. Try again after ${new Date(details.reset_at).toLocaleString()}.` : 'Quota exhausted for this period.';
  }

  store.showPrompt({
    code: promptCode,
    reason: 'quota_exhausted',
    trigger_period_key: periodKey,
    reset_at: details.reset_at,
  });
  return 'Quota exhausted for this period.';
}
