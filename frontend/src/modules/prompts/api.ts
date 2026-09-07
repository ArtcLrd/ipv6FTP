import client from '../../core/api/client';
import { PendingPromptsResponseSchema } from '../../core/api/schemas';
import type { GuestPrompt } from './store';

export async function listPendingPrompts(): Promise<GuestPrompt[]> {
  const { data: rawData } = await client.get('/api/v1/prompts');
  const data = PendingPromptsResponseSchema.parse(rawData);
  return data.prompts.map((prompt) => ({
    code: prompt.code,
    reason: prompt.reason as GuestPrompt['reason'],
    trigger_period_key: prompt.trigger_period_key || 'default',
  }));
}

export async function recordPromptAction(prompt: GuestPrompt, action: 'shown' | 'snoozed' | 'dismissed' | 'signup' | 'signin') {
  await client.post('/api/v1/prompts/actions', {
    code: prompt.code,
    trigger_period_key: prompt.trigger_period_key,
    action,
  });
}
