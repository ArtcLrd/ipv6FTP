import { z } from 'zod';

/**
 * Strict mirrors of backend/internal/transport/http/contracts. Both sides are
 * tested against backend/testdata/contracts/v2, so change them together.
 */

const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const grant = z.string().min(1).max(512);
const email = z.string().max(254).regex(/^[^@\s]{1,64}@[^@\s]{1,255}$/).refine((v) => v.slice(v.lastIndexOf('@')).includes('.'));

// Length-only password policy: 15-128 code points, at most 512 UTF-8 bytes.
// The server additionally screens common passwords; the client cannot.
export const newPassword = z.string()
  .refine((v) => { const n = Array.from(v).length; return n >= 15 && n <= 128; })
  .refine((v) => new TextEncoder().encode(v).length <= 512);

export const newUsername = z.string().regex(/^[a-z0-9_]{3,30}$/);

export const ERROR_CODES = [
  'validation_failed', 'access_expired', 'session_invalid', 'forbidden', 'restricted', 'not_found',
  'conflict', 'operation_conflict', 'pending_operation', 'quota_exhausted', 'rate_limited',
  'unavailable', 'upgrade_required',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string().min(1),
    retry_after_seconds: z.number().int().nonnegative().optional(),
    reset_at: z.string().datetime({ offset: true }).optional(),
  }).strict(),
}).strict();

export const FRESH_AUTH_OPERATIONS = [
  'password_change', 'email_change', 'recovery_codes', 'username_change', 'delete_account', 'cancel_deletion',
] as const;

export const FreshAuthRequestSchema = z.object({
  password: z.string().min(1).max(512),
  operation: z.enum(FRESH_AUTH_OPERATIONS),
}).strict();

export const PasswordChangeRequestSchema = z.object({ fresh_auth_grant: grant, new_password: newPassword }).strict();

export const RecoveryBeginRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('saved_code'), identifier: z.string().trim().min(1).max(64) }).strict(),
  z.object({ method: z.literal('email'), identifier: email }).strict(),
]);

export const RecoveryProveRequestSchema = z.object({ recovery_id: z.string().min(16).max(512), code: z.string().min(8).max(64) }).strict();
export const RecoveryCompleteRequestSchema = z.object({ recovery_grant: grant, new_password: newPassword }).strict();
export const RecoveryCodesRequestSchema = z.object({ fresh_auth_grant: grant }).strict();
export const EmptyRequestSchema = z.object({}).strict();
export const RecoveryAckRequestSchema = z.object({
  code: z.string().max(64).refine((code) => /^[A-Z2-7]{25}[AEIMQUY4]$/.test(code.trim().toUpperCase().replace(/[ -]/g, ''))),
}).strict();
export const EmailChallengeRequestSchema = z.object({ fresh_auth_grant: grant, email }).strict();
export const EmailVerifyRequestSchema = z.object({ challenge_id: uuid, code: z.string().regex(/^[0-9]{8}$/) }).strict();
export const UsernameChangeRequestSchema = z.object({ fresh_auth_grant: grant, username: newUsername }).strict();
export const DeletionRequestSchema = z.object({ fresh_auth_grant: grant, confirm: z.literal(true) }).strict();

// ---- responses ----
const recoveryCode = z.string().min(16).max(64);
export const RecoveryBeginResponseSchema = z.object({ recovery_id: z.string().min(16).max(512) }).strict();
export const RecoveryProveResponseSchema = z.object({ recovery_grant: grant }).strict();
export const RecoveryCodesResponseSchema = z.object({ recovery_codes: z.array(recoveryCode).length(10) }).strict();
export const RecoveryCompleteResponseSchema = RecoveryCodesResponseSchema;
export const FreshAuthResponseSchema = z.object({
  fresh_auth_grant: grant,
  expires_in_seconds: z.number().int().min(1).max(300),
}).strict();
export const EmailChallengeResponseSchema = z.object({ challenge_id: uuid }).strict();

export const ACCOUNT_STATES = ['setup_pending', 'recovery_setup', 'active', 'restricted', 'pending_deletion'] as const;

const byteString = (min: number, max: number) =>
  z.string().refine((value) => {
    const length = new TextEncoder().encode(value).length;
    return length >= min && length <= max;
  });
