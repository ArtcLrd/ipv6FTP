import axios, { AxiosInstance } from 'axios';
import { getTokens, storeTokens, clearTokens } from '../storage/secure';
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

      // If error is not 401, request was already retried, or it's a login/register request, reject
      if (
        error.response?.status !== 401 ||
        originalRequest._retry ||
        originalRequest.url?.includes('/api/v1/auth/login') ||
        originalRequest.url?.includes('/api/v1/auth/register')
      ) {
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
        const { data } = await axios.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
          refresh_token: tokens.refreshToken,
        });

        await storeTokens(data.access_token, data.refresh_token);
        
        processQueue(null, data.access_token);
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        
        // Clear local tokens and auth state
        await clearTokens();
        useAuthStore.getState().clearAuth();

        // Clean up WebRTC and signaling connections to prevent leaks
        try {
          const { webrtcManager } = require('../../modules/call/webrtc');
          webrtcManager.cleanup();
        } catch (err) {
          // Suppress errors during early startup initialization
        }

        try {
          const { terminateSignaling } = require('../../services/signalingService');
          terminateSignaling();
        } catch (err) {
          // Suppress errors during early startup initialization
        }

        // Telemetry warning
        try {
          const Sentry = require('@sentry/react-native');
          Sentry.captureMessage('Session terminated due to refresh token failure', 'warning');
        } catch (err) {
          // Sentry might not be initialized
        }

        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );
};
