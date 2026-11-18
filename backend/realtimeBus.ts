import { EventEmitter } from 'node:events';
import { generateId, requireAuth } from './auth';
import type { DbClient, DbExecutor } from './db';

export interface RealtimeEventInput {
  eventType: string;
  entityType: string;
  recordId?: string;
  operation?: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  payload?: Record<string, any>;
  actorId?: string;
  actorName?: string;
}

export interface RealtimeEventRecord {
  seq: number;
  id: string;
  eventType: string;
  entityType: string;
  recordId: string;
  operation: string;
  payload: Record<string, any>;
  actorId: string;
  actorName: string;
  createdAt: string;
}

class RealtimeBusEmitter extends EventEmitter {}

export const realtimeEmitter = new RealtimeBusEmitter();
realtimeEmitter.setMaxListeners(250);

let localFallbackSeq = 0;

function parseJsonObject(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function mapRealtimeEventRow(row: any): RealtimeEventRecord {
  const seqNum = Number(row.seq || 0);
  return {
    seq: isNaN(seqNum) ? 0 : seqNum,
    id: String(row.id || ''),
    eventType: String(row.event_type ?? row.eventType ?? ''),
    entityType: String(row.entity_type ?? row.entityType ?? ''),
    recordId: String(row.record_id ?? row.recordId ?? ''),
    operation: String(row.operation || 'UPDATE').toUpperCase(),
    payload: parseJsonObject(row.payload),
    actorId: String(row.actor_id ?? row.actorId ?? ''),
    actorName: String(row.actor_name ?? row.actorName ?? ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? row.createdAt ?? new Date().toISOString())
  };
}

export async function emitRealtimeEvent(
  client: DbClient,
  input: RealtimeEventInput
): Promise<RealtimeEventRecord> {
  const id = generateId('EVT');
  const nowIso = new Date().toISOString();
  const operation = String(input.operation || 'UPDATE').toUpperCase();
  const recordId = String(input.recordId || '');
  const payload = input.payload || {};
  const actorId = String(input.actorId || 'SYSTEM');
  const actorName = String(input.actorName || 'النظام');

  let record: RealtimeEventRecord = {
    seq: ++localFallbackSeq,
    id,
    eventType: String(input.eventType || `${input.entityType}:${operation}`),
    entityType: String(input.entityType || 'System'),
    recordId,
    operation,
    payload,
    actorId,
    actorName,
    createdAt: nowIso
  };

  try {
    const res = await client.query(
      `INSERT INTO realtime_events (
         id, event_type, entity_type, record_id, operation, payload, actor_id, actor_name, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz)
       RETURNING *`,
      [
        record.id,
        record.eventType,
        record.entityType,
        record.recordId,
        record.operation,
        JSON.stringify(record.payload),
        record.actorId,
        record.actorName,
        nowIso
      ]
    );
    if (res.rows[0] && res.rows[0].seq !== undefined) {
      record = mapRealtimeEventRow(res.rows[0]);
      if (record.seq > localFallbackSeq) localFallbackSeq = record.seq;
    }
  } catch {
    // Non-blocking fallback when running against mock test executor without realtime_events table handler
  }

  realtimeEmitter.emit('event', record);
  return record;
}

export async function getLatestRealtimeSeq(executor: DbExecutor): Promise<number> {
  try {
    const res = await executor.query<{ max_seq: string | number }>(
      `SELECT COALESCE(MAX(seq), 0)::bigint AS max_seq FROM realtime_events`
    );
    const n = Number(res.rows[0]?.max_seq || 0);
    return isNaN(n) ? localFallbackSeq : Math.max(n, 0);
  } catch {
    return localFallbackSeq;
  }
}

export async function fetchRealtimeEventsSince(
  executor: DbExecutor,
  sinceSeq: number,
  limit = 100
): Promise<{ events: RealtimeEventRecord[]; latestSeq: number }> {
  const safeSince = Math.max(0, Number(sinceSeq) || 0);
  const safeLimit = Math.min(300, Math.max(1, Number(limit) || 100));
  try {
    const res = await executor.query(
      `SELECT * FROM realtime_events WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
      [safeSince, safeLimit]
    );
    const events = res.rows.map(mapRealtimeEventRow);
    const latestFromDb = await getLatestRealtimeSeq(executor);
    const latestSeq = events.length > 0
      ? Math.max(latestFromDb, events[events.length - 1].seq)
      : Math.max(latestFromDb, safeSince);
    return { events, latestSeq };
  } catch {
    return { events: [], latestSeq: Math.max(localFallbackSeq, safeSince) };
  }
}

function writeSseFrame(res: any, eventName: string, data: any, id?: string | number): void {
  if (!res || res.writableEnded || res.destroyed) return;
  let chunk = '';
  if (id !== undefined && id !== null && id !== '') {
    chunk += `id: ${id}\n`;
  }
  if (eventName) {
    chunk += `event: ${eventName}\n`;
  }
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  try {
    res.write(chunk);
    if (typeof res.flush === 'function') res.flush();
  } catch {
    // Client socket closed
  }
}

export async function handleSseStream(
  req: any,
  res: any,
  executor: DbExecutor
): Promise<void> {
  const authHeader = String(req.headers?.authorization || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = String(bearer || req.query?.token || '').trim();

  let session;
  try {
    session = await requireAuth(executor, token);
  } catch (err: any) {
    res.status(401).json({
      success: false,
      message: String(err?.message || 'UNAUTHORIZED'),
      data: null,
      error: 'UNAUTHORIZED'
    });
    return;
  }

  const rawSince = req.headers?.['last-event-id'] ?? req.query?.since ?? 0;
  let cursorSeq = Math.max(0, Number(rawSince) || 0);

  if (String(req.query?.mode || '').toLowerCase() === 'poll') {
    const delta = await fetchRealtimeEventsSince(executor, cursorSeq, 100);
    res.status(200).json({
      success: true,
      message: 'تم جلب التحديثات الفورية بنجاح.',
      data: {
        events: delta.events,
        latestSeq: delta.latestSeq,
        serverTime: new Date().toISOString()
      },
      error: null
    });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const initialSeq = await getLatestRealtimeSeq(executor);
  if (cursorSeq === 0) {
    cursorSeq = initialSeq;
  }

  writeSseFrame(res, 'connected', {
    userId: session.user.id,
    userName: session.user.name,
    role: session.user.role,
    latestSeq: Math.max(initialSeq, cursorSeq),
    serverTime: new Date().toISOString()
  }, Math.max(initialSeq, cursorSeq));

  // Replay missed events when client reconnects with an older cursor
  if (cursorSeq < initialSeq) {
    const missed = await fetchRealtimeEventsSince(executor, cursorSeq, 100);
    for (const ev of missed.events) {
      writeSseFrame(res, 'crm_delta', ev, ev.seq);
      if (ev.seq > cursorSeq) cursorSeq = ev.seq;
    }
  }

  let closed = false;
  const onRealtimeEvent = (ev: RealtimeEventRecord) => {
    if (closed) return;
    if (ev.seq > 0 && ev.seq <= cursorSeq) return;
    if (ev.seq > cursorSeq) cursorSeq = ev.seq;
    writeSseFrame(res, 'crm_delta', ev, ev.seq || ev.id);
  };

  realtimeEmitter.on('event', onRealtimeEvent);

  // Cross-instance DB cursor check (important for multi-worker / serverless)
  let pollingDb = false;
  const dbPollTimer = setInterval(() => {
    if (closed || pollingDb) return;
    pollingDb = true;
    fetchRealtimeEventsSince(executor, cursorSeq, 50)
      .then((delta) => {
        if (closed) return;
        for (const ev of delta.events) {
          if (ev.seq <= cursorSeq) continue;
          cursorSeq = ev.seq;
          writeSseFrame(res, 'crm_delta', ev, ev.seq);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        pollingDb = false;
      });
  }, 1800);

  const heartbeatTimer = setInterval(() => {
    if (closed || res.writableEnded || res.destroyed) return;
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch {
      // ignore
    }
  }, 20000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(dbPollTimer);
    clearInterval(heartbeatTimer);
    realtimeEmitter.off('event', onRealtimeEvent);
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}
