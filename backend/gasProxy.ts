export interface GasValidationResult {
  valid: boolean;
  normalized: string;
  message?: string;
}

export interface GasProxyResponse {
  success: boolean;
  message: string;
  data: any;
  error: string | null;
}

export function normalizeAndValidateGasTarget(rawUrl: unknown): GasValidationResult {
  let clean = String(rawUrl || '').trim();
  if (!clean) {
    return { valid: false, normalized: '', message: 'يرجى إدخال رابط Web App (/exec) أولاً.' };
  }
  clean = clean
    .replace(/^http:\/\//i, 'https://')
    .replace(/(\/macros)\/u\/\d+(\/s\/)/i, '$1$2')
    .replace(/([?&])authuser=\d+&?/i, '$1')
    .replace(/[?&]$/, '');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(clean);
  } catch {
    return { valid: false, normalized: clean, message: 'صيغة رابط Google Apps Script غير صالحة.' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return { valid: false, normalized: clean, message: 'يجب أن يبدأ رابط Google Apps Script بـ https://' };
  }
  const host = parsedUrl.hostname.toLowerCase();
  if (host !== 'script.google.com' && host !== 'script.googleusercontent.com') {
    return {
      valid: false,
      normalized: clean,
      message: 'يُسمح فقط بروابط script.google.com أو script.googleusercontent.com.'
    };
  }
  if (/\/dev(\?.*)?$/i.test(parsedUrl.pathname)) {
    return {
      valid: false,
      normalized: clean,
      message: 'رابط /dev مخصص للمحرر فقط. استخدم رابط النشر المنتهي بـ /exec.'
    };
  }
  if (!/\/exec(?:\/|$)/i.test(parsedUrl.pathname)) {
    return {
      valid: false,
      normalized: clean,
      message: 'تأكد من نسخ رابط Web App الكامل المنتهي بـ /exec.'
    };
  }
  return { valid: true, normalized: parsedUrl.toString() };
}

export function isAllowedGasRedirectHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'script.google.com' || h === 'script.googleusercontent.com' || h.endsWith('.googleusercontent.com');
}

