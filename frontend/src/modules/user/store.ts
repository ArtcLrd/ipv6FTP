import { create } from 'zustand';
import { UserProfile } from './types';

interface UserState {
  currentIP: string | null;
  searchResults: UserProfile[];
  setCurrentIP: (ip: string) => void;
  setSearchResults: (results: UserProfile[]) => void;
}

export const useUserStore = create<UserState>((set) => ({
  currentIP: null,
  searchResults: [],
  setCurrentIP: (ip) => set({ currentIP: ip }),
  setSearchResults: (results) => set({ searchResults: results }),
}));
