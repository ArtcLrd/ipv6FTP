import client from '../../core/api/client';
import {
  EmailChallengeRequestSchema, EmailChallengeResponseSchema, EmailVerifyRequestSchema,
  FreshAuthRequestSchema, FreshAuthResponseSchema, PasswordChangeRequestSchema,
  RecoveryBeginRequestSchema, RecoveryBeginResponseSchema, RecoveryCodesResponseSchema,
  RecoveryCompleteRequestSchema, RecoveryCompleteResponseSchema,
  RecoveryProveRequestSchema, RecoveryProveResponseSchema, RecoveryCodesRequestSchema, FRESH_AUTH_OPERATIONS,
  RecoveryAckRequestSchema,
} from '../../core/api/contractsV2';
import type { z } from 'zod';

/**
 * Account-security API (M3). Requests are validated against the strict v2
 * contracts before leaving the device and responses before they are used.
 */
const V2 = '/api/v2';

function newOperationId(): string {
  // Not security sensitive; the server binds it to the actor and payload fingerprint.
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function post<S extends z.ZodTypeAny>(path: string, body: unknown, response: S, publicRequest = false): Promise<z.infer<S>> {
  const { data } = await client.post(`${V2}${path}`, body, publicRequest ? { public: true } : undefined);
  return response.parse(data);
}

// ---- recovery (unauthenticated; responses are intentionally generic) ----

export async function beginRecovery(input: z.input<typeof RecoveryBeginRequestSchema>): Promise<string> {
  const body = RecoveryBeginRequestSchema.parse(input);
  return (await post('/recovery/begin', body, RecoveryBeginResponseSchema, true)).recovery_id;
}

export async function proveRecovery(input: z.input<typeof RecoveryProveRequestSchema>): Promise<string> {
  const body = RecoveryProveRequestSchema.parse(input);
  return (await post('/recovery/prove', body, RecoveryProveResponseSchema, true)).recovery_grant;
}

/** Returns the replacement saved-code set. It does not sign the user in. */
export async function completeRecovery(input: z.input<typeof RecoveryCompleteRequestSchema>): Promise<string[]> {
  const body = RecoveryCompleteRequestSchema.parse(input);
  return (await post('/recovery/complete', body, RecoveryCompleteResponseSchema, true)).recovery_codes;
}

// ---- authenticated account security ----

export type FreshAuthOperation = (typeof FRESH_AUTH_OPERATIONS)[number];

/** Short-lived grant bound to one operation; never reuse it for another. */
export async function requestFreshAuth(password: string, operation: FreshAuthOperation): Promise<string> {
  const body = FreshAuthRequestSchema.parse({ password, operation });
  return (await post('/account/reauth', body, FreshAuthResponseSchema)).fresh_auth_grant;
}

export async function changePassword(freshAuthGrant: string, newPassword: string): Promise<void> {
  const body = PasswordChangeRequestSchema.parse({ fresh_auth_grant: freshAuthGrant, new_password: newPassword });
  await client.post(`${V2}/account/password`, body, { headers: { 'Idempotency-Key': newOperationId() } });
}

/** Plaintext codes are returned once; callers must not log, persist or analytics-track them. */
export async function regenerateRecoveryCodes(freshAuthGrant: string): Promise<string[]> {
  const body = RecoveryCodesRequestSchema.parse({ fresh_auth_grant: freshAuthGrant });
  const { data } = await client.post(`${V2}/account/recovery-codes`, body, { headers: { 'Idempotency-Key': newOperationId() } });
  return RecoveryCodesResponseSchema.parse(data).recovery_codes;
}

export async function acknowledgeRecoveryCodes(code: string): Promise<void> {
  await client.post(`${V2}/auth/setup/ack-recovery-codes`, RecoveryAckRequestSchema.parse({ code }), { headers: { 'Idempotency-Key': newOperationId() } });
}

export async function startEmailVerification(freshAuthGrant: string, email: string): Promise<string> {
  const body = EmailChallengeRequestSchema.parse({ fresh_auth_grant: freshAuthGrant, email });
  return (await post('/account/email/challenge', body, EmailChallengeResponseSchema)).challenge_id;
}

export async function verifyEmail(challengeId: string, code: string): Promise<void> {
  const body = EmailVerifyRequestSchema.parse({ challenge_id: challengeId, code });
  await client.post(`${V2}/account/email/verify`, body, { headers: { 'Idempotency-Key': newOperationId() } });
}
