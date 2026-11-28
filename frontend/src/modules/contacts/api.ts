import client from '../../core/api/client';
import { ContactListSchema } from '../../core/api/schemas';
import type { Contact } from '../../core/api/schemas';

export async function listContacts(): Promise<Contact[]> {
  const { data: rawData } = await client.get('/api/contacts');
  const data = ContactListSchema.parse(rawData);
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