const base64url = (min: number, max: number) =>
  z.string().max(Math.ceil(max * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/).refine((value) => {
    const length = Math.floor(value.length * 3 / 4);
    return value.length % 4 !== 1 && length >= min && length <= max;
  });
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const lifetime = z.number().int().positive();

export const RegisteredBeginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().pipe(newUsername),
  password: newPassword,
  schema_version: z.literal(2),
}).strict();
export const SetupResumeRequestSchema = z.object({
  username: byteString(1, 64),
  password: byteString(1, 512),
}).strict();
export const SetupGrantResponseSchema = z.object({
  setup_grant: byteString(1, 512),
  expires_in_seconds: lifetime.max(900),
}).strict();
export const EnrollChallengeRequestSchema = z.object({ setup_grant: byteString(1, 512), rotation_supported: z.boolean().optional() }).strict();
export const EnrollChallengeResponseSchema = z.object({
  challenge_id: uuid,
  principal_id: uuid,
  nonce: base64url(32, 32),
  expires_in_seconds: lifetime.max(300),
  server_key_id: keyId,
}).strict();
export const EnrollFinishRequestSchema = z.object({
  challenge_id: uuid,
  handshake: base64url(96, 96),
}).strict();
export const EnrollFinishResponseSchema = z.object({ handshake: base64url(48, 4096) }).strict();
export const ServerKeyResponseSchema = z.object({
  rotation: z.object({
    signer: base64url(91, 91),
    signature: base64url(8, 72),
    epoch: z.number().int().min(1).max(0xffffffff),
  }).strict().optional(),
  key_id: keyId,
  public_key: base64url(32, 32),
}).strict();
export const RefreshRequestSchema = z.object({ refresh_token: byteString(16, 512) }).strict();
export const RefreshResponseSchema = z.object({
  access_token: byteString(1, 2048),
  refresh_token: byteString(16, 512),
  expires_in_seconds: lifetime,
}).strict();
export const SessionGrantSchema = RefreshResponseSchema.extend({
  rotation_signer: base64url(91, 91).optional(),
  principal_id: uuid,
  session_id: uuid,
  device_id: uuid,
  generation: z.number().int().positive(),
  account_state: z.enum(ACCOUNT_STATES),
}).strict();

// Unknown account types or states fail parsing, so callers must treat a parse
// failure as "deny protected continuation" rather than defaulting to registered.
export const BootstrapSnapshotSchema = z.object({
  eligibility: z.object({ all_services_gated: z.boolean(), allowed_seconds: z.number().int().nonnegative().optional() }).strict().optional(),
  reset_at: z.string().datetime({ offset: true }).optional(),
  reminder: z.object({ code: z.string().min(1), reason: z.string().min(1), trigger_period_key: z.string().min(1) }).strict().optional(),
  deletion_deadline: z.string().datetime({ offset: true }).optional(),
  event_cursor: z.string().min(1).refine((value) => new TextEncoder().encode(value).length <= 512).optional(),
  schema_version: z.literal(2),
  revision: z.number().int().nonnegative(),
  principal_id: uuid,
  device_id: uuid,
  session_id: uuid,
  generation: z.number().int().nonnegative(),
  username: z.string().min(1).max(64),
  account_type: z.enum(['registered', 'guest']),
  account_state: z.enum(ACCOUNT_STATES),
  capabilities: z.array(z.string()).max(32),
  policy_version: z.number().int().nonnegative(),
  device_key_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export const CONTRACTS_V2 = {
  ErrorEnvelope: ErrorEnvelopeSchema,
  RegisteredBeginRequest: RegisteredBeginRequestSchema,
  SetupResumeRequest: SetupResumeRequestSchema,
  SetupGrantResponse: SetupGrantResponseSchema,
  EnrollChallengeRequest: EnrollChallengeRequestSchema,
  EnrollChallengeResponse: EnrollChallengeResponseSchema,
  EnrollFinishRequest: EnrollFinishRequestSchema,
  EnrollFinishResponse: EnrollFinishResponseSchema,
  ServerKeyResponse: ServerKeyResponseSchema,
  RefreshRequest: RefreshRequestSchema,
  RefreshResponse: RefreshResponseSchema,
  SessionGrant: SessionGrantSchema,
  FreshAuthRequest: FreshAuthRequestSchema,
  PasswordChangeRequest: PasswordChangeRequestSchema,
  RecoveryBeginRequest: RecoveryBeginRequestSchema,
  RecoveryProveRequest: RecoveryProveRequestSchema,
  RecoveryCompleteRequest: RecoveryCompleteRequestSchema,
  EmailChallengeRequest: EmailChallengeRequestSchema,
  EmailVerifyRequest: EmailVerifyRequestSchema,
  UsernameChangeRequest: UsernameChangeRequestSchema,
  DeletionRequest: DeletionRequestSchema,
  RecoveryCodesRequest: RecoveryCodesRequestSchema,
  EmptyRequest: EmptyRequestSchema,
  RecoveryAckRequest: RecoveryAckRequestSchema,
  BootstrapSnapshot: BootstrapSnapshotSchema,
  RecoveryBeginResponse: RecoveryBeginResponseSchema,
  RecoveryProveResponse: RecoveryProveResponseSchema,
  RecoveryCompleteResponse: RecoveryCompleteResponseSchema,
  RecoveryCodesResponse: RecoveryCodesResponseSchema,
  FreshAuthResponse: FreshAuthResponseSchema,
  EmailChallengeResponse: EmailChallengeResponseSchema,
} as const;

export type BootstrapSnapshot = z.infer<typeof BootstrapSnapshotSchema>;
