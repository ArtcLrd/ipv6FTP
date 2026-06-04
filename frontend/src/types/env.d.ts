declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_BACKEND_URL?: string;
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_ICE_MODE?: 'ipv6-direct' | 'stun' | 'turn';
  }
}
