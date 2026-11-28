import type { AuthSession } from './auth.js';
import { crmCore, requirePermission } from './auth.js';
import {
  applyInMemoryServerConfig,
  generateSyncSecretIfEmpty,
  isCoreFilesystemWritable,
  maskDatabaseUrl,
  normalizeMode,
  normalizeRgApiBaseUrl,
  persistCoreFilesOnDisk,
  type PersistCoreFilesResult
} from './coreBinding.js';
import {
  createPgExecutor,
  ensureSchemaInitialized,
  getDatabaseUrl,
  isDatabaseConfigured,
  resetPoolForReconfig,
  testDatabaseConnection,
  type DbExecutor
} from './db.js';
import { FIXED_SERVER_CONFIG, type FixedConnectionMode } from './fixedConfig.js';
import {
  encryptServerSecret,
  ensureSyncApiSecret,
  resolveServerConfig,
  upsertServerSetting
} from './serverConfig.js';
import {
  buildVercelEnvChecklist,
  syncEnvVarsToVercel,
  type VercelEnvChecklistItem,
  type VercelEnvSyncResult
} from './vercelEnv.js';

export interface SetupCapabilitiesResponse {
  writableCoreFiles: boolean;
  isServerless: boolean;
  databaseConfigured: boolean;
  hasDatabaseUrl: boolean;
  maskedDatabaseUrl: string;
  mode: FixedConnectionMode;
  gasWebAppUrl: string;
  rgApiBaseUrl: string;
  hasRgToken: boolean;
  hasSyncSecret: boolean;
  hasEnvGasUrl: boolean;
  hasEnvDatabaseUrl: boolean;
  hasVercelToken: boolean;
  hasVercelProjectId: boolean;
  hasVercelDeployHook: boolean;
  vercelProjectUrl: string;
  updatedAt: string;
  updatedBy: string;
}

export async function getSetupCapabilities(
  executor?: DbExecutor,
  rootDir: string = process.cwd()
): Promise<SetupCapabilitiesResponse> {
  const writableCoreFiles = isCoreFilesystemWritable(rootDir);
  const dbUrl = getDatabaseUrl();
  const resolved = executor
    ? await resolveServerConfig(executor).catch(() => null)
    : null;

  const mode =
    (resolved?.mode) ||
    normalizeMode(FIXED_SERVER_CONFIG.mode || process.env.CONNECTION_MODE) ||
    (dbUrl ? 'neon' : ((process.env.GAS_WEBAPP_URL || FIXED_SERVER_CONFIG.gasWebAppUrl) ? 'gas' : 'sandbox'));

  const gasWebAppUrl =
    (resolved?.gasWebAppUrl) ||
    String(process.env.GAS_WEBAPP_URL || FIXED_SERVER_CONFIG.gasWebAppUrl || '').trim();

  const rgApiBaseUrl = normalizeRgApiBaseUrl(
    resolved?.rgApiBaseUrl || process.env.RG_API_BASE_URL || FIXED_SERVER_CONFIG.rgApiBaseUrl
  );

  const hasRgToken = Boolean(resolved?.rgToken || process.env.RG_TOKEN || FIXED_SERVER_CONFIG.rgToken);
  const hasSyncSecret = Boolean(resolved?.syncApiSecret || process.env.SYNC_API_SECRET || FIXED_SERVER_CONFIG.syncApiSecret);
  const vercelHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();

  return {
    writableCoreFiles,
    isServerless: process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
    databaseConfigured: isDatabaseConfigured(),
    hasDatabaseUrl: Boolean(dbUrl),
    maskedDatabaseUrl: maskDatabaseUrl(dbUrl),
    mode,
    gasWebAppUrl,
    rgApiBaseUrl,
    hasRgToken,
    hasSyncSecret,
    hasEnvGasUrl: Boolean(String(process.env.GAS_WEBAPP_URL || '').trim()),
    hasEnvDatabaseUrl: Boolean(String(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '').trim()),
    hasVercelToken: Boolean(String(process.env.VERCEL_TOKEN || '').trim()),
    hasVercelProjectId: Boolean(String(process.env.VERCEL_PROJECT_ID || '').trim()),
    hasVercelDeployHook: Boolean(String(process.env.VERCEL_DEPLOY_HOOK_URL || '').trim()),
    vercelProjectUrl: vercelHost ? `https://${vercelHost}` : '',
    updatedAt: FIXED_SERVER_CONFIG.updatedAt || '',
    updatedBy: FIXED_SERVER_CONFIG.updatedBy || ''
  };
}

