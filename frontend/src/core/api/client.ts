import axios from 'axios';
import axiosRetry from 'axios-retry';
import { getTokens } from '../storage/secure';
import { API_BASE_URL, APP_CONFIG } from '../../config/env';
import { setupInterceptors } from './interceptors';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: APP_CONFIG.TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

// Register interceptors
setupInterceptors(client);

// Inject Bearer token on every request
client.interceptors.request.use(async (config) => {
  const tokens = await getTokens();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// Retry on 5xx and network errors (NOT on 401/403)
axiosRetry(client, {
  retries: APP_CONFIG.RETRY_COUNT,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    (err.response?.status ?? 0) >= 500,
});

export default client;
