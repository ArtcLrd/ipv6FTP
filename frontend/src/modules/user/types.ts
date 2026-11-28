export interface UserProfile {
  id: string;
  username: string;
  status?: string;
  ip_addr?: string;
  last_seen?: string;
}

export interface SearchResult {
  users: UserProfile[];
}
