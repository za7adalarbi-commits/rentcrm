import crypto from 'node:crypto';
import type { DbExecutor } from './db.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'token',
  'rgToken',
  'syncSecret',
  'secret',
  'authorization',
  'passwordHash',
  'salt',
  'DATABASE_URL',
  'POSTGRES_URL',
  'RG_TOKEN',
  'SYNC_API_SECRET'
]);

export function redactSensitiveText(raw: unknown): string {
  const s = String(raw ?? '');
  if (!s) return '';
  return s
    .replace(/postgres(?:ql)?:\/\/[^\s"'`)<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, '[REDACTED_JWT]')
    .replace(/\b(DATABASE_URL|POSTGRES_URL|NEON_DATABASE_URL|SYNC_API_SECRET|RG_TOKEN|rgToken|syncSecret|password|token)\s*[:=]\s*["']?[^\s"',;}{]+["']?/gi, '$1=[REDACTED]');
}

export function sanitizeLogMeta(input: any, depth = 0): any {
  if (depth > 4) return '[TRUNCATED]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (/^(eyJ[A-Za-z0-9_-]+\.|Bearer\s+|postgres(ql)?:\/\/)/i.test(input)) {
      return '[REDACTED]';
    }
    const clean = redactSensitiveText(input);
    return clean.length > 500 ? `${clean.slice(0, 500)}...` : clean;
  }
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 25).map((item) => sanitizeLogMeta(item, depth + 1));
  }
  const out: Record<string, any> = {};
  for (const k of Object.keys(input)) {
    if (SENSITIVE_KEYS.has(k) || /password|secret|token|authorization/i.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizeLogMeta(input[k], depth + 1);
    }
  }
  return out;
}

export async function logBackendError(
  executor: DbExecutor | null,
  context: string,
  action: string,
  err: unknown,
  meta?: Record<string, any>
): Promise<void> {
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown error');
  const rawStack = err instanceof Error && err.stack ? err.stack : '';
  const message = redactSensitiveText(rawMessage);
  const stack = redactSensitiveText(rawStack).slice(0, 2000);
  const safeMeta = sanitizeLogMeta(meta || {});

  try {
    console.error(JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      context,
      action,
      message,
      meta: safeMeta
    }));
  } catch {
    // ignore console errors
  }

  if (!executor) return;
  try {
    const id = 'ERR_' + crypto.randomBytes(6).toString('hex').toUpperCase();
    await executor.query(
      `INSERT INTO error_logs (id, context, action, message, stack, meta, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [id, context, action, message.slice(0, 1000), stack, JSON.stringify(safeMeta || {})]
    );
  } catch {
    // Do not cascade error logging failures
  }
}
