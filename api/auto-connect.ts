import {
  authorizeAutoConnect,
  executeAutoConnect,
  getAutoConnectStatus,
  type AutoConnectInput
} from '../backend/autoConnect';
import { applyApiCorsHeaders, parseRequestBody } from '../backend/http';

function extractBearerToken(req: any, body: Record<string, any>): string {
  const authHeader = String(req?.headers?.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return String(body.token || bearerToken || req?.query?.token || '').trim();
}

export default async function handler(req: any, res: any, rootDirOverride?: string) {
  applyApiCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const rootDir = rootDirOverride || process.cwd();
  const body = parseRequestBody(req.body);
  const rawToken = extractBearerToken(req, body);

  if (req.method === 'GET') {
    const authCheck = await authorizeAutoConnect(rawToken, false);
    if (!authCheck.authorized) {
      res.status(authCheck.statusCode || 401).json({
        success: false,
        message: authCheck.error || 'UNAUTHORIZED',
        data: null,
        error: authCheck.error || 'UNAUTHORIZED'
      });
      return;
    }

    const status = await getAutoConnectStatus(rootDir, { checkDbHealth: true });
    res.status(200).json({
      success: true,
      message: '',
      data: status,
      error: null
    });
    return;
  }

  if (req.method === 'POST') {
    const authCheck = await authorizeAutoConnect(rawToken, true);
    if (!authCheck.authorized) {
      res.status(authCheck.statusCode || 401).json({
        success: false,
        message: authCheck.error || 'UNAUTHORIZED',
        data: null,
        error: authCheck.error || 'UNAUTHORIZED'
      });
      return;
    }

    const input: AutoConnectInput = (body.payload && typeof body.payload === 'object' ? body.payload : body) as AutoConnectInput;
    if (authCheck.mode === 'initial_unconfigured' && input.initialSetup !== true) {
      res.status(403).json({
        success: false,
        message: 'FORBIDDEN: يلزم تأكيد التهيئة الأولية (initialSetup) للربط لأول مرة.',
        data: null,
        error: 'FORBIDDEN'
      });
      return;
    }

    try {
      const result = await executeAutoConnect(rootDir, input);
      res.status(200).json({
        success: true,
        message: 'تم تنفيذ الربط التلقائي وتحديث ملفات الإعداد والاتصال بنجاح.',
        data: result,
        error: null
      });
    } catch (err: any) {
      const msg = String(err?.message || 'حدث خطأ أثناء تنفيذ الربط التلقائي.');
      const isValidation = msg.startsWith('VALIDATION_ERROR');
      res.status(isValidation ? 400 : 500).json({
        success: false,
        message: msg,
        data: null,
        error: isValidation ? 'VALIDATION_ERROR' : 'AUTO_CONNECT_FAILED'
      });
    }
    return;
  }

  res.status(405).json({
    success: false,
    message: 'Method not allowed.',
    data: null,
    error: 'METHOD_NOT_ALLOWED'
  });
}
