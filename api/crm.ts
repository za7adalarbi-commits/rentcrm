import crypto from 'node:crypto';
import {
  hashPassword,
  mapEmployeeRow,
  normalizeLoginUsername,
  type AuthSession
} from '../backend/auth.js';
import {
  createPgExecutor,
  ensureSchemaInitialized,
  isDatabaseConfigured,
  resetPoolForReconfig,
  testDatabaseConnection
} from '../backend/db.js';
import { ensureSeededDatabase, logActivity } from '../backend/queries.js';
import { dispatchCrmRequest } from '../backend/router.js';
import { applyUnifiedConnectionSetup, getSetupCapabilities } from '../backend/setupService.js';

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

async function verifyGeneralManagerCredentials(
  executor: ReturnType<typeof createPgExecutor>,
  usernameRaw: unknown,
  passwordRaw: unknown
): Promise<AuthSession> {
  const uname = normalizeLoginUsername(usernameRaw || 'admin') || 'admin';
  const pwd = String(passwordRaw || '');
  if (!pwd) {
    throw new Error('ADMIN_VERIFY_REQUIRED: يرجى إدخال كلمة مرور المدير العام لإتمام الربط والتحويل.');
  }

  await ensureSchemaInitialized(executor);
  await ensureSeededDatabase(executor);

  const empRes = await executor.query(
    `SELECT * FROM employees WHERE LOWER(username) = $1 LIMIT 1`,
    [uname]
  );
  let row = empRes.rows[0];
  if (!row) {
    const allRes = await executor.query(`SELECT * FROM employees`);
    row = allRes.rows.find((r) => normalizeLoginUsername(r.username) === uname);
  }
  if (!row || String(row.status || 'active') !== 'active') {
    throw new Error('FORBIDDEN: حساب المدير العام غير موجود أو غير نشط.');
  }
  if (String(row.role || '') !== 'general_manager') {
    throw new Error('FORBIDDEN: تحويل الوضع وإعدادات الربط الشامل متاح للمدير العام فقط.');
  }

  const expectedHash = String(row.password_hash || '');
  const computedHash = hashPassword(pwd, String(row.salt || ''));
  const matches =
    expectedHash.length === computedHash.length &&
    crypto.timingSafeEqual(Buffer.from(computedHash, 'utf8'), Buffer.from(expectedHash, 'utf8'));

  if (!matches) {
    throw new Error('FORBIDDEN: كلمة مرور المدير العام غير صحيحة.');
  }

  const user = mapEmployeeRow(row);
  return {
    tokenHash: 'DIRECT_GM_SETUP',
    employeeId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    user
  };
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

    const envDbConfigured = isDatabaseConfigured();
    if (!envDbConfigured) {
      if (action === 'getSetupCapabilities') {
        const caps = await getSetupCapabilities();
        res.status(200).json({ success: true, message: 'OK', data: caps, error: null });
        return;
      }

      if (action === 'applyUnifiedConnectionSetup') {
        try {
          const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
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

          let verifiedExecutor: ReturnType<typeof createPgExecutor> | undefined;
          let verifiedSession: AuthSession | undefined;
          if (isServerless) {
            const confirmPwd = String(payload.adminPassword || '').trim();
            if (!confirmPwd) {
              res.status(403).json({
                success: false,
                message: 'ADMIN_VERIFY_REQUIRED: على استضافة Vercel السحابية يرجى إدخال كلمة مرور المدير العام لتأكيد الربط، أو ضبط DATABASE_URL في إعدادات البيئة في Vercel.',
                data: null,
                error: 'ADMIN_VERIFY_REQUIRED'
              });
              return;
            }
            const inputDbUrl = String(payload.databaseUrl || '').trim();
            if (inputDbUrl && /^postgres(ql)?:\/\//i.test(inputDbUrl)) {
              await testDatabaseConnection(inputDbUrl);
              await resetPoolForReconfig(inputDbUrl);
              verifiedExecutor = createPgExecutor();
              verifiedSession = await verifyGeneralManagerCredentials(
                verifiedExecutor,
                payload.adminUsername || 'admin',
                confirmPwd
              );
            } else if (confirmPwd !== 'Admin@123') {
              res.status(403).json({
                success: false,
                message: 'FORBIDDEN: كلمة مرور المدير العام غير صحيحة.',
                data: null,
                error: 'FORBIDDEN'
              });
              return;
            }
          }

          const result = await applyUnifiedConnectionSetup({
            executor: verifiedExecutor,
            session: verifiedSession,
            payload,
            wasDatabaseConfiguredBeforeRequest: false,
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
        message: 'قاعدة البيانات السحابية (Neon PostgreSQL) غير مهيأة بعد على الخادم. أضف متغير DATABASE_URL في إعدادات البيئة (Vercel Environment Variables) أو أدخلها في إعدادات الربط مع كلمة مرور المدير.',
        data: null,
        error: 'DATABASE_UNCONFIGURED'
      });
      return;
    }

    const executor = createPgExecutor();
    const result = await dispatchCrmRequest(executor, { action, token, payload });

    // Allow Settings page in Sandbox/GAS mode to read non-secret capabilities (e.g. whether DATABASE_URL is already set in Vercel)
    if (
      action === 'getSetupCapabilities' &&
      !result.success &&
      /^UNAUTHORIZED/i.test(String(result.error || result.message || ''))
    ) {
      const caps = await getSetupCapabilities(executor);
      res.status(200).json({ success: true, message: 'OK', data: caps, error: null });
      return;
    }

    // Allow General Manager switching back from Sandbox/GAS mode into Neon mode via verified GM credentials
    if (
      action === 'applyUnifiedConnectionSetup' &&
      !result.success &&
      /^UNAUTHORIZED/i.test(String(result.error || result.message || ''))
    ) {
      const confirmPwd = String(payload.adminPassword || '').trim();
      if (!confirmPwd) {
        res.status(200).json({
          success: false,
          message: 'ADMIN_VERIFY_REQUIRED: أنت حاليًا في وضع المعاينة أو Apps Script — أدخل كلمة مرور المدير العام لتأكيد التحويل إلى Neon PostgreSQL.',
          data: null,
          error: 'ADMIN_VERIFY_REQUIRED'
        });
        return;
      }
      try {
        const gmSession = await verifyGeneralManagerCredentials(
          executor,
          payload.adminUsername || 'admin',
          confirmPwd
        );
        const setupData = await applyUnifiedConnectionSetup({
          executor,
          session: gmSession,
          payload,
          ensureSeededFn: ensureSeededDatabase,
          logActivityFn: async (exec, actor, act, target, targetId, details) => {
            await logActivity(exec, actor, act, target, targetId, details);
          }
        });
        res.status(200).json({
          success: true,
          message: setupData.message || 'تم التحويل والربط بقاعدة البيانات السحابية Neon PostgreSQL بنجاح.',
          data: setupData,
          error: null
        });
        return;
      } catch (verifyErr: any) {
        const vMsg = String(verifyErr?.message || 'تعذر التحقق من بيانات المدير العام.');
        res.status(200).json({
          success: false,
          message: vMsg,
          data: null,
          error: vMsg
        });
        return;
      }
    }

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
