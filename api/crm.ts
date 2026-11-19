import { createPgExecutor, isDatabaseConfigured } from '../backend/db';
import { ensureSeededDatabase, logActivity } from '../backend/queries';
import { dispatchCrmRequest } from '../backend/router';
import { applyUnifiedConnectionSetup, getSetupCapabilities } from '../backend/setupService';

function parseBody(rawBody: any): Record<string, any> {
  if (!rawBody) return {};
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBody)) {
    rawBody = rawBody.toString('utf8');
  }
  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawBody === 'object' ? rawBody : {};
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const body = parseBody(req.body);
    const query = req.query || {};
    const action = String(body.action || query.action || '').trim();
    const authHeader = String(req.headers?.authorization || '');
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = String(body.token || bearerToken || query.token || '').trim();
    const payload = body.payload && typeof body.payload === 'object' ? { ...body.payload } : {};
    if (!payload.siteOrigin) {
      const xfProto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const xfHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
      if (xfHost) {
        payload.siteOrigin = `${xfProto}://${xfHost}`;
      }
    }

    if (!isDatabaseConfigured()) {
      if (action === 'getSetupCapabilities') {
        const caps = await getSetupCapabilities();
        res.status(200).json({ success: true, message: 'OK', data: caps, error: null });
        return;
      }

      if (action === 'applyUnifiedConnectionSetup') {
        try {
          const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
          if (isServerless) {
            const confirmPwd = String(payload.adminPassword || '').trim();
            if (confirmPwd !== 'Admin@123') {
              res.status(403).json({
                success: false,
                message: 'FORBIDDEN: على استضافة Vercel السحابية يجب ضبط DATABASE_URL في البيئة أو تأكيد كلمة مرور المدير الافتراضية.',
                data: null,
                error: 'FORBIDDEN'
              });
              return;
            }
          }
          const actorRole = String(payload.actorRole || '').trim();
          if (actorRole && actorRole !== 'general_manager') {
            res.status(403).json({
              success: false,
              message: 'FORBIDDEN: إعدادات الربط مخصصة للمدير العام فقط.',
              data: null,
              error: 'FORBIDDEN'
            });
            return;
          }

          const result = await applyUnifiedConnectionSetup({
            payload,
            ensureSeededFn: ensureSeededDatabase,
            logActivityFn: async (exec, actor, act, target, targetId, details) => {
              await logActivity(exec, actor, act, target, targetId, details);
            }
          });
          res.status(200).json({
            success: true,
            message: result.message || 'تم حفظ الإعدادات وتثبيتها في الكود الأساسي بنجاح.',
            data: result,
            error: null
          });
          return;
        } catch (err: any) {
          const msg = String(err?.message || 'تعذر حفظ إعدادات الربط.');
          res.status(200).json({
            success: false,
            message: msg,
            data: null,
            error: msg
          });
          return;
        }
      }

      res.status(503).json({
        success: false,
        message: 'قاعدة البيانات السحابية (Neon PostgreSQL) غير مهيأة بعد على الخادم. أضف متغير DATABASE_URL في إعدادات البيئة (Vercel Environment Variables).',
        data: null,
        error: 'DATABASE_UNCONFIGURED'
      });
      return;
    }

    const executor = createPgExecutor();
    const result = await dispatchCrmRequest(executor, { action, token, payload });
    res.status(200).json(result);
  } catch (err: any) {
    console.error('Unhandled /api/crm error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: `حدث خطأ في خادم قاعدة البيانات السحابية: ${String(err?.message || 'INTERNAL_SERVER_ERROR')}`,
        data: null,
        error: 'SERVER_ERROR'
      });
    }
  }
}
