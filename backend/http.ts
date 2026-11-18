export function applyApiCorsHeaders(req: any, res: any): void {
  const origin = String(req?.headers?.origin || '').trim();
  if (typeof res?.setHeader !== 'function') return;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  if (origin) {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Sync-Secret, Last-Event-ID');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function parseRequestBody(rawBody: any): Record<string, any> {
  if (!rawBody) return {};
  if (Buffer.isBuffer(rawBody)) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawBody === 'object' ? rawBody : {};
}

export function safeJsonParse<T = any>(rawText: string): T | null {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
