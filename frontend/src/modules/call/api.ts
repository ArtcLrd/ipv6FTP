import client from '../../core/api/client';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export async function createRoom(): Promise<string> {
  const { data } = await client.post<{ room_id: string }>('/api/rooms/create');
  return data.room_id;
}

export async function sendRoomInvite(contactID: string, roomID: string, type = 'call'): Promise<void> {
  await client.post('/api/rooms/invite', {
    contact_id: contactID,
    room_id: roomID,
    type,
  });
}

export async function getTurnServers(): Promise<IceServer[]> {
  const { data } = await client.get<{ servers: IceServer[] }>('/api/turn-credentials');
  return data.servers ?? [];
}
