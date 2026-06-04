import { User } from './store';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export type { User };
