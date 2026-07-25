import { z } from 'zod';

// ── User Schema ─────────────────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string().optional(),
  status: z.string().optional(),
  ip_addr: z.string().nullable().optional(),
  last_seen: z.string().nullable().optional(),
});

export type User = z.infer<typeof UserSchema>;

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
