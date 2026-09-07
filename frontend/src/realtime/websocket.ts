import { WS_URL } from '../config/env';
import { getTokens } from '../core/storage/secure';
import { logger } from '../core/logger/logger';

type MessageHandler = (data: any) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private outbox: string[] = [];
  private reconnectDelay = 200;
  private maxDelay = 10000;
  private url: string = '';
  private roomID: string | null = null;
  private listeners = new Map<string, Set<MessageHandler>>();
  private pingInterval: any = null;

  connect(roomID: string) {
    if (this.roomID === roomID && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.disconnect();
    this.roomID = roomID;
    this.url = `${WS_URL}/ws?room=${encodeURIComponent(roomID)}`;
    this._connect();
  }

  async connectCall(callSessionID: string) {
    const tokens = await getTokens();
    if (!tokens?.accessToken) {
      throw new Error('Missing access token');
    }
    this.disconnect();
    this.roomID = callSessionID;
    this.url = `${WS_URL}/api/v1/calls/${encodeURIComponent(callSessionID)}/signal?access_token=${encodeURIComponent(tokens.accessToken)}`;
    this._connect();
  }

  private _connect() {
    if (!this.url) return;
    logger.info('Connecting to WebSocket...', this.url);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      logger.info('WebSocket Connected');
      this.reconnectDelay = 200;
      this._startPing();
      this._drainOutbox();
      this._emit('open', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type) {
          this._emit(data.type, data);
        }
        this._emit('message', data);
      } catch (error) {
        logger.error('Failed to parse WS message', error);
      }
    };

    this.ws.onclose = (event) => {
      logger.warn('WebSocket Closed', event.code, event.reason);
      this._stopPing();
      this._reconnect();
      this._emit('close', event);
    };

    this.ws.onerror = (error) => {
      logger.error('WebSocket Error', error);
      this._emit('error', error);
    };
  }

  private _reconnect() {
    if (!this.url) return;
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this._connect();
    }, this.reconnectDelay);
  }

  private _startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private _drainOutbox() {
    while (this.outbox.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.outbox.shift();
      if (msg) this.ws.send(msg);
    }
  }

  send(type: string, payload: any) {
    const msg = JSON.stringify({ type, payload });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      logger.info('WS not open, queuing message', type);
      this.outbox.push(msg);
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(handler);
    return () => this.off(type, handler);
  }

  waitFor(type: string, timeoutMs = 10000) {
    if (type === 'open' && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve({});
    }

    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      const unsubscribe = this.on(type, (data) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(data);
      });
    });
  }

  off(type: string, handler: MessageHandler) {
    this.listeners.get(type)?.delete(handler);
  }

  private _emit(type: string, data: any) {
    this.listeners.get(type)?.forEach((handler) => handler(data));
  }

  forceReconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  disconnect() {
    this.url = '';
    this.roomID = null;
    this.outbox = [];
    this._stopPing();
    if (this.ws) {
      this.ws.onclose = null; // Prevent auto-reconnect
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsManager = new WebSocketManager();
