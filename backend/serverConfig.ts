import crypto from 'node:crypto';
import type { DbClient, DbExecutor } from './db.js';
import { getDatabaseUrl } from './db.js';
import { FIXED_SERVER_CONFIG, type FixedConnectionMode } from './fixedConfig.js';
import {
  buildRentalGateEndpointUrl,
  DEFAULT_RG_API_BASE_URL,
  normalizeMode,
  normalizeRgApiBaseUrl
} from './coreBinding.js';

export { buildRentalGateEndpointUrl, DEFAULT_RG_API_BASE_URL, normalizeRgApiBaseUrl };

export interface ResolvedServerConfig {
  mode: FixedConnectionMode;
  gasWebAppUrl: string;
  rgToken: string;
  rgApiBaseUrl: string;
  syncApiSecret: string;
  hasEnvGasUrl: boolean;
  hasEnvRgToken: boolean;
  hasEnvSyncSecret: boolean;
  hasFixedConfig: boolean;
}

const ENC_PREFIX = 'enc:v1:';

function deriveEncryptionKey(): Buffer {
  const seed = String(
    process.env.RG_ENCRYPTION_KEY ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    FIXED_SERVER_CONFIG.databaseUrl ||
    'RENTAL_GATE_CRM_LOCAL_KEY'
  ).trim();
  return crypto.createHash('sha256').update(`RG_AES_KEY::${seed}`, 'utf8').digest();
}

export function hasWrappingQuotes(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.replace(/[\r\n]+/g, '').trim();
  if (trimmed.length < 2) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}

export function hasInternalOrOuterWhitespace(raw: unknown, allowBearerSpace = false): boolean {
  if (typeof raw !== 'string') return false;
  if (raw !== raw.trim()) return true;
  if (/[\r\n\t]/.test(raw)) return true;
  const checkTarget = allowBearerSpace ? raw.trim().replace(/^(?:Bearer\s+)+/i, '').trim() : raw.trim();
  return /\s/.test(checkTarget);
}

