import type { DbClient } from './db.js';
import {
  buildRentalGateEndpointUrl,
  DEFAULT_RG_API_BASE_URL,
  normalizeRgApiBaseUrl
} from './coreBinding.js';
import {
  getRgTokenDiagnostics,
  normalizeBearerToken,
  resolveServerConfig,
  type RgTokenDiagnostics
} from './serverConfig.js';

export interface RgTokenValidationResult {
  valid: boolean;
  token: string;
  reasonCode: '' | 'EMPTY' | 'INVALID_CHARS' | 'MALFORMED_JWT' | 'TOO_SHORT';
  message: string;
  looksLikeJwt: boolean;
  hadBearerPrefix: boolean;
  hadQuotesOrWhitespace: boolean;
}

export function normalizeRgToken(raw: unknown): string {
  return normalizeBearerToken(raw);
}

export function validateRgToken(raw: unknown): RgTokenValidationResult {
  const rawStr = String(raw ?? '');
  const hadBearerPrefix = /^(?:\s*["']*\s*Bearer\s+)/i.test(rawStr);
  const hadQuotesOrWhitespace = /[\r\n\t]/.test(rawStr) || rawStr !== rawStr.trim() || /^["']|["']$/.test(rawStr.trim());
  const clean = normalizeRgToken(rawStr);

  if (!clean) {
    return {
      valid: false,
      token: '',
      reasonCode: 'EMPTY',
      message: 'NO_RG_TOKEN: توكن Rental Gate غير مضبوط أو فارغ.',
      looksLikeJwt: false,
      hadBearerPrefix,
      hadQuotesOrWhitespace
    };
  }

  // Reject any internal whitespace or control characters left after normalization
  if (/[\s\u0000-\u001f\u007f]/.test(clean)) {
    return {
      valid: false,
      token: '',
      reasonCode: 'INVALID_CHARS',
      message: 'RG_TOKEN_MALFORMED: يحتوي توكن Rental Gate على مسافات أو أحرف تحكم غير صالحة.',
      looksLikeJwt: false,
      hadBearerPrefix,
      hadQuotesOrWhitespace: true
    };
  }

  const dotParts = clean.split('.');
  const looksLikeJwt = dotParts.length === 3 || clean.startsWith('eyJ');
  if (looksLikeJwt) {
    if (dotParts.length !== 3 || dotParts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p) || p.length < 4)) {
      return {
        valid: false,
        token: '',
        reasonCode: 'MALFORMED_JWT',
        message: 'RG_TOKEN_MALFORMED: صيغة JWT لتوكن Rental Gate غير مكتملة أو تالفة (تأكد من نسخه كاملاً بدون اقتطاع).',
        looksLikeJwt: true,
        hadBearerPrefix,
        hadQuotesOrWhitespace
      };
    }
  } else if (clean.length < 12) {
    return {
      valid: false,
      token: '',
      reasonCode: 'TOO_SHORT',
      message: 'RG_TOKEN_MALFORMED: طول توكن Rental Gate قصير جداً وغير صالح.',
      looksLikeJwt: false,
      hadBearerPrefix,
      hadQuotesOrWhitespace
    };
  }

  return {
    valid: true,
    token: clean,
    reasonCode: '',
    message: '',
    looksLikeJwt,
    hadBearerPrefix,
    hadQuotesOrWhitespace
  };
}

export function buildRgAuthHeaders(rawToken: unknown, extra: Record<string, string> = {}): Record<string, string> {
  const check = validateRgToken(rawToken);
  if (!check.valid) {
    throw new Error(check.message);
  }
  return {
    Authorization: `Bearer ${check.token}`,
    Accept: 'application/json',
    lang: 'ar',
    ...extra
  };
}

export function resolveSafeRgEndpointUrl(
  baseApi: unknown,
  endpoint: string,
  query?: Record<string, string | number | boolean | undefined | null>
): string {
  const normalizedBase = normalizeRgApiBaseUrl(baseApi || DEFAULT_RG_API_BASE_URL);
  return buildRentalGateEndpointUrl(normalizedBase, endpoint, query);
}

export function buildRgHttpError(status: number, bodySnippet = '', endpoint = ''): Error {
  const cleanSnippet = String(bodySnippet || '').trim().slice(0, 160);
  const epTag = endpoint ? ` [${endpoint}]` : '';
  const suffix = cleanSnippet ? ` — ${cleanSnippet}` : '';
  let err: Error;
  if (status === 401) {
    const isMalformed = /malformed|invalid token|jwt/i.test(cleanSnippet);
    err = new Error(
      isMalformed
        ? `RG_API_HTTP_401${epTag}: Token is malformed — تحقق من قيمة RG_TOKEN في متغيرات البيئة (بدون مسافات أو اقتباس أو تكرار Bearer)${suffix}`
        : `RG_API_UNAUTHORIZED_401${epTag}: توكن Rental Gate غير مصرح به أو منتهي الصلاحية (401)${suffix}`
    );
  } else if (status === 403) {
    err = new Error(`RG_API_FORBIDDEN_403${epTag}: توكن Rental Gate مرفوض الصلاحية (403)${suffix}`);
  } else {
    err = new Error(`RG_API_HTTP_${status}${epTag}${cleanSnippet ? `: ${cleanSnippet}` : ''}`);
  }
  (err as any).httpStatus = status;
  (err as any).permanent = status === 401 || status === 403 || status === 400 || status === 404 || status === 422;
  (err as any).noRetry = (err as any).permanent;
  (err as any).isAuthError = status === 401 || status === 403;
  return err;
}

export interface RgFetchRetryOptions {
  fetchFn?: typeof fetch;
  headers: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  endpointLabel?: string;
}

const isRetryableRgStatus = (status: number) =>
  status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

export async function rgFetchWithRetry(
  targetUrl: string,
  opts: RgFetchRetryOptions
): Promise<Response> {
  const fetchFn = opts.fetchFn || fetch;
  const maxRetries = Math.max(1, Math.min(4, Number(opts.maxRetries ?? 3) || 3));
  const retryBaseDelayMs = Math.max(0, Math.min(2000, Number(opts.retryBaseDelayMs ?? 150)));
  const timeoutMs = Math.max(3000, Math.min(60000, Number(opts.timeoutMs ?? 25000) || 25000));

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs) : null;
    try {
      const resp = await fetchFn(targetUrl, {
        method: 'GET',
        signal: ctrl?.signal,
        headers: opts.headers
      });
      if (timer) clearTimeout(timer);
      if (resp.ok || !isRetryableRgStatus(resp.status) || attempt === maxRetries) {
        return resp;
      }
      if (retryBaseDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryBaseDelayMs * attempt));
      }
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      if (err?.noRetry || err?.permanent || attempt >= maxRetries) {
        throw err;
      }
      if (retryBaseDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryBaseDelayMs * attempt));
      }
    }
  }
  throw lastErr || new Error(`RG_API_NETWORK_ERROR${opts.endpointLabel ? ` (${opts.endpointLabel})` : ''}`);
}

