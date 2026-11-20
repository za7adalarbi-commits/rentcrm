export interface VercelEnvSyncInput {
  mode: '' | 'neon' | 'gas' | 'sandbox';
  gasWebAppUrl?: string;
  databaseUrl?: string;
  rgToken?: string;
  rgApiBaseUrl?: string;
  syncApiSecret?: string;
  vercelToken?: string;
  vercelProjectId?: string;
  vercelTeamId?: string;
  vercelDeployHookUrl?: string;
  triggerDeploy?: boolean;
  includeDatabaseUrl?: boolean;
}

export interface VercelEnvSyncResult {
  attempted: boolean;
  configured: boolean;
  synced: boolean;
  syncedKeys: string[];
  redeployTriggered: boolean;
  projectId: string;
  error: string | null;
}

export interface VercelEnvChecklistItem {
  key: string;
  value: string;
  maskedValue: string;
  sensitive: boolean;
  note: string;
}

function cleanStr(val: unknown): string {
  return String(val ?? '').trim();
}

export function buildVercelEnvChecklist(opts: {
  mode: '' | 'neon' | 'gas' | 'sandbox';
  gasWebAppUrl?: string;
  databaseUrl?: string;
  rgToken?: string;
  syncApiSecret?: string;
}): VercelEnvChecklistItem[] {
  const items: VercelEnvChecklistItem[] = [];
  if (opts.mode) {
    items.push({
      key: 'CONNECTION_MODE',
      value: opts.mode,
      maskedValue: opts.mode,
      sensitive: false,
      note: 'يحدد وضع التشغيل الافتراضي عند إقلاع خادم Vercel.'
    });
  }
  const gasUrl = cleanStr(opts.gasWebAppUrl);
  if (opts.mode !== 'sandbox' && gasUrl) {
    items.push({
      key: 'GAS_WEBAPP_URL',
      value: gasUrl,
      maskedValue: gasUrl,
      sensitive: false,
      note: 'رابط Google Apps Script (/exec) لتمريره عبر وسيط Vercel (/api/crm).'
    });
  }
  const dbUrl = cleanStr(opts.databaseUrl);
  if (opts.mode === 'neon' && dbUrl) {
    items.push({
      key: 'DATABASE_URL',
      value: dbUrl,
      maskedValue: 'postgresql://*** (استخدم الرابط الذي أدخلته)',
      sensitive: true,
      note: 'مطلوب فقط في وضع Neon PostgreSQL.'
    });
  }
  const rgTok = cleanStr(opts.rgToken);
  if (rgTok) {
    items.push({
      key: 'RG_TOKEN',
      value: '',
      maskedValue: 'RG_TOKEN (اختياري — يُحفظ مشفرًا داخل Neon في وضع Neon)',
      sensitive: true,
      note: 'اختياري على Vercel إذا كان Apps Script أو Neon يحفظ التوكن بالفعل.'
    });
  }
  const syncSec = cleanStr(opts.syncApiSecret);
  if (syncSec) {
    items.push({
      key: 'SYNC_API_SECRET',
      value: '',
      maskedValue: 'SYNC_API_SECRET (اختياري في متغيرات Vercel)',
      sensitive: true,
      note: 'يؤمّن المزامنة بين Google Apps Script و/api/sync.'
    });
  }
  return items;
}

export function isValidVercelDeployHookUrl(rawUrl: string): boolean {
  const clean = cleanStr(rawUrl);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    return parsed.protocol === 'https:' && (parsed.hostname === 'api.vercel.com' || parsed.hostname.endsWith('.vercel.com'));
  } catch {
    return false;
  }
}

export async function syncEnvVarsToVercel(
  input: VercelEnvSyncInput,
  fetchFn: typeof fetch = fetch
): Promise<VercelEnvSyncResult> {
  const vercelToken = cleanStr(input.vercelToken || process.env.VERCEL_TOKEN);
  const projectId = cleanStr(input.vercelProjectId || process.env.VERCEL_PROJECT_ID);
  const teamId = cleanStr(input.vercelTeamId || process.env.VERCEL_TEAM_ID);
  const deployHookUrl = cleanStr(input.vercelDeployHookUrl || process.env.VERCEL_DEPLOY_HOOK_URL);

  if (!vercelToken || !projectId) {
    return {
      attempted: false,
      configured: false,
      synced: false,
      syncedKeys: [],
      redeployTriggered: false,
      projectId,
      error: null
    };
  }

  const entries: Array<{ key: string; value: string; type: 'plain' | 'encrypted' }> = [];
  if (input.mode) {
    entries.push({ key: 'CONNECTION_MODE', value: input.mode, type: 'plain' });
  }
  const gasUrl = cleanStr(input.gasWebAppUrl);
  if (input.mode !== 'sandbox' && gasUrl) {
    entries.push({ key: 'GAS_WEBAPP_URL', value: gasUrl, type: 'plain' });
  }
  const baseUrl = cleanStr(input.rgApiBaseUrl).replace(/\/+$/, '');
  if (baseUrl) {
    entries.push({ key: 'RG_API_BASE_URL', value: baseUrl, type: 'plain' });
  }
  const dbUrl = cleanStr(input.databaseUrl);
  if (dbUrl && (input.includeDatabaseUrl !== false || input.mode === 'neon')) {
    entries.push({ key: 'DATABASE_URL', value: dbUrl, type: 'encrypted' });
  }
  const rgToken = cleanStr(input.rgToken).replace(/^Bearer\s+/i, '');
  if (rgToken) {
    entries.push({ key: 'RG_TOKEN', value: rgToken, type: 'encrypted' });
  }
  const syncSecret = cleanStr(input.syncApiSecret);
  if (syncSecret) {
    entries.push({ key: 'SYNC_API_SECRET', value: syncSecret, type: 'encrypted' });
  }

  if (entries.length === 0) {
    return {
      attempted: false,
      configured: true,
      synced: false,
      syncedKeys: [],
      redeployTriggered: false,
      projectId,
      error: null
    };
  }

  const baseEndpoint = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true${
    teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
  }`;
  const syncedKeys: string[] = [];

  try {
    for (const item of entries) {
      const resp = await fetchFn(baseEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: item.key,
          value: item.value,
          type: item.type,
          target: ['production', 'preview', 'development']
        })
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        let detail = `HTTP ${resp.status}`;
        try {
          const parsed = errBody ? JSON.parse(errBody) : null;
          if (parsed?.error?.message) detail = String(parsed.error.message);
        } catch {}
        return {
          attempted: true,
          configured: true,
          synced: false,
          syncedKeys,
          redeployTriggered: false,
          projectId,
          error: `تعذر تحديث متغير (${item.key}) في Vercel: ${detail}`
        };
      }
      syncedKeys.push(item.key);
    }

    let redeployTriggered = false;
    if (input.triggerDeploy !== false && deployHookUrl && isValidVercelDeployHookUrl(deployHookUrl)) {
      const hookResp = await fetchFn(deployHookUrl, { method: 'POST' }).catch(() => null);
      redeployTriggered = Boolean(hookResp && hookResp.ok);
    }

    return {
      attempted: true,
      configured: true,
      synced: syncedKeys.length > 0,
      syncedKeys,
      redeployTriggered,
      projectId,
      error: null
    };
  } catch (err: any) {
    return {
      attempted: true,
      configured: true,
      synced: false,
      syncedKeys,
      redeployTriggered: false,
      projectId,
      error: `تعذر الاتصال بـ Vercel API: ${String(err?.message || err)}`
    };
  }
}
