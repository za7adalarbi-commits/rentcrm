import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DbClient, DbExecutor } from './db';

function loadCrmCore(): any {
  const reqUrl =
    (typeof import.meta !== 'undefined' && import.meta.url)
      ? import.meta.url
      : pathToFileURL(path.resolve(process.cwd(), 'backend/auth.ts')).href;
  const localRequire = createRequire(reqUrl);
  try {
    return localRequire('../assets/js/core.js');
  } catch {
    return localRequire(path.resolve(process.cwd(), 'assets/js/core.js'));
  }
}

export const crmCore: any = loadCrmCore();

export interface AuthEmployee {
  id: string;
  name: string;
  username: string;
  phone: string;
  email: string;
  jobTitle: string;
  role: string;
  permissions: string[];
  status: string;
  lastActivity: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  tokenHash: string;
  employeeId: string;
  username: string;
  role: string;
  expiresAt: string;
  user: AuthEmployee;
}

export function generateId(prefix: string): string {
  const hex = crypto.randomBytes(6).toString('hex').toUpperCase();
  return prefix ? `${prefix}_${hex}` : hex;
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

// Identical salt/hash formula to google-apps-script/Auth.gs so existing credentials migrate seamlessly
export function hashPassword(password: string, salt: string): string {
  return sha256Hex(`${String(salt)}::RENTAL_GATE_CRM::${String(password)}`);
}

// Identical token hashing formula to google-apps-script/Auth.gs
export function hashToken(rawToken: string): string {
  return sha256Hex(`TOKEN::${String(rawToken)}`);
}

export function normalizeLoginUsername(val: unknown): string {
  if (crmCore && typeof crmCore.normalizeLoginUsername === 'function') {
    return crmCore.normalizeLoginUsername(val);
  }
  const s = String(val === null || val === undefined ? '' : val).trim();
  if (!s) return '';
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .toLowerCase();
}

export function parseJsonArray<T = string>(val: any): T[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapEmployeeRow(row: any): AuthEmployee {
  const role = String(row.role || 'agent');
  const rawPerms = parseJsonArray<string>(row.permissions);
  const resolvedPerms = crmCore && typeof crmCore.resolveEffectivePermissions === 'function'
    ? crmCore.resolveEffectivePermissions(role, rawPerms)
    : rawPerms;

  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    username: String(row.username || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    jobTitle: String(row.job_title ?? row.jobTitle ?? ''),
    role,
    permissions: resolvedPerms,
    status: String(row.status || 'active'),
    lastActivity: row.last_activity ? String(row.last_activity) : String(row.lastActivity || ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? row.createdAt ?? ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? row.updatedAt ?? '')
  };
}

export function verifySharedSecret(provided: string, expected: string): boolean {
  const a = String(provided || '').trim();
  const b = String(expected || '').trim();
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy comparison of equal length before returning false
    crypto.timingSafeEqual(bufB, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function canAccessApi(userOrRole: any): boolean {
  return crmCore.canAccessApi(userOrRole);
}

export function hasPermission(user: any, permKey: string): boolean {
  return crmCore.canUserPerform(user, permKey);
}

export function requirePermission(session: AuthSession, permKey: string): void {
  if (!session || !session.user) {
    throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول.');
  }
  if (!hasPermission(session.user, permKey)) {
    throw new Error(`FORBIDDEN: ليس لديك صلاحية تنفيذ هذا الإجراء (${permKey}).`);
  }
}

export function requireApiAccess(session: AuthSession): void {
  if (!session || !session.user) {
    throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول.');
  }
  if (!canAccessApi(session.user)) {
    throw new Error('FORBIDDEN: الوصول إلى إعدادات API والمزامنة متاح للمدير العام والمشرف فقط.');
  }
}

export async function getSessionTtlHours(client: DbClient): Promise<number> {
  const res = await client.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'session_ttl_hours' LIMIT 1`
  );
  const raw = res.rows[0]?.value;
  const n = Number(raw);
  return !isNaN(n) && n >= 1 && n <= 720 ? n : 12;
}

export async function handleLogin(
  executor: DbExecutor,
  payload: Record<string, any>
): Promise<{ token: string; expiresAt: string; user: AuthEmployee }> {
  const username = normalizeLoginUsername(payload?.username);
  const password = String(payload?.password || '');

  if (!username || !password) {
    throw new Error('INVALID_CREDENTIALS: يرجى إدخال اسم المستخدم وكلمة المرور.');
  }

  const empRes = await executor.query(
    `SELECT * FROM employees WHERE LOWER(username) = $1 LIMIT 1`,
    [username]
  );

  let row = empRes.rows[0];
  if (!row) {
    const allRes = await executor.query(`SELECT * FROM employees`);
    row = allRes.rows.find((r) => normalizeLoginUsername(r.username) === username);
  }

  if (!row) {
    throw new Error('INVALID_CREDENTIALS: اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  if (String(row.status || 'active') !== 'active') {
    throw new Error('ACCOUNT_DISABLED: هذا الحساب موقوف حاليًا. تواصل مع المدير العام.');
  }

  const expectedHash = String(row.password_hash || '');
  const salt = String(row.salt || '');
  const computedHash = hashPassword(password, salt);

  let passwordMatches = false;
  if (expectedHash.length === computedHash.length) {
    passwordMatches = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'utf8'),
      Buffer.from(expectedHash, 'utf8')
    );
  }
  if (!passwordMatches) {
    throw new Error('INVALID_CREDENTIALS: اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  const rawToken = `SES_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomBytes(6).toString('hex')}`;
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const ttlHours = await getSessionTtlHours(executor);
  const expiresAt = new Date(now.getTime() + ttlHours * 3600000).toISOString();
  const nowIso = now.toISOString();

  await executor.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO sessions (token_hash, employee_id, username, role, expires_at, created_at, last_seen_at, is_revoked)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $6::timestamptz, FALSE)`,
      [tokenHash, row.id, row.username, row.role, expiresAt, nowIso]
    );
    await tx.query(
      `UPDATE employees SET last_activity = $2, updated_at = $3::timestamptz WHERE id = $1`,
      [row.id, nowIso, nowIso]
    );
    await tx.query(
      `UPDATE users SET last_activity = $2, updated_at = $3::timestamptz WHERE id = $1`,
      [row.id, nowIso, nowIso]
    );
    await tx.query(
      `INSERT INTO activity_log (id, user_id, user_name, user_role, action_type, entity_type, entity_id, details, log_date, log_time, created_at)
       VALUES ($1, $2, $3, $4, 'تسجيل دخول', 'Auth', $2, 'تسجيل دخول إلى النظام عبر قاعدة البيانات السحابية', $5, $6, $7::timestamptz)`,
      [generateId('ACT'), row.id, row.name, row.role, nowIso.slice(0, 10), nowIso.slice(11, 19), nowIso]
    );
  });

  const user = mapEmployeeRow({ ...row, last_activity: nowIso, updated_at: nowIso });
  return { token: rawToken, expiresAt, user };
}

