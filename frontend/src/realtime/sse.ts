import RNEventSource from 'react-native-sse';
import { getTokens } from '../core/storage/secure';
import { API_BASE_URL } from '../config/env';
import { logger } from '../core/logger/logger';

export async function connectSSE(onEvent: (data: any) => void) {
  const tokens = await getTokens();
  if (!tokens?.accessToken) {
    logger.error('Cannot connect SSE: No access token');
    return null;
  }

  const es = new RNEventSource(`${API_BASE_URL}/api/events`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  es.addEventListener('message', (event) => {
    try {
      if (event.data) {
        onEvent(JSON.parse(event.data));
      }
    } catch (error) {
      logger.error('Failed to parse SSE event', error);
    }
  });

  es.addEventListener('error', (error) => {
    logger.error('SSE Error', error);
  });

  return es;
}
