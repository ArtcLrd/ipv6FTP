import client from '../../core/api/client';
import { UserProfile } from './types';

export async function getMyIP(): Promise<string> {
  const { data } = await client.get<{ ip: string }>('/api/myip');
  return typeof data?.ip === 'string' ? data.ip : '';
}

export async function updateIP(ip: string): Promise<void> {
  await client.post('/api/ip/update', { ip });
}

export async function searchUsers(query: string): Promise<UserProfile[]> {
  const { data } = await client.get<UserProfile[]>('/api/users/search', {
    params: { q: query },
  });
  return Array.isArray(data) ? data : [];
}