export interface RgEndpointProbeResult {
  endpoint: string;
  url: string;
  ok: boolean;
  statusCode: number;
  authOk: boolean;
  message: string;
  sampleCount?: number;
  totalElements?: number;
}

export interface RgConnectionTestResult {
  connected: boolean;
  authValid: boolean;
  statusCode: number;
  hasToken: boolean;
  baseUrl: string;
  tokenDiagnostics: RgTokenDiagnostics & { looksLikeJwt: boolean; reasonCode: string };
  endpoints: RgEndpointProbeResult[];
  sampleCount: number;
  totalElements: number;
  message: string;
}

function summarizePayloadCounts(parsed: any): { sampleCount: number; totalElements: number; apiRejected: boolean; rejectMessage: string } {
  if (!parsed || typeof parsed !== 'object') {
    return { sampleCount: 0, totalElements: 0, apiRejected: false, rejectMessage: '' };
  }
  if (Array.isArray(parsed)) {
    return { sampleCount: parsed.length, totalElements: parsed.length, apiRejected: false, rejectMessage: '' };
  }
  const container = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  const rows =
    (Array.isArray(parsed.content) ? parsed.content : null) ||
    (Array.isArray(parsed.items) ? parsed.items : null) ||
    (Array.isArray(parsed.data) ? parsed.data : null) ||
    (Array.isArray(container.content) ? container.content : null) ||
    (Array.isArray(container.items) ? container.items : null) ||
    (Array.isArray(container.rows) ? container.rows : null) ||
    [];
  const totalRaw = container.totalElements ?? container.totalItems ?? container.total ?? parsed.totalElements ?? parsed.totalItems ?? parsed.total;
  const totalElements = totalRaw !== undefined && totalRaw !== null && !isNaN(Number(totalRaw)) ? Number(totalRaw) : rows.length;
  const apiRejected = parsed.success === false && !parsed.data && !parsed.content && !parsed.items;
  return {
    sampleCount: rows.length,
    totalElements,
    apiRejected,
    rejectMessage: apiRejected ? String(parsed.message || parsed.error || 'RG_API_REJECTED') : ''
  };
}

