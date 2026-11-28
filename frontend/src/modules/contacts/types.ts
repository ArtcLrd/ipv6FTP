export interface Contact {
  id: string;
  username: string;
  status: string;
  ip_addr: string;
  direction: 'added_by_me' | 'added_me';
}
