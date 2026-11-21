import axios from 'axios';
import { API_BASE_URL } from '../../config/env';
import { ErrorEnvelopeSchema, PasswordChangeRequestSchema, newPassword } from '../../core/api/contractsV2';
import { assertIdentityGeneration, currentIdentityGeneration, identitySignal } from '../auth/generation';
import { beginPasswordChange, finishPasswordChange, rejectPasswordChange } from '../auth/api';
import { requestFreshAuth } from './api';

/** A lost mutation response may mean the server changed the password. */
export async function changeAccountPassword(currentPassword: string, nextPassword: string): Promise<void> {
  newPassword.parse(nextPassword);
  const originalGeneration = currentIdentityGeneration();
  const grant = await requestFreshAuth(currentPassword, 'password_change');
  assertIdentityGeneration(originalGeneration);
  const body = PasswordChangeRequestSchema.parse({ fresh_auth_grant: grant, new_password: nextPassword });
  const context = await beginPasswordChange();
  const controller = new AbortController();
  const signal = identitySignal();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Password change timed out')); }, 10000);
  });
  try {
    assertIdentityGeneration(context.generation);
    if (signal.aborted) throw new Error('Password change cancelled');
    const response = await Promise.race([
      axios.post(`${API_BASE_URL}/api/v2/account/password`, body, {
        headers: { Authorization: `Bearer ${context.tokens.accessToken}` },
        timeout: 10000,
        signal: controller.signal,
      }),
      deadline,
    ]);
    if (response.status !== 204) throw new Error('Password change result was not confirmed');
  } catch (error) {
    assertIdentityGeneration(context.generation);
    const envelope = axios.isAxiosError(error) ? ErrorEnvelopeSchema.safeParse(error.response?.data) : null;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const code = envelope?.success ? envelope.data.error.code : undefined;
    const rejected = (status === 400 && code === 'validation_failed') ||
      (status === 403 && (code === 'forbidden' || code === 'restricted')) ||
      (status === 409 && code === 'conflict') || (status === 429 && code === 'rate_limited');
    if (rejected) {
      await rejectPasswordChange(context);
      throw error;
    }
    await finishPasswordChange(context.generation, false);
    return;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
  await finishPasswordChange(context.generation, true);
}
