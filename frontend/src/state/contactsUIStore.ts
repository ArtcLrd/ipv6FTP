import { create } from 'zustand';

export type FilterKey = 'all' | 'online' | 'offline' | 'ipv6' | 'ipv4';

interface ContactsUIState {
  activeFilter: FilterKey;
  setFilter: (f: FilterKey) => void;
  clearFilter: () => void;
}

export const useContactsUIStore = create<ContactsUIState>((set) => ({
  activeFilter: 'all',
  setFilter: (f) => set({ activeFilter: f }),
  clearFilter: () => set({ activeFilter: 'all' }),
}));
