import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { crmCore, requireApiAccess, requireAuth, requirePermission, type AuthSession } from './auth';
import {
  checkDatabaseHealth,
  createPgExecutor,
  ensureSchemaInitialized,
  getDatabaseUrl,
  isDatabaseConfigured,
  resetPool,
  type DbExecutor
} from './db';
import { getEnv, isCloudflareWorkerRuntime, setRuntimeEnv } from './env';
import * as queries from './queries';

export interface AutoConnectInput {
  databaseUrl?: string;
  gasWebAppUrl?: string;
  backendApiUrl?: string;
  rgToken?: string;
  token?: string;
  spreadsheetId?: string;
  syncSecret?: string;
  neonSyncUrl?: string;
  gasToken?: string;
  autoEnableBackend?: boolean;
  verifyConnections?: boolean;
  syncGasProperties?: boolean;
  writeFiles?: boolean;
  initialSetup?: boolean;
  clearDatabaseUrl?: boolean;
  clearRgToken?: boolean;
}

export interface AutoConnectStatusResult {
  filesWritable: boolean;
  runtime: 'node' | 'worker';
  database: {
    configured: boolean;
    connected: boolean;
    host: string;
    maskedUrl: string;
    error?: string;
  };
  gas: {
    configured: boolean;
    url: string;
    configFileUrl: string;
    envUrl: string;
  };
  backend: {
    apiUrl: string;
    configFileUrl: string;
    envUrl: string;
  };
  rentalGate: {
    configured: boolean;
    maskedToken: string;
  };
  sync: {
    hasSecret: boolean;
    spreadsheetId: string;
  };
}

export interface AutoConnectExecutionResult {
  saved: boolean;
  filesWritable: boolean;
  updatedFiles: string[];
  connectionConfig: {
    gasWebAppUrl: string;
    backendApiUrl: string;
  };
  status: AutoConnectStatusResult;
  checks: {
    database?: { configured: boolean; connected: boolean; initialized: boolean; verified?: boolean; message: string };
    gas?: { configured: boolean; connected: boolean; verified?: boolean; message: string };
    gasRemoteSync?: { attempted: boolean; synced: boolean; mode: string; message: string };
    rentalGate?: { configured: boolean; connected: boolean; statusCode: number; verified?: boolean; message: string };
  };
}

export interface AutoConnectDeps {
  fetchFn?: typeof fetch;
  dbProbeFn?: (connectionString: string) => Promise<{ connected: boolean; initialized: boolean; message: string }>;
}

const ENV_EXAMPLE_CONTENT = `# RENTAL GATE CRM — Environment Variables Template
# يمكنك ضبط هذه المتغيرات مباشرة من داخل الموقع عبر "الربط التلقائي الشامل" في الإعدادات

PORT=3000

# 1. PostgreSQL / Neon Database Connection String (Server-only secret)
DATABASE_URL=

# 2. Google Apps Script Deployed Web App URL (/exec)
GAS_WEBAPP_URL=

# 3. Rental Gate API Bearer Token (Server-only & GAS Script Properties)
RG_TOKEN=
RENTAL_TOKEN=

# 4. Shared Secret for Neon <-> Google Sheets Mirror Sync
SYNC_API_SECRET=

# 5. Optional Google Sheet ID & Custom Rental Gate Base URL
SPREADSHEET_ID=
RG_API_BASE_URL=https://api.rentalgate.net/api

# 6. Public Vite Client Auto-Connect Defaults (Safe non-secret URLs)
VITE_GAS_WEBAPP_URL=
VITE_BACKEND_API_URL=
`;

const GITIGNORE_REQUIRED_LINES = [
  'node_modules/',
  'dist/',
  '.env',
  '.env.*',
  '!.env.example',
  '.dev.vars',
  '.playwright-cli/'
];