export async function fetchGasServerSide(
  gasUrlRaw: string,
  actionName: string,
  token: string,
  payloadObj: Record<string, any>,
  fetchImpl: typeof fetch = fetch
): Promise<GasProxyResponse> {
  const check = normalizeAndValidateGasTarget(gasUrlRaw);
  if (!check.valid) {
    return { success: false, message: check.message || 'رابط غير صالح.', data: null, error: 'INVALID_GAS_URL' };
  }

  const bodyStr = JSON.stringify({
    action: String(actionName || 'ping'),
    token: String(token || ''),
    payload: payloadObj || {}
  });

  const runHopChain = async (method: 'POST' | 'GET', initialUrl: string): Promise<GasProxyResponse> => {
    let currentUrl = initialUrl;
    let currentMethod: 'POST' | 'GET' = method;
    let currentBody: string | undefined = method === 'POST' ? bodyStr : undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      try {
        ctrl.abort();
      } catch {}
    }, actionName === 'ping' ? 18000 : 35000);

    try {
      for (let hop = 0; hop < 6; hop++) {
        const resp = await fetchImpl(currentUrl, {
          method: currentMethod,
          redirect: 'manual',
          headers:
            currentMethod === 'POST'
              ? { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json, text/plain, */*' }
              : { Accept: 'application/json, text/plain, */*' },
          body: currentBody,
          signal: ctrl.signal
        });

        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location') || '';
          if (!loc) break;
          const nextUrl = new URL(loc, currentUrl);
          if (nextUrl.hostname.toLowerCase().includes('accounts.google.com')) {
            return {
              success: false,
              message:
                'الرابط يتطلب تسجيل دخول Google لأن صلاحية النشر ليست (Anyone). من محرر Apps Script: Deploy -> Manage deployments -> Edit -> غيّر Who has access إلى (Anyone) ثم Deploy.',
              data: null,
              error: 'GAS_AUTH_REQUIRED'
            };
          }
          if (!isAllowedGasRedirectHost(nextUrl.hostname)) {
            return {
              success: false,
              message: `أعاد الخادم إعادة توجيه غير متوقعة إلى (${nextUrl.hostname}). تأكد من نشر Web App بصلاحية Anyone.`,
              data: null,
              error: 'GAS_UNEXPECTED_REDIRECT'
            };
          }
          currentUrl = nextUrl.toString();
          if (resp.status === 301 || resp.status === 302 || resp.status === 303) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          continue;
        }

        const text = await resp.text();
        const trimmed = String(text || '').trim();
        if (resp.status === 404) {
          return {
            success: false,
            message: 'رابط Web App غير موجود (HTTP 404). تأكد من نسخ الرابط الصحيح المنتهي بـ /exec من Manage deployments.',
            data: null,
            error: 'GAS_NOT_FOUND'
          };
        }
        if (resp.status === 401 || resp.status === 403) {
          return {
            success: false,
            message: `تم رفض الوصول للرابط (HTTP ${resp.status}). تأكد من ضبط Execute as: Me و Who has access: Anyone.`,
            data: null,
            error: 'GAS_FORBIDDEN'
          };
        }
        if (trimmed.startsWith('<') || /^<!doctype/i.test(trimmed)) {
          if (/accounts\.google\.com|ServiceLogin/i.test(trimmed)) {
            return {
              success: false,
              message: 'الرابط محمي بحساب Google (Who has access لم يُضبط على Anyone). عدّل النشر إلى Anyone وأعد المحاولة.',
              data: null,
              error: 'GAS_AUTH_REQUIRED'
            };
          }
          const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
          const snippet = titleMatch ? ` (${titleMatch[1].trim()})` : '';
          return {
            success: false,
            message: `أعاد Google Apps Script صفحة HTML بدلاً من JSON${snippet}. تأكد من عدم وجود خطأ برمجي في السكربت ومن ضبط Execute as: Me و Who has access: Anyone.`,
            data: null,
            error: 'HTML_RESPONSE'
          };
        }
        if (!trimmed) {
          return {
            success: false,
            message: `استجابة فارغة من Google Apps Script (HTTP ${resp.status}).`,
            data: null,
            error: 'EMPTY_RESPONSE'
          };
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            return {
              success: Boolean(parsed.success),
              message: String(parsed.message || (parsed.success ? 'تم الاتصال بنجاح.' : 'فشل الطلب.')),
              data: parsed.data !== undefined ? parsed.data : null,
              error: parsed.error || null
            };
          }
        } catch {}
        return {
          success: false,
          message: `استجابة غير مفهومة من Google Apps Script (HTTP ${resp.status}).`,
          data: null,
          error: 'INVALID_JSON'
        };
      }
      return {
        success: false,
        message: 'تجاوز رابط Google Apps Script الحد الأقصى لإعادة التوجيه.',
        data: null,
        error: 'TOO_MANY_REDIRECTS'
      };
    } catch (err: any) {
      const isAbort = err && (err.name === 'AbortError' || String(err.message || '').includes('abort'));
      const causeDetail = err?.cause ? ` (${String(err.cause.code || err.cause.message || err.cause)})` : '';
      return {
        success: false,
        message: isAbort
          ? 'انتهت مهلة الاتصال بـ Google Apps Script. حاول مرة أخرى.'
          : `تعذر الوصول إلى Google Apps Script من الخادم: ${String(err?.message || err)}${causeDetail}`,
        data: null,
        error: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR'
      };
    } finally {
      clearTimeout(timer);
    }
  };

  let result = await runHopChain('POST', check.normalized);
  if (actionName === 'ping' && !result.success && result.error !== 'GAS_AUTH_REQUIRED' && result.error !== 'GAS_NOT_FOUND') {
    const sep = check.normalized.includes('?') ? '&' : '?';
    const getResult = await runHopChain('GET', `${check.normalized}${sep}action=ping`);
    if (getResult.success || getResult.error === 'GAS_AUTH_REQUIRED' || getResult.error === 'GAS_NOT_FOUND') {
      result = getResult;
    }
  }
  if (result.success) {
    const baseData =
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data
        : { value: result.data };
    result = {
      ...result,
      data: { ...baseData, viaServerProxy: true }
    };
  }
  return result;
}