export function sanitizeSecretToken(raw: unknown): string {
  let clean = String(raw ?? '').replace(/[\r\n]+/g, '').trim();
  while (clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      clean = clean.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return clean;
}

export function normalizeBearerToken(raw: unknown): string {
  let clean = sanitizeSecretToken(raw);
  clean = clean.replace(/^(?:Bearer\s+)+/i, '').trim();
  return sanitizeSecretToken(clean);
}

export function encryptServerSecret(plainText: string): string {
  const clean = sanitizeSecretToken(plainText);
  if (!clean) return '';
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptServerSecret(storedValue: string): string {
  const raw = sanitizeSecretToken(storedValue);
  if (!raw) return '';
  if (!raw.startsWith(ENC_PREFIX)) {
    return raw;
  }
  try {
    const rest = raw.slice(ENC_PREFIX.length);
    const parts = rest.split(':');
    if (parts.length !== 3) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return sanitizeSecretToken(decrypted.toString('utf8'));
  } catch {
    return '';
  }
}

async function readSettingsRows(client: DbClient, keys: string[]): Promise<Record<string, string>> {
  const res = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
    [keys]
  );
  const map: Record<string, string> = {};
  for (const row of res.rows) {
    map[String(row.key)] = String(row.value ?? '');
  }
  return map;
}

export async function upsertServerSetting(
  client: DbClient,
  key: string,
  value: string,
  updatedBy = 'System'
): Promise<void> {
  await client.query(
    `INSERT INTO settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, value, updatedBy]
  );
}

export async function ensureSyncApiSecret(executor: DbExecutor, updatedBy = 'System'): Promise<string> {
  const envSecret = sanitizeSecretToken(process.env.SYNC_API_SECRET);
  if (envSecret) return envSecret;

  const map = await readSettingsRows(executor, ['sync_api_secret_enc', 'sync_api_secret']);
  const decrypted = decryptServerSecret(map.sync_api_secret_enc || '');
  if (decrypted) return decrypted;

  const plainFallback = sanitizeSecretToken(map.sync_api_secret);
  if (plainFallback) return plainFallback;

  const fixedSecret = sanitizeSecretToken(FIXED_SERVER_CONFIG.syncApiSecret);
  if (fixedSecret) {
    await upsertServerSetting(executor, 'sync_api_secret_enc', encryptServerSecret(fixedSecret), updatedBy);
    return fixedSecret;
  }

  const generated = `rg_sync_${crypto.randomBytes(24).toString('hex')}`;
  await upsertServerSetting(executor, 'sync_api_secret_enc', encryptServerSecret(generated), updatedBy);
  return generated;
}

export interface SyncSecretDiagnostics {
  configured: boolean;
  source: 'env' | 'db_encrypted' | 'db_plain' | 'fixed_config' | 'none';
  length: number;
  hasEnvWhitespace: boolean;
  hasQuotes: boolean;
  hasWhitespace: boolean;
}

export interface RgTokenDiagnostics {
  configured: boolean;
  source: 'env' | 'db_encrypted' | 'db_plain' | 'fixed_config' | 'none';
  length: number;
  hasQuotes: boolean;
  hasWhitespace: boolean;
  hasBearerPrefix: boolean;
}

export async function getSyncSecretDiagnostics(executor?: DbClient): Promise<SyncSecretDiagnostics> {
  const rawEnv = process.env.SYNC_API_SECRET;
  const trimmedEnv = sanitizeSecretToken(rawEnv);
  const hasEnvWhitespace = hasInternalOrOuterWhitespace(rawEnv, false);
  if (trimmedEnv) {
    return {
      configured: true,
      source: 'env',
      length: trimmedEnv.length,
      hasEnvWhitespace,
      hasQuotes: hasWrappingQuotes(rawEnv),
      hasWhitespace: hasEnvWhitespace
    };
  }

  if (executor) {
    const map = await readSettingsRows(executor, ['sync_api_secret_enc', 'sync_api_secret']).catch(
      () => ({} as Record<string, string>)
    );
    const decrypted = decryptServerSecret(map.sync_api_secret_enc || '');
    if (decrypted) {
      return {
        configured: true,
        source: 'db_encrypted',
        length: decrypted.length,
        hasEnvWhitespace,
        hasQuotes: false,
        hasWhitespace: /\s/.test(decrypted)
      };
    }
    const rawPlain = map.sync_api_secret;
    const plain = sanitizeSecretToken(rawPlain);
    if (plain) {
      return {
        configured: true,
        source: 'db_plain',
        length: plain.length,
        hasEnvWhitespace,
        hasQuotes: hasWrappingQuotes(rawPlain),
        hasWhitespace: hasInternalOrOuterWhitespace(rawPlain, false)
      };
    }
  }

  const rawFixed = FIXED_SERVER_CONFIG.syncApiSecret;
  const fixed = sanitizeSecretToken(rawFixed);
  if (fixed) {
    return {
      configured: true,
      source: 'fixed_config',
      length: fixed.length,
      hasEnvWhitespace,
      hasQuotes: hasWrappingQuotes(rawFixed),
      hasWhitespace: hasInternalOrOuterWhitespace(rawFixed, false)
    };
  }

  return {
    configured: false,
    source: 'none',
    length: 0,
    hasEnvWhitespace,
    hasQuotes: false,
    hasWhitespace: false
  };
}

export async function getRgTokenDiagnostics(executor?: DbClient): Promise<RgTokenDiagnostics> {
  const rawEnv = process.env.RG_TOKEN;
  const envClean = normalizeBearerToken(rawEnv);
  if (envClean) {
    return {
      configured: true,
      source: 'env',
      length: envClean.length,
      hasQuotes: hasWrappingQuotes(rawEnv),
      hasWhitespace: hasInternalOrOuterWhitespace(rawEnv, true),
      hasBearerPrefix: /^(?:Bearer\s+)+/i.test(sanitizeSecretToken(rawEnv))
    };
  }

  if (executor) {
    const map = await readSettingsRows(executor, ['rg_token_enc', 'rg_direct_token', 'rg_token']).catch(
      () => ({} as Record<string, string>)
    );
    const decryptedRaw = decryptServerSecret(map.rg_token_enc || '');
    const decryptedClean = normalizeBearerToken(decryptedRaw);
    if (decryptedClean) {
      return {
        configured: true,
        source: 'db_encrypted',
        length: decryptedClean.length,
        hasQuotes: false,
        hasWhitespace: hasInternalOrOuterWhitespace(decryptedClean, false),
        hasBearerPrefix: /^(?:Bearer\s+)+/i.test(decryptedRaw)
      };
    }
    const rawDbPlain = map.rg_direct_token || map.rg_token || '';
    const dbPlainClean = normalizeBearerToken(rawDbPlain);
    if (dbPlainClean) {
      return {
        configured: true,
        source: 'db_plain',
        length: dbPlainClean.length,
        hasQuotes: hasWrappingQuotes(rawDbPlain),
        hasWhitespace: hasInternalOrOuterWhitespace(rawDbPlain, true),
        hasBearerPrefix: /^(?:Bearer\s+)+/i.test(sanitizeSecretToken(rawDbPlain))
      };
    }
  }

  const rawFixed = FIXED_SERVER_CONFIG.rgToken;
  const fixedClean = normalizeBearerToken(rawFixed);
  if (fixedClean) {
    return {
      configured: true,
      source: 'fixed_config',
      length: fixedClean.length,
      hasQuotes: hasWrappingQuotes(rawFixed),
      hasWhitespace: hasInternalOrOuterWhitespace(rawFixed, true),
      hasBearerPrefix: /^(?:Bearer\s+)+/i.test(sanitizeSecretToken(rawFixed))
    };
  }

  return {
    configured: false,
    source: 'none',
    length: 0,
    hasQuotes: false,
    hasWhitespace: false,
    hasBearerPrefix: false
  };
}

export async function resolveServerConfig(executor: DbClient): Promise<ResolvedServerConfig> {
  const envGasUrl = sanitizeSecretToken(process.env.GAS_WEBAPP_URL);
  const envRgToken = normalizeBearerToken(process.env.RG_TOKEN);
  const envSyncSecret = sanitizeSecretToken(process.env.SYNC_API_SECRET);
  const rawEnvBase = sanitizeSecretToken(process.env.RG_API_BASE_URL);
  const envBaseUrl = rawEnvBase ? normalizeRgApiBaseUrl(rawEnvBase) : '';
  const envMode = normalizeMode(process.env.CONNECTION_MODE);

  const map = await readSettingsRows(executor, [
    'connection_mode',
    'gas_webapp_url',
    'rg_token_enc',
    'rg_direct_token',
    'rg_token',
    'sync_api_secret_enc',
    'sync_api_secret',
    'rg_api_base_url'
  ]).catch(() => ({} as Record<string, string>));

  const fixedGasUrl = sanitizeSecretToken(FIXED_SERVER_CONFIG.gasWebAppUrl);
  const fixedRgToken = normalizeBearerToken(FIXED_SERVER_CONFIG.rgToken);
  const fixedSyncSecret = sanitizeSecretToken(FIXED_SERVER_CONFIG.syncApiSecret);
  const rawFixedBase = sanitizeSecretToken(FIXED_SERVER_CONFIG.rgApiBaseUrl);
  const fixedBaseUrl = rawFixedBase ? normalizeRgApiBaseUrl(rawFixedBase) : '';
  const fixedMode = normalizeMode(FIXED_SERVER_CONFIG.mode);

  const dbMode = normalizeMode(map.connection_mode);
  const dbGasUrl = sanitizeSecretToken(map.gas_webapp_url);
  const dbRgToken =
    normalizeBearerToken(decryptServerSecret(map.rg_token_enc || '')) ||
    normalizeBearerToken(map.rg_direct_token) ||
    normalizeBearerToken(map.rg_token);
  const dbSyncSecret =
    decryptServerSecret(map.sync_api_secret_enc || '') || sanitizeSecretToken(map.sync_api_secret);
  const rawDbBase = sanitizeSecretToken(map.rg_api_base_url);
  const dbBaseUrl = rawDbBase ? normalizeRgApiBaseUrl(rawDbBase) : '';

  const gasWebAppUrl = dbMode === 'sandbox' ? '' : (dbGasUrl || envGasUrl || fixedGasUrl);
  const mode = dbMode || fixedMode || envMode || (getDatabaseUrl() ? 'neon' : (gasWebAppUrl ? 'gas' : 'sandbox'));

  return {
    mode,
    gasWebAppUrl,
    rgToken: envRgToken || dbRgToken || fixedRgToken,
    rgApiBaseUrl: normalizeRgApiBaseUrl(dbBaseUrl || envBaseUrl || fixedBaseUrl || DEFAULT_RG_API_BASE_URL),
    syncApiSecret: envSyncSecret || dbSyncSecret || fixedSyncSecret,
    hasEnvGasUrl: Boolean(envGasUrl),
    hasEnvRgToken: Boolean(envRgToken),
    hasEnvSyncSecret: Boolean(envSyncSecret),
    hasFixedConfig: Boolean(FIXED_SERVER_CONFIG.mode || FIXED_SERVER_CONFIG.databaseUrl || FIXED_SERVER_CONFIG.gasWebAppUrl)
  };
}

export async function readPublicHealthAutoBind(
  executor?: DbClient
): Promise<{ mode: FixedConnectionMode; gasWebAppUrl: string }> {
  const envGasUrl = sanitizeSecretToken(process.env.GAS_WEBAPP_URL);
  const fixedGasUrl = sanitizeSecretToken(FIXED_SERVER_CONFIG.gasWebAppUrl);
  const fixedMode = normalizeMode(FIXED_SERVER_CONFIG.mode || process.env.CONNECTION_MODE);

  let dbMode: FixedConnectionMode = '';
  let dbGasUrl = '';

  if (executor && getDatabaseUrl()) {
    try {
      const res = await executor.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
        [['connection_mode', 'gas_webapp_url']]
      );
      for (const row of res.rows) {
        if (row.key === 'connection_mode') dbMode = normalizeMode(row.value);
        if (row.key === 'gas_webapp_url') dbGasUrl = sanitizeSecretToken(row.value);
      }
    } catch {
      // Non-fatal fallback
    }
  }

  const resolvedGasUrl = dbMode === 'sandbox' ? '' : (dbGasUrl || envGasUrl || fixedGasUrl);
  const resolvedMode = dbMode || fixedMode || (getDatabaseUrl() ? 'neon' : (resolvedGasUrl ? 'gas' : ''));
  return {
    mode: resolvedMode,
    gasWebAppUrl: resolvedMode === 'sandbox' ? '' : resolvedGasUrl
  };
}
