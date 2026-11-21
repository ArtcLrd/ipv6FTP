import { z } from 'zod';
import client from '../core/api/client';
import { WS_URL } from '../config/env';
import { currentIdentityGeneration } from '../modules/auth/generation';
import { useAuthStore } from '../modules/auth/store';

const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const ticketSchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expires_in_seconds: z.number().int().positive().max(30) }).strict();
const messageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resync_required') }).strict(),
  z.object({ kind: z.literal('event'), event: z.object({ cursor: cursorSchema, previous_cursor: cursorSchema, type: z.string().min(1).max(64), version: z.number().int().positive(), payload: z.record(z.string(), z.unknown()) }).strict() }).strict(),
]);
let snapshot: { generation: number; cursor: string } | undefined;

// Called only after bootstrap has verified the server snapshot and device binding.
export function acceptAccountEventCursor(cursor: string | undefined, generation: number): void {
  if (cursor && cursorSchema.safeParse(cursor).success && generation === currentIdentityGeneration()) snapshot = { cursor, generation };
}

export function observeAccountEvents(reconcile: () => Promise<void>): () => void {
  let stopped = false;
  let connection: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = -1;
  let connecting = false;
  let failures = 0;
  let serial = Promise.resolve();
  let pending = 0;
  const seen: string[] = [];
  const active = () => !stopped && useAuthStore.getState().sessionStatus === 'authenticated' && generation === currentIdentityGeneration();
  const disconnect = () => { if (timer) clearTimeout(timer); if (stableTimer) clearTimeout(stableTimer); timer = undefined; stableTimer = undefined; const old = connection; connection = undefined; if (old) { old.onclose = null; old.onmessage = null; old.close(); } };
  const schedule = () => {
    if (!active() || timer || failures >= 8) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) + Math.floor(Math.random() * 500);
    timer = setTimeout(() => { timer = undefined; void connect(); }, delay);
  };
  const connect = async () => {
    if (!active() || connection || connecting || !snapshot || snapshot.generation !== generation) return;
    connecting = true;
    const selected = generation;
    try {
      if (failures > 0) await reconcile();
      if (!active() || selected !== generation) return;
      const { data } = await client.post('/api/v2/events/ticket', {});
      const { ticket } = ticketSchema.parse(data);
      if (!active() || selected !== generation || !snapshot || snapshot.generation !== generation) return;
      const socket = new WebSocket(`${WS_URL}/api/v2/events/stream?cursor=${encodeURIComponent(snapshot.cursor)}`, ['account-events-v1', `ticket.${ticket}`]);
      connection = socket;
      socket.onopen = () => { if (active() && connection === socket) stableTimer = setTimeout(() => { if (connection === socket) failures = 0; }, 30000); else socket.close(); };
      socket.onmessage = (raw) => {
        if (pending >= 100) { disconnect(); void reconcile().catch(() => undefined).finally(schedule); return; }
        pending++;
        serial = serial.then(async () => {
          if (!active() || connection !== socket || !snapshot || snapshot.generation !== generation) return;
          let message: z.infer<typeof messageSchema>;
          try { message = messageSchema.parse(JSON.parse(String(raw.data))); } catch { disconnect(); schedule(); return; }
          if (message.kind === 'event' && (message.event.cursor === snapshot.cursor || seen.includes(message.event.cursor))) return;
          const gap = message.kind === 'resync_required' || (message.kind === 'event' && message.event.previous_cursor !== snapshot.cursor);
          if (gap) disconnect();
          const previousCursor = snapshot.cursor;
          await reconcile();
          if (!active() || selected !== generation) return;
          // A shared bootstrap may have started before this event committed. Retry after
          // that in-flight check settles; otherwise this could lose the only notification.
          if (message.kind === 'event' && snapshot?.cursor === previousCursor) {
            await reconcile();
            if (!active() || selected !== generation) return;
            if (snapshot?.cursor === previousCursor) { disconnect(); schedule(); return; }
          }
          if (message.kind === 'event') { seen.push(message.event.cursor); if (seen.length > 100) seen.shift(); }
          // Reconciliation publishes a fresh, verified snapshot cursor; never trust the event itself as authorization.
          if (gap) schedule();
        }).catch(() => { disconnect(); schedule(); }).finally(() => { pending--; });
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => { if (connection === socket) { connection = undefined; if (stableTimer) clearTimeout(stableTimer); stableTimer = undefined; schedule(); } };
    } catch { schedule(); } finally { connecting = false; if (selected !== generation) void connect(); }
  };
  const update = () => {
    const current = currentIdentityGeneration();
    if (current !== generation) { disconnect(); generation = current; failures = 0; seen.length = 0; }
    if (!active()) { disconnect(); return; }
    void connect();
  };
  const unsubscribe = useAuthStore.subscribe(update);
  update();
  return () => { stopped = true; unsubscribe(); disconnect(); };
}