export interface UnifiedSetupOptions {
  executor?: DbExecutor;
  session?: AuthSession;
  payload?: Record<string, any>;
  rootDir?: string;
  skipLiveDbTest?: boolean;
  wasDatabaseConfiguredBeforeRequest?: boolean;
  fetchFn?: typeof fetch;
  ensureSeededFn?: (exec: DbExecutor) => Promise<void>;
  logActivityFn?: (exec: DbExecutor, actor: any, action: string, target: string, targetId: string, details: string) => Promise<void>;
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

export async function applyUnifiedConnectionSetup(opts: UnifiedSetupOptions) {
  const payload = opts.payload && typeof opts.payload === 'object' ? opts.payload : {};
  const rootDir = opts.rootDir || process.cwd();
  const fetchFn = opts.fetchFn || fetch;
  const hadEnvGasUrlBefore = str(process.env.GAS_WEBAPP_URL);
  const hadEnvModeBefore = normalizeMode(process.env.CONNECTION_MODE);

  if (opts.session) {
    requirePermission(opts.session, 'manage_settings');
  }

  let mode = normalizeMode(payload.mode);
  if (!mode) {
    if (str(payload.databaseUrl) || getDatabaseUrl()) mode = 'neon';
    else if (str(payload.gasWebAppUrl || payload.gasUrl)) mode = 'gas';
    else mode = 'sandbox';
  }

  let gasUrl = str(payload.gasWebAppUrl ?? payload.gasUrl ?? '');
  if (gasUrl) {
    if (crmCore && typeof crmCore.validateGasUrl === 'function') {
      const check = crmCore.validateGasUrl(gasUrl);
      if (!check.valid) {
        throw new Error(`VALIDATION_ERROR: ${check.message}`);
      }
      gasUrl = check.normalized;
    }
  } else if (payload.keepExistingGasUrl !== false && mode !== 'sandbox') {
    const existingCfg = opts.executor ? await resolveServerConfig(opts.executor).catch(() => null) : null;
    gasUrl = existingCfg?.gasWebAppUrl || String(process.env.GAS_WEBAPP_URL || FIXED_SERVER_CONFIG.gasWebAppUrl || '').trim();
  }

  if (mode === 'gas' && !gasUrl) {
    throw new Error('VALIDATION_ERROR: يرجى إدخال رابط Google Apps Script Web App (/exec) لتفعيل وضع Google Apps Script.');
  }

  const inputDbUrl = str(payload.databaseUrl);
  if (inputDbUrl && !/^postgres(ql)?:\/\//i.test(inputDbUrl)) {
    throw new Error('VALIDATION_ERROR: رابط قاعدة بيانات Neon غير صالح — يجب أن يبدأ بـ postgresql:// أو postgres://.');
  }
  const existingDbUrl = getDatabaseUrl();
  const nextDbUrl = payload.clearDatabaseUrl === true
    ? ''
    : (inputDbUrl || existingDbUrl);

  if (mode === 'neon' && !nextDbUrl) {
    throw new Error('VALIDATION_ERROR: يرجى إدخال رابط قاعدة بيانات Neon PostgreSQL (DATABASE_URL) لتفعيل وضع قاعدة البيانات السحابية.');
  }

  const existingServerCfg = opts.executor ? await resolveServerConfig(opts.executor).catch(() => null) : null;

  const inputRgToken = str(payload.rgToken ?? payload.token ?? '').replace(/^Bearer\s+/i, '');
  const nextRgToken = payload.clearRgToken === true
    ? ''
    : (inputRgToken || existingServerCfg?.rgToken || String(process.env.RG_TOKEN || FIXED_SERVER_CONFIG.rgToken || '').replace(/^Bearer\s+/i, '').trim());

  const rawInputBaseUrl = str(payload.rgApiBaseUrl);
  const nextBaseUrl = normalizeRgApiBaseUrl(
    rawInputBaseUrl || existingServerCfg?.rgApiBaseUrl || process.env.RG_API_BASE_URL || FIXED_SERVER_CONFIG.rgApiBaseUrl
  );

  const inputSyncSecret = str(payload.syncApiSecret);
  let nextSyncSecret = inputSyncSecret || existingServerCfg?.syncApiSecret || String(process.env.SYNC_API_SECRET || FIXED_SERVER_CONFIG.syncApiSecret || '').trim();

  const actorName = opts.session?.user?.name || str(payload.actorName, 'المدير العام');
  const actorObj = opts.session?.user || { id: 'EMP_ADMIN', name: actorName, role: 'general_manager' };
  const nowIso = new Date().toISOString();

  let activeExecutor: DbExecutor | undefined = opts.executor;
  let databaseConnected = false;

  // Test & bind Neon PostgreSQL when mode === 'neon' (or a new databaseUrl was explicitly provided)
  if ((mode === 'neon' || inputDbUrl) && nextDbUrl) {
    const dbUrlChanged = Boolean(inputDbUrl && inputDbUrl !== existingDbUrl);
    if (!opts.skipLiveDbTest) {
      if (inputDbUrl || !activeExecutor) {
        await testDatabaseConnection(nextDbUrl);
      }
      if (!activeExecutor || dbUrlChanged) {
        await resetPoolForReconfig(nextDbUrl);
        activeExecutor = createPgExecutor();
        await ensureSchemaInitialized(activeExecutor);
        if (opts.ensureSeededFn) {
          await opts.ensureSeededFn(activeExecutor);
        }
      }
    }
    databaseConnected = true;
  }

  if (!nextSyncSecret && activeExecutor) {
    nextSyncSecret = await ensureSyncApiSecret(activeExecutor, actorName);
  } else if (!nextSyncSecret && mode !== 'sandbox') {
    nextSyncSecret = generateSyncSecretIfEmpty('');
  }

  // Save settings inside Neon PostgreSQL (if connected) so all Vercel serverless instances see them immediately
  if (activeExecutor) {
    await upsertServerSetting(activeExecutor, 'connection_mode', mode, actorName);
    await upsertServerSetting(activeExecutor, 'gas_webapp_url', mode === 'sandbox' ? '' : gasUrl, actorName);
    await upsertServerSetting(activeExecutor, 'rg_api_base_url', nextBaseUrl, actorName);
    if (nextRgToken) {
      await upsertServerSetting(activeExecutor, 'rg_token_enc', encryptServerSecret(nextRgToken), actorName);
    }
    if (nextSyncSecret) {
      await upsertServerSetting(activeExecutor, 'sync_api_secret_enc', encryptServerSecret(nextSyncSecret), actorName);
    }
  }

  const explicitOrigin = str(payload.siteOrigin).replace(/\/+$/, '');
  const vercelHost = str(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const rawOrigin = (explicitOrigin && /^https?:\/\//i.test(explicitOrigin)) ? explicitOrigin : (vercelHost ? `https://${vercelHost}` : '');
  const neonSyncUrl = mode === 'neon' && rawOrigin
    ? `${rawOrigin}/api/sync`
    : '';

  let autoBoundGas = false;
  let autoBindNote = '';
  if (gasUrl && mode !== 'sandbox') {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 8000) : null;
    try {
      const resp = await fetchFn(gasUrl, {
        method: 'POST',
        redirect: 'follow',
        signal: ctrl?.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'autoBindFromServer',
          payload: {
            syncSecret: nextSyncSecret,
            neonSyncUrl,
            rgToken: nextRgToken,
            autoEveryMinute: mode === 'neon'
          }
        })
      });
      const text = await resp.text();
      let parsed: any = null;
      const trimmed = String(text || '').trim();
      if (crmCore && typeof crmCore.parseGasResponseText === 'function') {
        parsed = crmCore.parseGasResponseText(trimmed, resp.status);
      } else if (trimmed && !trimmed.startsWith('<')) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = null;
        }
      }
      if (resp.ok && parsed && parsed.success) {
        autoBoundGas = true;
      } else {
        autoBindNote = str(parsed?.message || `HTTP ${resp.status}`);
      }
    } catch (err: any) {
      autoBindNote = str(err?.message || 'NETWORK');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const fixedCfgToWrite = {
    mode,
    databaseUrl: nextDbUrl,
    gasWebAppUrl: mode === 'sandbox' ? '' : gasUrl,
    rgToken: nextRgToken,
    rgApiBaseUrl: nextBaseUrl,
    syncApiSecret: nextSyncSecret,
    updatedAt: nowIso,
    updatedBy: actorName
  };

  let persistResult: PersistCoreFilesResult;
  if (payload.persistCoreFiles !== false) {
    persistResult = persistCoreFilesOnDisk(rootDir, fixedCfgToWrite, { updateInMemory: true });
  } else {
    applyInMemoryServerConfig(fixedCfgToWrite);
    persistResult = {
      writable: isCoreFilesystemWritable(rootDir),
      readOnlyFilesystem: false,
      updatedFiles: [],
      generatedConfigJs: ''
    };
  }

  let vercelSync: VercelEnvSyncResult = {
    attempted: false,
    configured: Boolean(str(payload.vercelToken || process.env.VERCEL_TOKEN) && str(payload.vercelProjectId || process.env.VERCEL_PROJECT_ID)),
    synced: false,
    syncedKeys: [],
    redeployTriggered: false,
    projectId: str(payload.vercelProjectId || process.env.VERCEL_PROJECT_ID),
    error: null
  };

  if (payload.syncToVercel !== false) {
    vercelSync = await syncEnvVarsToVercel(
      {
        mode,
        gasWebAppUrl: mode === 'sandbox' ? '' : gasUrl,
        databaseUrl: nextDbUrl,
        rgToken: nextRgToken,
        rgApiBaseUrl: nextBaseUrl,
        syncApiSecret: nextSyncSecret,
        vercelToken: str(payload.vercelToken),
        vercelProjectId: str(payload.vercelProjectId),
        vercelTeamId: str(payload.vercelTeamId),
        vercelDeployHookUrl: str(payload.vercelDeployHookUrl),
        triggerDeploy: payload.vercelTriggerDeploy !== false,
        includeDatabaseUrl: mode === 'neon'
      },
      fetchFn
    );
  }

  if (activeExecutor && opts.logActivityFn) {
    await opts.logActivityFn(
      activeExecutor,
      actorObj,
      'تحديث الوضع والربط الشامل',
      'Settings',
      'unified_setup',
      `الوضع: ${mode} | قاعدة البيانات: ${databaseConnected ? 'متصلة' : 'غير مستخدمة'} | الكود الأساسي: ${persistResult.updatedFiles.length ? persistResult.updatedFiles.join(', ') : 'قاعدة البيانات فقط'}${vercelSync.synced ? ` | Vercel: ${vercelSync.syncedKeys.join(', ')}` : ''}`
    ).catch(() => undefined);
  }

  const isServerlessEnv = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const hadDbBeforeCall = opts.wasDatabaseConfiguredBeforeRequest ?? isDatabaseConfigured();
  const vercelSyncedGas = vercelSync.synced && vercelSync.syncedKeys.includes('GAS_WEBAPP_URL');
  const vercelSyncedDb = vercelSync.synced && vercelSync.syncedKeys.includes('DATABASE_URL');
  const needsNeonEnv = Boolean(mode === 'neon' && isServerlessEnv && !hadDbBeforeCall && !vercelSyncedDb);
  const needsGasEnv = Boolean(
    mode === 'gas' &&
    isServerlessEnv &&
    !vercelSyncedGas &&
    (hadEnvGasUrlBefore !== gasUrl || hadEnvModeBefore !== 'gas')
  );
  const needsVercelEnvVar = Boolean(needsNeonEnv || needsGasEnv);

  const vercelEnvChecklist: VercelEnvChecklistItem[] = isServerlessEnv || vercelSync.configured || mode === 'gas'
    ? buildVercelEnvChecklist({
        mode,
        gasWebAppUrl: mode === 'sandbox' ? '' : gasUrl,
        databaseUrl: mode === 'neon' ? nextDbUrl : '',
        rgToken: nextRgToken,
        syncApiSecret: nextSyncSecret
      })
    : [];

  const summaryParts: string[] = [];
  if (mode === 'neon') {
    summaryParts.push('تم الربط بقاعدة البيانات السحابية Neon PostgreSQL');
  } else if (mode === 'gas') {
    summaryParts.push('تم التبديل إلى وضع Google Apps Script & Google Sheets عبر Vercel');
  } else {
    summaryParts.push('تم التبديل إلى وضع المعاينة المحلية (Sandbox)');
  }
  if (vercelSync.synced) {
    summaryParts.push(`وتم تحديث متغيرات بيئة Vercel تلقائيًا (${vercelSync.syncedKeys.join('، ')})${vercelSync.redeployTriggered ? ' وتشغيل إعادة النشر' : ''}`);
  } else if (persistResult.updatedFiles.length > 0) {
    summaryParts.push(`وتثبيت الإعدادات في الكود الأساسي (${persistResult.updatedFiles.join('، ')})`);
  } else if (persistResult.readOnlyFilesystem) {
    if (needsNeonEnv) {
      summaryParts.push('(تم الاتصال مؤقتًا على Vercel — لتثبيت الرابط دائمًا أضف DATABASE_URL في Vercel Environment Variables ثم أعد النشر)');
    } else if (needsGasEnv) {
      summaryParts.push('(لتثبيت رابط Apps Script لجميع المستخدمين على Vercel أضف GAS_WEBAPP_URL وCONNECTION_MODE=gas في Vercel Environment Variables)');
    } else if (activeExecutor) {
      summaryParts.push('(الاستضافة السحابية للقراءة فقط — تم الحفظ عالميًا في Neon لجميع المستخدمين)');
    }
  }
  if (vercelSync.attempted && vercelSync.error) {
    summaryParts.push(`(ملاحظة Vercel: ${vercelSync.error})`);
  }
  if (autoBoundGas) {
    summaryParts.push('وربط Google Apps Script تلقائيًا');
  } else if (gasUrl && mode !== 'sandbox' && autoBindNote) {
    summaryParts.push(`(ملاحظة Apps Script: ${autoBindNote})`);
  }

  return {
    saved: true,
    mode,
    databaseConnected,
    hasDatabaseUrl: Boolean(nextDbUrl),
    maskedDatabaseUrl: maskDatabaseUrl(nextDbUrl),
    gasWebAppUrl: mode === 'sandbox' ? '' : gasUrl,
    rgApiBaseUrl: nextBaseUrl,
    neonSyncUrl,
    hasRgToken: Boolean(nextRgToken),
    hasDirectToken: Boolean(nextRgToken),
    hasSyncSecret: Boolean(nextSyncSecret),
    autoBoundGas,
    coreFilesUpdated: persistResult.updatedFiles.length > 0,
    updatedFiles: persistResult.updatedFiles,
    readOnlyFilesystem: persistResult.readOnlyFilesystem,
    needsVercelEnvVar,
    vercelSync,
    vercelEnvChecklist,
    generatedConfigJs: persistResult.generatedConfigJs,
    message: summaryParts.join(' ')
  };
}
