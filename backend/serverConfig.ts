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

export function encryptServerSecret(plainText: string): string {
  const clean = String(plainText || '').trim();
  if (!clean) return '';
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptServerSecret(storedValue: string): string {
  const raw = String(storedValue || '').trim();
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
    return decrypted.toString('utf8').trim();
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
  const envSecret = String(process.env.SYNC_API_SECRET || '').trim();
  if (envSecret) return envSecret;

  const map = await readSettingsRows(executor, ['sync_api_secret_enc', 'sync_api_secret']);
  const decrypted = decryptServerSecret(map.sync_api_secret_enc || '');
  if (decrypted) return decrypted;

  const plainFallback = String(map.sync_api_secret || '').trim();
  if (plainFallback) return plainFallback;

  const fixedSecret = String(FIXED_SERVER_CONFIG.syncApiSecret || '').trim();
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
}

export async function getSyncSecretDiagnostics(executor?: DbClient): Promise<SyncSecretDiagnostics> {
  const rawEnv = process.env.SYNC_API_SECRET;
  const trimmedEnv = String(rawEnv || '').trim();
  const hasEnvWhitespace = typeof rawEnv === 'string' && rawEnv !== trimmedEnv;
  if (trimmedEnv) {
    return {
      configured: true,
      source: 'env',
      length: trimmedEnv.length,
      hasEnvWhitespace
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
        hasEnvWhitespace
      };
    }
    const plain = String(map.sync_api_secret || '').trim();
    if (plain) {
      return {
        configured: true,
        source: 'db_plain',
        length: plain.length,
        hasEnvWhitespace
      };
    }
  }

  const fixed = String(FIXED_SERVER_CONFIG.syncApiSecret || '').trim();
  if (fixed) {
    return {
      configured: true,
      source: 'fixed_config',
      length: fixed.length,
      hasEnvWhitespace
    };
  }

  return {
    configured: false,
    source: 'none',
    length: 0,
    hasEnvWhitespace
  };
}

export async function resolveServerConfig(executor: DbClient): Promise<ResolvedServerConfig> {
  const envGasUrl = String(process.env.GAS_WEBAPP_URL || '').trim();
  const envRgToken = String(process.env.RG_TOKEN || '').replace(/^Bearer\s+/i, '').trim();
  const envSyncSecret = String(process.env.SYNC_API_SECRET || '').trim();
  const rawEnvBase = String(process.env.RG_API_BASE_URL || '').trim();
  const envBaseUrl = rawEnvBase ? normalizeRgApiBaseUrl(rawEnvBase) : '';
  const envMode = normalizeMode(process.env.CONNECTION_MODE);

  const map = await readSettingsRows(executor, [
    'connection_mode',
    'gas_webapp_url',
    'rg_token_enc',
    'sync_api_secret_enc',
    'sync_api_secret',
    'rg_api_base_url'
  ]).catch(() => ({} as Record<string, string>));

  const fixedGasUrl = String(FIXED_SERVER_CONFIG.gasWebAppUrl || '').trim();
  const fixedRgToken = String(FIXED_SERVER_CONFIG.rgToken || '').replace(/^Bearer\s+/i, '').trim();
  const fixedSyncSecret = String(FIXED_SERVER_CONFIG.syncApiSecret || '').trim();
  const rawFixedBase = String(FIXED_SERVER_CONFIG.rgApiBaseUrl || '').trim();
  const fixedBaseUrl = rawFixedBase ? normalizeRgApiBaseUrl(rawFixedBase) : '';
  const fixedMode = normalizeMode(FIXED_SERVER_CONFIG.mode);

  const dbMode = normalizeMode(map.connection_mode);
  const dbGasUrl = String(map.gas_webapp_url || '').trim();
  const dbRgToken = decryptServerSecret(map.rg_token_enc || '').replace(/^Bearer\s+/i, '').trim();
  const dbSyncSecret =
    decryptServerSecret(map.sync_api_secret_enc || '') || String(map.sync_api_secret || '').trim();
  const rawDbBase = String(map.rg_api_base_url || '').trim();
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
  const envGasUrl = String(process.env.GAS_WEBAPP_URL || '').trim();
  const fixedGasUrl = String(FIXED_SERVER_CONFIG.gasWebAppUrl || '').trim();
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
        if (row.key === 'gas_webapp_url') dbGasUrl = String(row.value || '').trim();
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
