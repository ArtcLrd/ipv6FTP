import client from '../../core/api/client';
import { getOrCreateKeyPair } from '../../crypto/ecdh';
import { getMyIP } from '../user/api';

export interface PeerInfo {
  username: string;
  ipv6_address?: string;
  ipv4_address?: string;
  is_ipv6_active: boolean;
  is_ipv4_fallback: boolean;
  is_online: boolean;
  public_key?: string;
}

export async function lookupPeer(username: string): Promise<PeerInfo> {
  const { data } = await client.get<PeerInfo>(`/api/v1/phonebook/${username}`);
  return data;
}

export async function sendHeartbeat(): Promise<void> {
  const [ip, keyPair] = await Promise.all([getMyIP(), getOrCreateKeyPair()]);
  const isIPv6 = ip.includes(':');
  await client.post('/api/v1/phonebook/heartbeat', {
    ipv6_address: isIPv6 ? ip : '',
    ipv4_address: isIPv6 ? '' : ip,
    is_online: true,
    public_key: keyPair.publicKey,
  });
}

export async function uploadPublicKey(publicKey: string): Promise<void> {
  await client.post('/api/v1/phonebook/pubkey', { public_key: publicKey });
}
