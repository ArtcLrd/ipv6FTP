import axios, { AxiosInstance } from 'axios';
import { getTokens, storeTokens } from '../storage/secure';
import { useAuthStore } from '../../modules/auth/store';
import { API_BASE_URL } from '../../config/env';

// 401 interceptor: refresh token → retry original request
let isRefreshing = false;
let failedQueue: Array<{ resolve: Function; reject: Function }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

export const setupInterceptors = (client: AxiosInstance) => {
  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const originalRequest = error.config;

      // If error is not 401 or request was already retried, reject
      if (error.response?.status !== 401 || originalRequest._retry) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => {
            return client(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const tokens = await getTokens();
        if (!tokens?.refreshToken) {
          throw new Error('No refresh token available');
        }

        // Use basic axios to avoid interceptors on the refresh call
        const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
          refresh_token: tokens.refreshToken,
        });

        await storeTokens(data.access_token, data.refresh_token);
        
        processQueue(null, data.access_token);
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().clearAuth();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );
};
