import { wsManager } from '../websocket';

jest.mock('../../config/env', () => ({ WS_URL: 'wss://example.test' }));
jest.mock('../../core/logger/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  constructor(_url: string) { FakeSocket.instances.push(this); }
}
const originalWebSocket = global.WebSocket;
beforeEach(() => { jest.useFakeTimers(); FakeSocket.instances = []; (global as any).WebSocket = FakeSocket; });
afterEach(() => { wsManager.disconnect(); (global as any).WebSocket = originalWebSocket; jest.useRealTimers(); });

it('ignores callbacks from a disconnected socket and does not restart its ping timer', async () => {
  await wsManager.connectCall('old-call', 'old-ticket');
  const oldSocket = FakeSocket.instances[0];
  const oldOpen = oldSocket.onopen!;
  const oldMessage = oldSocket.onmessage!;
  const onMessage = jest.fn();
  const unsubscribe = wsManager.on('message', onMessage);
  wsManager.disconnect();
  await wsManager.connectCall('new-call', 'new-ticket');
  oldOpen({});
  oldMessage({ data: JSON.stringify({ type: 'old' }) });
  await jest.advanceTimersByTimeAsync(31000);
  expect(onMessage).not.toHaveBeenCalled();
  expect(oldSocket.send).not.toHaveBeenCalled();
  expect(FakeSocket.instances[1].send).not.toHaveBeenCalled();
  unsubscribe();
});

it('rejects pending socket waits and clears their timers when disconnected', async () => {
  await wsManager.connectCall('call', 'ticket');
  const waiting = wsManager.waitFor('peer-joined', 20000);
  const rejected = expect(waiting).rejects.toThrow('Socket disconnected');
  wsManager.disconnect();
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
