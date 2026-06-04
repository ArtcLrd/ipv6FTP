import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as contactsApi from './api';
import { useContactsStore } from './store';

export function useContacts() {
  const queryClient = useQueryClient();
  const setContacts = useContactsStore((state) => state.setContacts);

  return useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const data = await contactsApi.listContacts();
      setContacts(data);
      return data;
    },
  });
}

export function useAddContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactID: string) => contactsApi.addContact(contactID),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => contactsApi.deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