export async function requireAuth(executor: DbExecutor, rawToken: string): Promise<AuthSession> {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول أولاً.');
  }
  const tHash = hashToken(token);
  const sesRes = await executor.query(
    `SELECT s.token_hash, s.employee_id, s.username, s.role, s.expires_at, s.is_revoked, s.last_seen_at,
            e.id AS emp_id, e.name, e.username AS emp_username, e.phone, e.email,
            e.job_title, e.role AS emp_role, e.permissions, e.status AS emp_status,
            e.last_activity, e.created_at, e.updated_at
     FROM sessions s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tHash]
  );

  const row = sesRes.rows[0];
  if (!row || row.is_revoked === true) {
    throw new Error('UNAUTHORIZED: الجلسة غير صالحة أو تم إنهاؤها.');
  }

  const expTime = new Date(row.expires_at).getTime();
  if (!isNaN(expTime) && Date.now() > expTime) {
    await executor.query(`UPDATE sessions SET is_revoked = TRUE WHERE token_hash = $1`, [tHash]);
    throw new Error('UNAUTHORIZED: انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجددًا.');
  }

  if (String(row.emp_status || 'active') !== 'active') {
    throw new Error('UNAUTHORIZED: الحساب غير نشط أو غير موجود.');
  }

  // Opportunistic touch at most once every 5 minutes without blocking read/write latency
  const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (!lastSeenMs || isNaN(lastSeenMs) || (Date.now() - lastSeenMs) > 300000) {
    const nowIso = new Date().toISOString();
    void executor.query(
      `UPDATE sessions SET last_seen_at = $2::timestamptz WHERE token_hash = $1`,
      [tHash, nowIso]
    ).catch(() => undefined);
  }

  const user = mapEmployeeRow({
    id: row.emp_id,
    name: row.name,
    username: row.emp_username,
    phone: row.phone,
    email: row.email,
    job_title: row.job_title,
    role: row.emp_role,
    permissions: row.permissions,
    status: row.emp_status,
    last_activity: row.last_activity,
    created_at: row.created_at,
    updated_at: row.updated_at
  });

  return {
    tokenHash: tHash,
    employeeId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    user
  };
}

export async function handleLogout(executor: DbExecutor, session: AuthSession): Promise<{ loggedOut: boolean }> {
  await executor.query(`UPDATE sessions SET is_revoked = TRUE WHERE token_hash = $1`, [session.tokenHash]);
  const nowIso = new Date().toISOString();
  await executor.query(
    `INSERT INTO activity_log (id, user_id, user_name, user_role, action_type, entity_type, entity_id, details, log_date, log_time, created_at)
     VALUES ($1, $2, $3, $4, 'تسجيل خروج', 'Auth', $2, 'تسجيل خروج من النظام', $5, $6, $7::timestamptz)`,
    [generateId('ACT'), session.user.id, session.user.name, session.user.role, nowIso.slice(0, 10), nowIso.slice(11, 19), nowIso]
  );
  return { loggedOut: true };
}

export async function revokeEmployeeSessions(client: DbClient, employeeId: string): Promise<void> {
  await client.query(`UPDATE sessions SET is_revoked = TRUE WHERE employee_id = $1`, [employeeId]);
}
