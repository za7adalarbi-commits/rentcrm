import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import pg from 'pg';
import type { DbExecutor } from './db.js';

export interface CrmRealtimeEvent {
  type: 'delta' | 'announcement' | 'lock' | 'settings';
  action: string;
  at: string;
  actorId?: string;
  originTabId?: string;
  scopes?: string[];
  entityIds?: string[];
  version?: number;
  instanceId?: string;
}

const PG_CHANNEL = 'crm_sync_events';
const PROCESS_INSTANCE_ID = `INST_${crypto.randomBytes(4).toString('hex')}`;

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

let pgListenClient: pg.Client | null = null;
let pgListenActive = false;
let pgListenRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lastListenConnStr = '';

function shouldUseSsl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  if (lower.includes('sslmode=disable') || process.env.PGSSLMODE === 'disable') {
    return false;
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return lower.includes('sslmode=require');
  }
  return true;
}

export function broadcastCrmEvent(event: CrmRealtimeEvent): void {
  try {
    emitter.emit('crm_event', {
      ...event,
      instanceId: event.instanceId || PROCESS_INSTANCE_ID
    });
  } catch {
    // Non-fatal
  }
}

export function subscribeCrmEvents(listener: (event: CrmRealtimeEvent) => void): () => void {
  emitter.on('crm_event', listener);
  return () => {
    emitter.off('crm_event', listener);
  };
}

export async function publishPgNotify(executor: DbExecutor | null | undefined, event: CrmRealtimeEvent): Promise<void> {
  if (!executor || typeof executor.query !== 'function') return;
  try {
    const payloadStr = JSON.stringify({
      type: event.type,
      action: event.action,
      at: event.at,
      actorId: event.actorId || '',
      originTabId: event.originTabId || '',
      scopes: Array.isArray(event.scopes) ? event.scopes : [],
      entityIds: Array.isArray(event.entityIds) ? event.entityIds : [],
      version: event.version || 0,
      instanceId: PROCESS_INSTANCE_ID
    });
    if (payloadStr.length > 7500) {
      const compact = JSON.stringify({
        type: event.type,
        action: event.action,
        at: event.at,
        actorId: event.actorId || '',
        originTabId: event.originTabId || '',
        scopes: Array.isArray(event.scopes) ? event.scopes : [],
        version: event.version || 0,
        instanceId: PROCESS_INSTANCE_ID
      });
      await executor.query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, compact]);
      return;
    }
    await executor.query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, payloadStr]);
  } catch {
    // Graceful no-op for mock executors or transient notification failures
  }
}

export function ensurePgRealtimeListener(connectionString: string): void {
  const clean = String(connectionString || '').trim();
  if (!clean || !/^postgres(ql)?:\/\//i.test(clean)) return;
  if (pgListenActive && lastListenConnStr === clean) return;

  lastListenConnStr = clean;
  if (pgListenRetryTimer) {
    clearTimeout(pgListenRetryTimer);
    pgListenRetryTimer = null;
  }
  if (pgListenClient) {
    try {
      void pgListenClient.end().catch(() => undefined);
    } catch {
      // ignore
    }
    pgListenClient = null;
  }

  pgListenActive = true;
  const client = new pg.Client({
    connectionString: clean,
    ssl: shouldUseSsl(clean) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000
  });
  pgListenClient = client;

  const scheduleRetry = () => {
    pgListenActive = false;
    if (pgListenClient === client) {
      pgListenClient = null;
    }
    try {
      void client.end().catch(() => undefined);
    } catch {
      // ignore
    }
    if (!pgListenRetryTimer && lastListenConnStr) {
      pgListenRetryTimer = setTimeout(() => {
        pgListenRetryTimer = null;
        ensurePgRealtimeListener(lastListenConnStr);
      }, 5000);
      if (typeof pgListenRetryTimer.unref === 'function') {
        pgListenRetryTimer.unref();
      }
    }
  };

  client.on('notification', (msg) => {
    if (msg.channel !== PG_CHANNEL || !msg.payload) return;
    try {
      const parsed = JSON.parse(msg.payload) as CrmRealtimeEvent;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.instanceId === PROCESS_INSTANCE_ID) return;
      emitter.emit('crm_event', parsed);
    } catch {
      // Ignore malformed payload
    }
  });

  client.on('error', () => {
    scheduleRetry();
  });
  client.on('end', () => {
    scheduleRetry();
  });

  client
    .connect()
    .then(() => client.query(`LISTEN ${PG_CHANNEL}`))
    .catch(() => {
      scheduleRetry();
    });
}
