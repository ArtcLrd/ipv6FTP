import { WS_URL } from '../config/env';
import { logger } from '../core/logger/logger';

type MessageHandler = (data: any) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private outbox: string[] = [];
  private url: string = '';
  private roomID: string | null = null;
  private listeners = new Map<string, Set<MessageHandler>>();
  private pingInterval: any = null;
  private pendingWaits = new Set<() => void>();

  async connectCall(callSessionID: string, ticket: string) {
    this.disconnect();
    this.roomID = callSessionID;
    this.url = `${WS_URL}/api/v1/calls/${encodeURIComponent(callSessionID)}/signal?ticket=${encodeURIComponent(ticket)}`;
    this._connect();
  }

  private _connect() {
    if (!this.url) return;
    logger.info('Connecting authenticated call setup socket');
    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      logger.info('WebSocket Connected');
      this._startPing();
      this._drainOutbox();
      this._emit('open', {});
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
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

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      logger.warn('WebSocket Closed', event.code, event.reason);
      this._stopPing();
      this._emit('close', event);
    };

    socket.onerror = (error) => {
      if (this.ws !== socket) return;
      logger.error('WebSocket Error', error);
      this._emit('error', error);
    };
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
      const cancel = () => {
        clearTimeout(timeout);
        unsubscribe();
        this.pendingWaits.delete(cancel);
        reject(new Error('Socket disconnected'));
      };
      const timeout = setTimeout(() => {
        unsubscribe();
        this.pendingWaits.delete(cancel);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      const unsubscribe = this.on(type, (data) => {
        clearTimeout(timeout);
        unsubscribe();
        this.pendingWaits.delete(cancel);
        resolve(data);
      });
      this.pendingWaits.add(cancel);
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
    this._emit('reconnect-required', {});
  }

  disconnect() {
    this.url = '';
    this.roomID = null;
    this.outbox = [];
    this._stopPing();
    for (const cancel of this.pendingWaits) cancel();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsManager = new WebSocketManager();
