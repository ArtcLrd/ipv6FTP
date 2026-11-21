import client from '../../core/api/client';
import { useAuthStore } from '../../modules/auth/store';
import { advanceIdentityGeneration, currentIdentityGeneration } from '../../modules/auth/generation';
import { acceptAccountEventCursor, observeAccountEvents } from '../accountEvents';

jest.mock('../../core/api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../../config/env', () => ({ WS_URL: 'wss://example.test' }));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = jest.fn();
  constructor(public url: string, public protocols: string[]) { FakeSocket.instances.push(this); }
  sendEvent(cursor: string, previous_cursor: string) { this.onmessage?.({ data: JSON.stringify({ kind: 'event', event: { cursor, previous_cursor, type: 'username_changed', version: 1, payload: {} } }) }); }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  advanceIdentityGeneration();
  useAuthStore.getState().clearAuth();
  FakeSocket.instances = [];
  (global as any).WebSocket = FakeSocket;
  (client.post as jest.Mock).mockResolvedValue({ data: { ticket: 'a'.repeat(43), expires_in_seconds: 30 } });
});
afterEach(() => { useAuthStore.getState().clearAuth(); jest.useRealTimers(); jest.clearAllMocks(); });

it('deduplicates events and ignores late messages after logout', async () => {
  acceptAccountEventCursor('AAAAAAAAAAQ', currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: 'p', username: 'name' });
  const reconcile = jest.fn(async () => { acceptAccountEventCursor('AAAAAAAAAAU', currentIdentityGeneration()); });
  const stop = observeAccountEvents(reconcile);
  await flush();
  const socket = FakeSocket.instances[0];
  expect(socket.protocols).toEqual(['account-events-v1', `ticket.${'a'.repeat(43)}`]);
  expect(socket.url).not.toContain('ticket=');
  socket.sendEvent('AAAAAAAAAAQ', 'AAAAAAAAAAM'); socket.sendEvent('AAAAAAAAAAU', 'AAAAAAAAAAQ'); await flush();
  expect(reconcile).toHaveBeenCalledTimes(1);
  socket.sendEvent('AAAAAAAAAAU', 'AAAAAAAAAAQ'); await flush();
  expect(reconcile).toHaveBeenCalledTimes(1);
  const late = socket.onmessage;
  advanceIdentityGeneration(); useAuthStore.getState().clearAuth();
  late?.({ data: JSON.stringify({ kind: 'event', event: { cursor: 'AAAAAAAAAAY', previous_cursor: 'AAAAAAAAAAU', type: 'username_changed', version: 1, payload: {} } }) });
  await flush();
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalled();
  stop();
});

it('closes and resynchronizes on a gap', async () => {
  acceptAccountEventCursor('AAAAAAAAAAI', currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: 'p', username: 'name' });
  const reconcile = jest.fn(async () => { acceptAccountEventCursor('AAAAAAAAAAQ', currentIdentityGeneration()); });
  const stop = observeAccountEvents(reconcile);
  await flush();
  const socket = FakeSocket.instances[0];
  socket.sendEvent('AAAAAAAAAAQ', 'AAAAAAAAAAM'); await flush();
  expect(socket.close).toHaveBeenCalled();
  expect(reconcile).toHaveBeenCalledTimes(1);
  stop();
});

it('rechecks when an in-flight snapshot predates the event', async () => {
  acceptAccountEventCursor('AAAAAAAAAAI', currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: 'p', username: 'name' });
  const reconcile = jest.fn(async () => {
    if (reconcile.mock.calls.length === 2) acceptAccountEventCursor('AAAAAAAAAAM', currentIdentityGeneration());
  });
  const stop = observeAccountEvents(reconcile);
  await flush();
  FakeSocket.instances[0].sendEvent('AAAAAAAAAAM', 'AAAAAAAAAAI');
  await flush();
  expect(reconcile).toHaveBeenCalledTimes(2);
  stop();
});

it('limits repeated immediate disconnects', async () => {
  acceptAccountEventCursor('AAAAAAAAAAI', currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: 'p', username: 'name' });
  const stop = observeAccountEvents(jest.fn().mockResolvedValue(undefined));
  await flush();
  for (let i = 0; i < 10; i++) {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    socket.onopen?.(); socket.onclose?.();
    jest.advanceTimersByTime(31000);
    await flush();
  }
  expect(FakeSocket.instances.length).toBe(9);
  stop();
});

it('resynchronizes on an expired-cursor frame and ignores later frames from that connection', async () => {
  acceptAccountEventCursor('AAAAAAAAAAI', currentIdentityGeneration());
  useAuthStore.getState().setUser({ id: 'p', username: 'name' });
  const reconcile = jest.fn(async () => { acceptAccountEventCursor('AAAAAAAAAAQ', currentIdentityGeneration()); });
  const stop = observeAccountEvents(reconcile);
  await flush();
  const socket = FakeSocket.instances[0];
  const onmessage = socket.onmessage;
  onmessage?.({ data: JSON.stringify({ kind: 'resync_required' }) });
  onmessage?.({ data: JSON.stringify({ kind: 'event', event: { cursor: 'AAAAAAAAAAM', previous_cursor: 'AAAAAAAAAAI', type: 'username_changed', version: 1, payload: {} } }) });
  await flush();
  expect(socket.close).toHaveBeenCalled();
  expect(reconcile).toHaveBeenCalledTimes(1);
  stop();
});
