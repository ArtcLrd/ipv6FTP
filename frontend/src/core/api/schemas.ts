import { z } from 'zod';

// ── User Schema ─────────────────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  account_type: z.string().optional(),
  plan_code: z.string().optional(),
  auth_version: z.number().optional(),
  device_installation_id: z.string().optional(),
  roles: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  capabilities: z.record(z.string(), z.any()).optional(),
  pending_prompts: z.array(z.object({
    code: z.string(),
    reason: z.string(),
    trigger_period_key: z.string(),
    snooze_duration_seconds: z.number().optional(),
    due_at: z.string().nullable().optional(),
  })).optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  ip_addr: z.string().nullable().optional(),
  last_seen: z.string().nullable().optional(),
  trial_expires_at: z.string().nullable().optional(),
});

export type User = z.infer<typeof UserSchema>;

export const ConversionPromptSchema = z.object({
  code: z.string(),
  reason: z.enum(['quota_exhausted', 'weekly_benefits_reminder', 'restricted_feature']).or(z.string()),
  trigger_period_key: z.string().default('default'),
  snooze_duration_seconds: z.number().optional(),
  due_at: z.string().nullable().optional(),
});

export const PendingPromptsResponseSchema = z.object({
  prompts: z.array(ConversionPromptSchema).default([]),
});

export const ApiErrorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  details: z.object({
    reason_code: z.string().optional(),
    reset_at: z.string().optional(),
    eligible_conversion_prompt: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ── Auth Response Schema ────────────────────────────────────────────────────
export const AuthResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: UserSchema,
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Check Username Schema ───────────────────────────────────────────────────
export const CheckUsernameResponseSchema = z.object({
  exists: z.boolean(),
  username: z.string(),
});

// ── Contact Schema ──────────────────────────────────────────────────────────
export const ContactSchema = z.object({
  id: z.string(),
  username: z.string(),
  status: z.string().default('offline'),
  ip_addr: z.string().nullable().optional().transform(val => val || ''),
  direction: z.enum(['added_by_me', 'added_me']),
});

export const ContactListSchema = z.array(ContactSchema);

export type Contact = z.infer<typeof ContactSchema>;

// ── Peer Info Schema (Phonebook) ──────────────────────────────────────────
export const PeerInfoSchema = z.object({
  username: z.string(),
  ipv6_address: z.string().nullable().optional().transform(val => val || ''),
  ipv4_address: z.string().nullable().optional().transform(val => val || ''),
  is_ipv6_active: z.boolean().default(false),
  is_ipv4_fallback: z.boolean().default(false),
  is_online: z.boolean().default(false),
  public_key: z.string().nullable().optional().transform(val => val || ''),
});

export type PeerInfo = z.infer<typeof PeerInfoSchema>;

// ── Ice Server / TURN Schema ────────────────────────────────────────────────
export const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const TurnCredentialsResponseSchema = z.object({
  servers: z.array(IceServerSchema).default([]),
});

// ── Create Room Schema ──────────────────────────────────────────────────────
export const CreateRoomResponseSchema = z.object({
  room_id: z.string(),
});
