import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as contactsApi from './api';

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => contactsApi.listContacts(),
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
