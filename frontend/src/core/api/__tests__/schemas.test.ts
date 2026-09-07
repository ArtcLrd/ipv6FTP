import {
  UserSchema,
  AuthResponseSchema,
  CheckUsernameResponseSchema,
  ContactSchema,
  ContactListSchema,
  PeerInfoSchema,
  TurnCredentialsResponseSchema,
  CreateRoomResponseSchema,
} from '../schemas';

describe('Zod Schema Validations', () => {
  describe('UserSchema', () => {
    it('should validate a valid User object with optional fields', () => {
      const validUser = {
        id: 'user-123',
        username: 'alice',
        role: 'user',
        status: 'online',
        ip_addr: '2001:db8::1',
        last_seen: '2026-06-16T12:00:00Z',
      };
      const result = UserSchema.safeParse(validUser);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validUser);
    });

    it('should validate a valid User object with minimal fields', () => {
      const minimalUser = {
        id: 'user-123',
        username: 'alice',
      };
      const result = UserSchema.safeParse(minimalUser);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('user-123');
      expect(result.data?.username).toBe('alice');
      expect(result.data?.role).toBeUndefined();
    });

    it('should fail validation if id is missing', () => {
      const invalidUser = {
        username: 'alice',
      };
      const result = UserSchema.safeParse(invalidUser);
      expect(result.success).toBe(false);
    });
  });

  describe('AuthResponseSchema', () => {
    it('should validate standard AuthResponse', () => {
      const response = {
        access_token: 'access-token-xyz',
        refresh_token: 'refresh-token-abc',
        user: {
          id: 'user-123',
          username: 'alice',
        },
      };
      const result = AuthResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.access_token).toBe('access-token-xyz');
    });
  });

  describe('CheckUsernameResponseSchema', () => {
    it('should validate exists response', () => {
      const response = {
        exists: true,
        username: 'alice',
      };
      const result = CheckUsernameResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.exists).toBe(true);
    });
  });

  describe('ContactSchema & ContactListSchema', () => {
    it('should validate Contact schema and set defaults/transformations', () => {
      const contact = {
        id: 'c-1',
        username: 'bob',
        direction: 'added_by_me',
      };
      const result = ContactSchema.safeParse(contact);
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('offline'); // default value
      expect(result.data?.ip_addr).toBe(''); // transformed from null/undefined
      expect(result.data?.direction).toBe('added_by_me');
    });

    it('should transform ip_addr if null or optional', () => {
      const contact = {
        id: 'c-1',
        username: 'bob',
        status: 'online',
        ip_addr: null,
        direction: 'added_me',
      };
      const result = ContactSchema.safeParse(contact);
      expect(result.success).toBe(true);
      expect(result.data?.ip_addr).toBe('');
    });

    it('should validate lists of contacts', () => {
      const list = [
        { id: '1', username: 'bob', direction: 'added_by_me' as const },
        { id: '2', username: 'charlie', direction: 'added_me' as const, ip_addr: '::1' },
      ];
      const result = ContactListSchema.safeParse(list);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].status).toBe('offline');
      expect(result.data?.[1].ip_addr).toBe('::1');
    });
  });

  describe('PeerInfoSchema', () => {
    it('should handle optional/null fields and apply defaults', () => {
      const rawPeer = {
        username: 'peer1',
      };
      const result = PeerInfoSchema.safeParse(rawPeer);
      expect(result.success).toBe(true);
      expect(result.data?.is_ipv6_active).toBe(false);
      expect(result.data?.is_ipv4_fallback).toBe(false);
      expect(result.data?.is_online).toBe(false);
      expect(result.data?.ipv6_address).toBe('');
      expect(result.data?.ipv4_address).toBe('');
      expect(result.data?.public_key).toBe('');
    });

    it('should preserve addresses and public key when provided', () => {
      const rawPeer = {
        username: 'peer1',
        ipv6_address: '2001:db8::2',
        ipv4_address: '192.168.1.5',
        is_ipv6_active: true,
        is_online: true,
        public_key: 'pubkey-12345',
      };
      const result = PeerInfoSchema.safeParse(rawPeer);
      expect(result.success).toBe(true);
      expect(result.data?.ipv6_address).toBe('2001:db8::2');
      expect(result.data?.ipv4_address).toBe('192.168.1.5');
      expect(result.data?.is_ipv6_active).toBe(true);
      expect(result.data?.is_online).toBe(true);
      expect(result.data?.public_key).toBe('pubkey-12345');
    });
  });

  describe('TurnCredentialsResponseSchema', () => {
    it('should validate server options and default list', () => {
      const raw = {
        servers: [
          {
            urls: 'turn:turn.example.com:3478',
            username: 'user',
            credential: 'pwd',
          },
          {
            urls: ['stun:stun1.example.com:3478', 'stun:stun2.example.com:3478'],
          },
        ],
      };
      const result = TurnCredentialsResponseSchema.safeParse(raw);
      expect(result.success).toBe(true);
      expect(result.data?.servers).toHaveLength(2);
      expect(result.data?.servers[0].urls).toBe('turn:turn.example.com:3478');
      expect(result.data?.servers[1].urls).toEqual(['stun:stun1.example.com:3478', 'stun:stun2.example.com:3478']);
    });

    it('should supply default servers array when missing', () => {
      const raw = {};
      const result = TurnCredentialsResponseSchema.safeParse(raw);
      expect(result.success).toBe(true);
      expect(result.data?.servers).toEqual([]);
    });
  });

  describe('CreateRoomResponseSchema', () => {
    it('should validate create room response', () => {
      const raw = { room_id: 'room-555' };
      const result = CreateRoomResponseSchema.safeParse(raw);
      expect(result.success).toBe(true);
      expect(result.data?.room_id).toBe('room-555');
    });
  });
});
