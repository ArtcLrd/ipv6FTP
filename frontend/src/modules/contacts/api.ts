import client from '../../core/api/client';
import { Contact } from './types';

export async function listContacts(): Promise<Contact[]> {
  const { data } = await client.get<Contact[]>('/api/contacts');
  return data;
}

export async function addContact(contactID: string): Promise<void> {
  await client.post('/api/contacts', {
    contact_id: contactID,
  });
}

export async function deleteContact(id: string): Promise<void> {
  await client.delete(`/api/contacts/${id}`);
}