export async function testRgApiConnectionSafe(
  executor: DbClient,
  opts: { fetchFn?: typeof fetch; checkAllEndpoints?: boolean } = {}
): Promise<RgConnectionTestResult> {
  const fetchFn = opts.fetchFn || fetch;
  const serverCfg = await resolveServerConfig(executor);
  const baseUrl = normalizeRgApiBaseUrl(serverCfg.rgApiBaseUrl);
  const diag = await getRgTokenDiagnostics(executor).catch(() => ({
    configured: false,
    source: 'none' as const,
    length: 0,
    hasQuotes: false,
    hasWhitespace: false,
    hasBearerPrefix: false
  }));
  const tokenCheck = validateRgToken(serverCfg.rgToken);
  const gasUrl = String(serverCfg.gasWebAppUrl || '').trim();

  if (!tokenCheck.valid) {
    return {
      connected: Boolean(gasUrl) && tokenCheck.reasonCode === 'EMPTY',
      authValid: false,
      statusCode: 0,
      hasToken: Boolean(serverCfg.rgToken),
      baseUrl,
      tokenDiagnostics: {
        ...diag,
        looksLikeJwt: tokenCheck.looksLikeJwt,
        reasonCode: tokenCheck.reasonCode
      },
      endpoints: [],
      sampleCount: 0,
      totalElements: 0,
      message:
        tokenCheck.reasonCode === 'EMPTY'
          ? gasUrl
            ? 'الربط يعمل عبر Google Apps Script المضبوط على الخادم (متغير RG_TOKEN غير مضبوط محلياً).'
            : 'متغير RG_TOKEN غير مضبوط في إعدادات بيئة الخادم (.env / Vercel).'
          : tokenCheck.message
    };
  }

  const headers = buildRgAuthHeaders(tokenCheck.token);
  const targetEndpoints = opts.checkAllEndpoints !== false
    ? ['reservations/filter', 'reservation-company-changes/admin/filter', 'admin/cancelled-reservations']
    : ['reservations/filter'];

  const endpoints: RgEndpointProbeResult[] = [];
  for (const ep of targetEndpoints) {
    const url = resolveSafeRgEndpointUrl(baseUrl, ep, { page: 0, size: 1 });
    try {
      const resp = await rgFetchWithRetry(url, {
        fetchFn,
        headers,
        maxRetries: 2,
        timeoutMs: 12000,
        endpointLabel: ep
      });
      const rawText = await resp.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }
      const stats = summarizePayloadCounts(parsed);
      const authOk = resp.status !== 401 && resp.status !== 403;
      const ok = resp.ok && !stats.apiRejected && parsed !== null;
      const msg = ok
        ? `OK (HTTP ${resp.status}, total=${stats.totalElements})`
        : (!authOk
            ? buildRgHttpError(resp.status, rawText.slice(0, 140), ep).message
            : (stats.rejectMessage || `HTTP ${resp.status}${rawText ? `: ${rawText.slice(0, 120)}` : ''}`));
      endpoints.push({
        endpoint: ep,
        url,
        ok,
        statusCode: resp.status,
        authOk,
        message: msg,
        sampleCount: stats.sampleCount,
        totalElements: stats.totalElements
      });
      // Stop early on hard auth failure so we don't spam invalid auth attempts
      if (!authOk) {
        break;
      }
    } catch (err: any) {
      endpoints.push({
        endpoint: ep,
        url,
        ok: false,
        statusCode: Number(err?.httpStatus || 0),
        authOk: Number(err?.httpStatus || 0) !== 401 && Number(err?.httpStatus || 0) !== 403,
        message: String(err?.message || 'RG_CONNECTION_FAILED').slice(0, 200)
      });
    }
  }

  const primary = endpoints[0];
  const allOk = endpoints.length > 0 && endpoints.every((e) => e.ok);
  const authValid = endpoints.length > 0 && endpoints.every((e) => e.authOk);
  const failedList = endpoints.filter((e) => !e.ok);

  return {
    connected: Boolean(primary?.ok) && allOk,
    authValid,
    statusCode: primary?.statusCode || 0,
    hasToken: true,
    baseUrl,
    tokenDiagnostics: {
      ...diag,
      looksLikeJwt: tokenCheck.looksLikeJwt,
      reasonCode: allOk ? '' : (authValid ? 'ENDPOINT_ERROR' : 'AUTH_REJECTED')
    },
    endpoints,
    sampleCount: primary?.sampleCount || 0,
    totalElements: primary?.totalElements || 0,
    message: allOk
      ? `المصادقة مع Rental Gate API ناجحة عبر ${endpoints.length} نقاط اتصال (${primary?.totalElements ? `إجمالي الحجوزات: ${primary.totalElements}` : `عينة: ${primary?.sampleCount || 0}`}).`
      : (failedList[0]?.message || `فشل فحص الاتصال بـ Rental Gate API (HTTP ${primary?.statusCode || 0})`)
  };
}
