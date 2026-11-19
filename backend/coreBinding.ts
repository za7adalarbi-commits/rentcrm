import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FixedConnectionMode, FixedServerConfig } from './fixedConfig.js';
import { FIXED_SERVER_CONFIG } from './fixedConfig.js';

export interface CoreClientConfigInput {
  mode: FixedConnectionMode;
  gasWebAppUrl: string;
  backendApiUrl: string;
}

export interface PersistCoreFilesResult {
  writable: boolean;
  readOnlyFilesystem: boolean;
  updatedFiles: string[];
  generatedConfigJs: string;
  reason?: string;
}

export function normalizeMode(raw: unknown): FixedConnectionMode {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'neon' || val === 'gas' || val === 'sandbox') {
    return val;
  }
  return '';
}

export function maskDatabaseUrl(rawUrl: string): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    const dbName = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${parsed.protocol}//***@${parsed.host}${dbName}`;
  } catch {
    return 'postgresql://***';
  }
}

export function buildClientConfigJsContent(cfg: CoreClientConfigInput): string {
  const mode = normalizeMode(cfg.mode);
  const gasWebAppUrl = String(cfg.gasWebAppUrl || '').trim();
  const backendApiUrl = String(cfg.backendApiUrl || '').trim();
  return `/**
 * RENTAL GATE CRM — Global Fixed Connection Configuration
 * يتم تحديث هذا الملف تلقائيًا عند الحفظ والربط من صفحة الإعدادات في الموقع.
 * لا يحتوي على أي توكنات أو أسرار — القيم العامة للوضع وربط الواجهة فقط.
 */
(function (root) {
  'use strict';
  root.RG_APP_CONFIG = Object.assign({
    mode: ${JSON.stringify(mode)},
    gasWebAppUrl: ${JSON.stringify(gasWebAppUrl)},
    backendApiUrl: ${JSON.stringify(backendApiUrl)}
  }, root.RG_APP_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

export function buildFixedServerConfigTsContent(cfg: FixedServerConfig): string {
  const mode = normalizeMode(cfg.mode);
  const databaseUrl = String(cfg.databaseUrl || '').trim();
  const gasWebAppUrl = String(cfg.gasWebAppUrl || '').trim();
  const rgToken = String(cfg.rgToken || '').trim().replace(/^Bearer\s+/i, '');
  const rgApiBaseUrl = String(cfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').trim().replace(/\/+$/, '');
  const syncApiSecret = String(cfg.syncApiSecret || '').trim();
  const updatedAt = String(cfg.updatedAt || '').trim();
  const updatedBy = String(cfg.updatedBy || '').trim();

  return `// Auto-managed by RENTAL GATE CRM Settings ("حفظ وربط وتثبيت في الكود الأساسي").
// Server-only module: never import this file from frontend browser bundles.

export type FixedConnectionMode = '' | 'neon' | 'gas' | 'sandbox';

export interface FixedServerConfig {
  mode: FixedConnectionMode;
  databaseUrl: string;
  gasWebAppUrl: string;
  rgToken: string;
  rgApiBaseUrl: string;
  syncApiSecret: string;
  updatedAt: string;
  updatedBy: string;
}

export const FIXED_SERVER_CONFIG: FixedServerConfig = {
  mode: ${JSON.stringify(mode)},
  databaseUrl: ${JSON.stringify(databaseUrl)},
  gasWebAppUrl: ${JSON.stringify(gasWebAppUrl)},
  rgToken: ${JSON.stringify(rgToken)},
  rgApiBaseUrl: ${JSON.stringify(rgApiBaseUrl)},
  syncApiSecret: ${JSON.stringify(syncApiSecret)},
  updatedAt: ${JSON.stringify(updatedAt)},
  updatedBy: ${JSON.stringify(updatedBy)}
};
`;
}

function formatEnvValue(val: string): string {
  const clean = String(val || '').replace(/\r?\n/g, '').trim();
  return JSON.stringify(clean);
}

export function mergeDotEnvContent(existingText: string, updates: Record<string, string>): string {
  const lines = existingText ? existingText.replace(/\r\n/g, '\n').split('\n') : [];
  const handled = new Set<string>();
  const nextLines = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m) return line;
    const key = m[1];
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      return line;
    }
    handled.add(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key)) {
      nextLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  return nextLines.join('\n').replace(/\n+$/, '') + '\n';
}

export function isCoreFilesystemWritable(rootDir: string = process.cwd()): boolean {
  if (process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return false;
  }
  try {
    const configJsPath = path.resolve(rootDir, 'assets/js/config.js');
    const backendDir = path.resolve(rootDir, 'backend');
    if (fs.existsSync(configJsPath)) {
      fs.accessSync(configJsPath, fs.constants.W_OK);
    } else {
      fs.accessSync(rootDir, fs.constants.W_OK);
    }
    if (fs.existsSync(backendDir)) {
      fs.accessSync(backendDir, fs.constants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function applyInMemoryServerConfig(cfg: FixedServerConfig): void {
  FIXED_SERVER_CONFIG.mode = normalizeMode(cfg.mode);
  FIXED_SERVER_CONFIG.databaseUrl = String(cfg.databaseUrl || '').trim();
  FIXED_SERVER_CONFIG.gasWebAppUrl = String(cfg.gasWebAppUrl || '').trim();
  FIXED_SERVER_CONFIG.rgToken = String(cfg.rgToken || '').trim().replace(/^Bearer\s+/i, '');
  FIXED_SERVER_CONFIG.rgApiBaseUrl = String(cfg.rgApiBaseUrl || 'https://api.rentalgate.net/api').trim().replace(/\/+$/, '');
  FIXED_SERVER_CONFIG.syncApiSecret = String(cfg.syncApiSecret || '').trim();
  FIXED_SERVER_CONFIG.updatedAt = String(cfg.updatedAt || '').trim();
  FIXED_SERVER_CONFIG.updatedBy = String(cfg.updatedBy || '').trim();

  if (FIXED_SERVER_CONFIG.databaseUrl) process.env.DATABASE_URL = FIXED_SERVER_CONFIG.databaseUrl;
  else delete process.env.DATABASE_URL;

  if (FIXED_SERVER_CONFIG.gasWebAppUrl) process.env.GAS_WEBAPP_URL = FIXED_SERVER_CONFIG.gasWebAppUrl;
  else delete process.env.GAS_WEBAPP_URL;

  if (FIXED_SERVER_CONFIG.rgToken) process.env.RG_TOKEN = FIXED_SERVER_CONFIG.rgToken;
  else delete process.env.RG_TOKEN;

  if (FIXED_SERVER_CONFIG.syncApiSecret) process.env.SYNC_API_SECRET = FIXED_SERVER_CONFIG.syncApiSecret;
  else delete process.env.SYNC_API_SECRET;

  if (FIXED_SERVER_CONFIG.rgApiBaseUrl) {
    process.env.RG_API_BASE_URL = FIXED_SERVER_CONFIG.rgApiBaseUrl;
  }
}

export function generateSyncSecretIfEmpty(currentSecret?: string): string {
  const clean = String(currentSecret || '').trim();
  if (clean) return clean;
  return `rg_sync_${crypto.randomBytes(24).toString('hex')}`;
}

export function persistCoreFilesOnDisk(
  rootDir: string,
  cfg: FixedServerConfig,
  options: { updateInMemory?: boolean } = {}
): PersistCoreFilesResult {
  const mode = normalizeMode(cfg.mode);
  const clientConfigJs = buildClientConfigJsContent({
    mode,
    gasWebAppUrl: mode === 'sandbox' ? '' : cfg.gasWebAppUrl,
    backendApiUrl: mode === 'neon' ? '/api/crm' : ''
  });

  if (options.updateInMemory !== false) {
    applyInMemoryServerConfig(cfg);
  }

  if (!isCoreFilesystemWritable(rootDir)) {
    return {
      writable: false,
      readOnlyFilesystem: true,
      updatedFiles: [],
      generatedConfigJs: clientConfigJs,
      reason: 'READ_ONLY_SERVERLESS_FILESYSTEM'
    };
  }

  const updatedFiles: string[] = [];

  try {
    const configJsPath = path.resolve(rootDir, 'assets/js/config.js');
    fs.mkdirSync(path.dirname(configJsPath), { recursive: true });
    fs.writeFileSync(configJsPath, clientConfigJs, 'utf8');
    updatedFiles.push('assets/js/config.js');

    const distConfigJsPath = path.resolve(rootDir, 'dist/assets/js/config.js');
    if (fs.existsSync(path.dirname(distConfigJsPath))) {
      fs.writeFileSync(distConfigJsPath, clientConfigJs, 'utf8');
      updatedFiles.push('dist/assets/js/config.js');
    }

    const fixedConfigTsPath = path.resolve(rootDir, 'backend/fixedConfig.ts');
    fs.mkdirSync(path.dirname(fixedConfigTsPath), { recursive: true });
    fs.writeFileSync(fixedConfigTsPath, buildFixedServerConfigTsContent(cfg), 'utf8');
    updatedFiles.push('backend/fixedConfig.ts');

    const dotEnvPath = path.resolve(rootDir, '.env');
    const existingEnv = fs.existsSync(dotEnvPath) ? fs.readFileSync(dotEnvPath, 'utf8') : '';
    const nextEnv = mergeDotEnvContent(existingEnv, {
      DATABASE_URL: cfg.databaseUrl || '',
      GAS_WEBAPP_URL: cfg.gasWebAppUrl || '',
      RG_TOKEN: cfg.rgToken || '',
      SYNC_API_SECRET: cfg.syncApiSecret || '',
      RG_API_BASE_URL: cfg.rgApiBaseUrl || 'https://api.rentalgate.net/api',
      CONNECTION_MODE: mode
    });
    fs.writeFileSync(dotEnvPath, nextEnv, 'utf8');
    updatedFiles.push('.env');

    return {
      writable: true,
      readOnlyFilesystem: false,
      updatedFiles,
      generatedConfigJs: clientConfigJs
    };
  } catch (err: any) {
    return {
      writable: false,
      readOnlyFilesystem: true,
      updatedFiles,
      generatedConfigJs: clientConfigJs,
      reason: String(err?.message || 'FILE_WRITE_FAILED')
    };
  }
}