export function readClientConfigFileUrls(rootDir: string): { gasWebAppUrl: string; backendApiUrl: string } {
  try {
    const cfgPath = path.resolve(rootDir, 'assets/js/config.js');
    if (!fs.existsSync(cfgPath)) return { gasWebAppUrl: '', backendApiUrl: '' };
    const rawText = fs.readFileSync(cfgPath, 'utf8');
    const codeOnly = rawText
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const gasMatch = codeOnly.match(/gasWebAppUrl\s*:\s*(['"])(.*?)\1/);
    const backendMatch = codeOnly.match(/backendApiUrl\s*:\s*(['"])(.*?)\1/);
    return {
      gasWebAppUrl: String(gasMatch?.[2] || '').trim(),
      backendApiUrl: String(backendMatch?.[2] || '').trim()
    };
  } catch {
    return { gasWebAppUrl: '', backendApiUrl: '' };
  }
}

export function canWriteLocalProjectFiles(rootDir: string): boolean {
  if (isCloudflareWorkerRuntime()) return false;
  try {
    const resolved = path.resolve(rootDir);
    fs.accessSync(resolved, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureGitignoreProtected(rootDir: string): boolean {
  const gitignorePath = path.resolve(rootDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  let changed = !fs.existsSync(gitignorePath);
  for (const reqLine of GITIGNORE_REQUIRED_LINES) {
    if (!lines.some((l) => l.trim() === reqLine)) {
      lines.push(reqLine);
      changed = true;
    }
  }
  if (changed) {
    const clean = lines.filter((l, idx) => idx < lines.length - 1 || l.trim() !== '');
    fs.writeFileSync(gitignorePath, `${clean.join('\n')}\n`, 'utf8');
  }
  return changed;
}

function ensureEnvExampleExists(rootDir: string): boolean {
  const examplePath = path.resolve(rootDir, '.env.example');
  if (fs.existsSync(examplePath)) return false;
  fs.writeFileSync(examplePath, ENV_EXAMPLE_CONTENT, 'utf8');
  return true;
}

function extractDbHost(url: string): string {
  const checked = crmCore.validateDatabaseUrl(url);
  return checked?.host || '';
}

export async function getAutoConnectStatus(
  rootDir: string,
  options: { checkDbHealth?: boolean } = {}
): Promise<AutoConnectStatusResult> {
  const dbUrl = getDatabaseUrl();
  const cfgUrls = readClientConfigFileUrls(rootDir);
  const envGas = String(getEnv('GAS_WEBAPP_URL') || getEnv('VITE_GAS_WEBAPP_URL') || '').trim();
  const envBackend = String(getEnv('VITE_BACKEND_API_URL') || '').trim();
  const effectiveGas = cfgUrls.gasWebAppUrl || envGas;
  const effectiveBackend = cfgUrls.backendApiUrl || envBackend || (dbUrl ? '/api/crm' : '');
  const rgToken = String(getEnv('RG_TOKEN') || getEnv('RENTAL_TOKEN') || '').trim();
  const syncSecret = String(getEnv('SYNC_API_SECRET') || '').trim();
  const spreadsheetId = String(getEnv('SPREADSHEET_ID') || '').trim();

  let dbConnected = false;
  let dbError: string | undefined;
  if (dbUrl && options.checkDbHealth !== false) {
    const health = await checkDatabaseHealth();
    dbConnected = health.connected;
    dbError = health.error;
  }

  return {
    filesWritable: canWriteLocalProjectFiles(rootDir),
    runtime: isCloudflareWorkerRuntime() ? 'worker' : 'node',
    database: {
      configured: Boolean(dbUrl),
      connected: dbConnected,
      host: extractDbHost(dbUrl),
      maskedUrl: crmCore.maskDatabaseUrl(dbUrl),
      error: dbError
    },
    gas: {
      configured: Boolean(effectiveGas),
      url: effectiveGas,
      configFileUrl: cfgUrls.gasWebAppUrl,
      envUrl: envGas
    },
    backend: {
      apiUrl: effectiveBackend,
      configFileUrl: cfgUrls.backendApiUrl,
      envUrl: envBackend
    },
    rentalGate: {
      configured: Boolean(rgToken),
      maskedToken: crmCore.maskSecretValue(rgToken)
    },
    sync: {
      hasSecret: Boolean(syncSecret),
      spreadsheetId
    }
  };
}

export async function authorizeAutoConnect(
  rawToken: string,
  requireWritePermission: boolean
): Promise<{ authorized: boolean; mode: 'db_gm' | 'initial_unconfigured'; session?: AuthSession; statusCode?: number; error?: string }> {
  if (!isDatabaseConfigured()) {
    return { authorized: true, mode: 'initial_unconfigured' };
  }
  const cleanToken = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
  try {
    const exec: DbExecutor = createPgExecutor();
    const session = await requireAuth(exec, cleanToken);
    if (requireWritePermission) {
      requirePermission(session, 'manage_settings');
    } else {
      requireApiAccess(session);
    }
    return { authorized: true, mode: 'db_gm', session };
  } catch (err: any) {
    const msg = String(err?.message || 'UNAUTHORIZED');
    const isForbidden = msg.startsWith('FORBIDDEN');
    return {
      authorized: false,
      mode: 'db_gm',
      statusCode: isForbidden ? 403 : 401,
      error: msg
    };
  }
}

export async function executeAutoConnect(
  rootDir: string,
  rawInput: AutoConnectInput,
  deps: AutoConnectDeps = {}
): Promise<AutoConnectExecutionResult> {
  const fetchFn = deps.fetchFn || fetch;
  const normalizedResult = crmCore.normalizeAutoConnectPayload(rawInput || {});
  if (!normalizedResult.valid) {
    throw new Error(`VALIDATION_ERROR: ${normalizedResult.errors.join(' | ')}`);
  }

  const norm = normalizedResult.normalized;
  const existingDbUrl = getDatabaseUrl();
  const existingRgToken = String(getEnv('RG_TOKEN') || getEnv('RENTAL_TOKEN') || '').trim();
  const existingSyncSecret = String(getEnv('SYNC_API_SECRET') || '').trim();
  const existingSpreadsheetId = String(getEnv('SPREADSHEET_ID') || '').trim();

  const effectiveDbUrl = rawInput?.clearDatabaseUrl ? '' : (norm.databaseUrl || existingDbUrl);
  const effectiveRgToken = rawInput?.clearRgToken ? '' : (norm.rgToken || existingRgToken);
  const effectiveGasUrl = norm.gasWebAppUrl;
  const effectiveBackendUrl = norm.backendApiUrl || (effectiveDbUrl && rawInput?.autoEnableBackend !== false ? '/api/crm' : '');
  const effectiveSpreadsheetId = norm.spreadsheetId !== undefined && norm.spreadsheetId !== ''
    ? norm.spreadsheetId
    : existingSpreadsheetId;

  let effectiveSyncSecret = norm.syncSecret || existingSyncSecret;
  if (!effectiveSyncSecret && (effectiveDbUrl || effectiveGasUrl)) {
    effectiveSyncSecret = crypto.randomBytes(24).toString('hex');
  }

  const filesWritable = canWriteLocalProjectFiles(rootDir);
  const updatedFiles: string[] = [];

  if (rawInput?.writeFiles !== false && filesWritable) {
    if (ensureGitignoreProtected(rootDir)) {
      updatedFiles.push('.gitignore');
    }
    if (ensureEnvExampleExists(rootDir)) {
      updatedFiles.push('.env.example');
    }

    const envPath = path.resolve(rootDir, '.env');
    const currentEnvText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const envUpdates: Record<string, string | null | undefined> = {
      DATABASE_URL: effectiveDbUrl || null,
      GAS_WEBAPP_URL: effectiveGasUrl || '',
      RG_TOKEN: effectiveRgToken || null,
      RENTAL_TOKEN: effectiveRgToken || null,
      SYNC_API_SECRET: effectiveSyncSecret || '',
      SPREADSHEET_ID: effectiveSpreadsheetId || '',
      VITE_GAS_WEBAPP_URL: effectiveGasUrl || '',
      VITE_BACKEND_API_URL: effectiveBackendUrl || ''
    };
    const nextEnvText = crmCore.mergeDotEnvContent(currentEnvText, envUpdates);
    fs.writeFileSync(envPath, nextEnvText, 'utf8');
    updatedFiles.push('.env');

    const configJsText = crmCore.buildClientConfigJsContent({
      gasWebAppUrl: effectiveGasUrl,
      backendApiUrl: effectiveBackendUrl
    });
    const clientCfgPath = path.resolve(rootDir, 'assets/js/config.js');
    fs.mkdirSync(path.dirname(clientCfgPath), { recursive: true });
    fs.writeFileSync(clientCfgPath, configJsText, 'utf8');
    updatedFiles.push('assets/js/config.js');

    const distCfgPath = path.resolve(rootDir, 'dist/assets/js/config.js');
    if (fs.existsSync(path.dirname(distCfgPath))) {
      fs.writeFileSync(distCfgPath, configJsText, 'utf8');
      updatedFiles.push('dist/assets/js/config.js');
    }
  }

  // Apply to active process/runtime environment immediately
  setRuntimeEnv('DATABASE_URL', effectiveDbUrl);
  setRuntimeEnv('GAS_WEBAPP_URL', effectiveGasUrl);
  setRuntimeEnv('VITE_GAS_WEBAPP_URL', effectiveGasUrl);
  setRuntimeEnv('VITE_BACKEND_API_URL', effectiveBackendUrl);
  setRuntimeEnv('RG_TOKEN', effectiveRgToken);
  setRuntimeEnv('RENTAL_TOKEN', effectiveRgToken);
  setRuntimeEnv('SYNC_API_SECRET', effectiveSyncSecret);
  setRuntimeEnv('SPREADSHEET_ID', effectiveSpreadsheetId);

  if (!deps.dbProbeFn) {
    await resetPool();
  }

  const checks: AutoConnectExecutionResult['checks'] = {};
  const shouldVerify = rawInput?.verifyConnections !== false;

  if (effectiveDbUrl && shouldVerify) {
    if (deps.dbProbeFn) {
      const probe = await deps.dbProbeFn(effectiveDbUrl);
      checks.database = {
        configured: true,
        connected: probe.connected,
        initialized: probe.initialized,
        message: probe.message
      };
    } else {
      try {
        const exec = createPgExecutor();
        await exec.query('SELECT 1 AS ok');
        await ensureSchemaInitialized(exec);
        await queries.ensureSeededDatabase(exec);
        checks.database = {
          configured: true,
          connected: true,
          initialized: true,
          verified: true,
          message: 'تم الاتصال بقاعدة البيانات PostgreSQL وتهيئة الجداول وحساب المدير بنجاح.'
        };
      } catch (dbErr: any) {
        checks.database = {
          configured: true,
          connected: false,
          initialized: false,
          verified: true,
          message: `تم حفظ رابط قاعدة البيانات لكن تعذر الاتصال بها حاليًا: ${String(dbErr?.message || dbErr).slice(0, 180)}`
        };
      }
    }
  } else {
    checks.database = {
      configured: Boolean(effectiveDbUrl),
      connected: false,
      initialized: false,
      verified: false,
      message: effectiveDbUrl ? 'تم حفظ رابط قاعدة البيانات دون اختبار الاتصال.' : 'لم يتم تعيين رابط PostgreSQL (يمكن العمل عبر Apps Script أو المعاينة المحلية).'
    };
  }

  if (effectiveGasUrl && shouldVerify) {
    try {
      const pingResp = await fetchFn(effectiveGasUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping', payload: {} })
      });
      const pingText = await pingResp.text();
      const pingParsed = crmCore.parseGasResponseText(pingText, pingResp.status);
      checks.gas = {
        configured: true,
        connected: Boolean(pingParsed?.success),
        verified: true,
        message: pingParsed?.success
          ? 'تم الاتصال بخدمة Google Apps Script Web App (/exec) بنجاح.'
          : (pingParsed?.message || `استجابة غير متوقعة من Apps Script (HTTP ${pingResp.status})`)
      };
    } catch (gasErr: any) {
      checks.gas = {
        configured: true,
        connected: false,
        verified: true,
        message: `تعذر الوصول إلى رابط Apps Script: ${String(gasErr?.message || gasErr).slice(0, 180)}`
      };
    }
  } else {
    checks.gas = {
      configured: Boolean(effectiveGasUrl),
      connected: false,
      verified: false,
      message: effectiveGasUrl ? 'تم حفظ رابط Apps Script دون فحص.' : 'لم يتم تحديد رابط Google Apps Script (/exec).'
    };
  }

  // Push RG_TOKEN / SPREADSHEET_ID / SYNC props to GAS if authenticated via gasToken or shared secret
  const shouldSyncGas = rawInput?.syncGasProperties !== false && Boolean(effectiveGasUrl) && (Boolean(effectiveRgToken) || Boolean(effectiveSpreadsheetId) || Boolean(norm.neonSyncUrl));
  if (shouldSyncGas) {
    const gasToken = String(rawInput?.gasToken || '').trim();
    if (gasToken) {
      try {
        const pushResp = await fetchFn(effectiveGasUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'applyAutoConnectConfig',
            token: gasToken,
            payload: {
              rgToken: effectiveRgToken,
              spreadsheetId: effectiveSpreadsheetId,
              neonSyncUrl: norm.neonSyncUrl,
              syncSecret: effectiveSyncSecret,
              initDb: true
            }
          })
        });
        const pushJson = crmCore.parseGasResponseText(await pushResp.text(), pushResp.status);
        checks.gasRemoteSync = {
          attempted: true,
          synced: Boolean(pushJson?.success),
          mode: 'session',
          message: pushJson?.success
            ? 'تمت مزامنة التوكن وخصائص الربط مباشرة إلى Script Properties في Google Apps Script.'
            : (pushJson?.message || 'تعذر دفع الخصائص تلقائيًا عبر جلسة Apps Script.')
        };
      } catch (e: any) {
        checks.gasRemoteSync = {
          attempted: true,
          synced: false,
          mode: 'session',
          message: `تعذر تحديث خصائص Apps Script عن بُعد: ${String(e?.message || e).slice(0, 150)}`
        };
      }
    } else if (effectiveSyncSecret && (effectiveRgToken || effectiveSpreadsheetId || norm.neonSyncUrl)) {
      const mirrorItems: Array<{ entityType: string; action: string; payload: Record<string, any> }> = [];
      if (effectiveRgToken) {
        mirrorItems.push({ entityType: 'RgToken', action: 'saveRgToken', payload: { rgToken: effectiveRgToken } });
      }
      if (effectiveSpreadsheetId || norm.neonSyncUrl) {
        mirrorItems.push({
          entityType: 'AutoConnectProps',
          action: 'saveAutoConnectProps',
          payload: {
            rgToken: effectiveRgToken,
            spreadsheetId: effectiveSpreadsheetId,
            neonSyncUrl: norm.neonSyncUrl,
            syncSecret: effectiveSyncSecret
          }
        });
      }
      try {
        const mirrorResp = await fetchFn(effectiveGasUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'syncFromNeonMirror',
            payload: { syncSecret: effectiveSyncSecret, items: mirrorItems }
          })
        });
        const mirrorJson = crmCore.parseGasResponseText(await mirrorResp.text(), mirrorResp.status);
        checks.gasRemoteSync = {
          attempted: true,
          synced: Boolean(mirrorJson?.success),
          mode: 'sync_secret',
          message: mirrorJson?.success
            ? 'تم تحديث توكن Rental Gate في Google Apps Script بنجاح.'
            : 'تم حفظ التوكن محليًا في الخادم. لمزامنته مع Apps Script تلقائيًا، افتح الجلسة على Apps Script أو اضبط SYNC_API_SECRET هناك.'
        };
      } catch {
        checks.gasRemoteSync = {
          attempted: true,
          synced: false,
          mode: 'sync_secret',
          message: 'تم الحفظ في ملفات الخادم (.env). قد يتطلب تحديث Script Properties تسجيل دخول على Apps Script.'
        };
      }
    }
  }

  if (effectiveRgToken && shouldVerify) {
    try {
      const baseApi = String(getEnv('RG_API_BASE_URL', 'https://api.rentalgate.net/api')).replace(/\/+$/, '');
      const rgResp = await fetchFn(`${baseApi}/reservations/filter?page=0&size=1`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${effectiveRgToken}`,
          Accept: 'application/json',
          lang: 'ar'
        }
      });
      checks.rentalGate = {
        configured: true,
        connected: rgResp.ok,
        statusCode: rgResp.status,
        verified: true,
        message: rgResp.ok
          ? 'تم التحقق من توكن Rental Gate API والاتصال يعمل بنجاح.'
          : `فشل اختبار توكن Rental Gate API (HTTP ${rgResp.status}) — تأكد من صلاحية التوكن.`
      };
    } catch (rgErr: any) {
      checks.rentalGate = {
        configured: true,
        connected: false,
        statusCode: 0,
        verified: true,
        message: `تعذر الوصول إلى خادم Rental Gate API حاليًا: ${String(rgErr?.message || rgErr).slice(0, 150)}`
      };
    }
  } else {
    checks.rentalGate = {
      configured: Boolean(effectiveRgToken),
      connected: false,
      statusCode: 0,
      verified: false,
      message: effectiveRgToken ? 'تم حفظ توكن Rental Gate في .env دون فحص.' : 'لم يتم إدخال توكن Rental Gate API.'
    };
  }

  const status = await getAutoConnectStatus(rootDir, { checkDbHealth: false });
  status.database.connected = Boolean(checks.database?.connected);

  return {
    saved: true,
    filesWritable,
    updatedFiles,
    connectionConfig: {
      gasWebAppUrl: effectiveGasUrl,
      backendApiUrl: effectiveBackendUrl
    },
    status,
    checks
  };
}
