import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runDatabaseBackup } from './backup-db.mjs';

const { Pool } = pg;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--input' && argv[i + 1]) args.input = argv[++i];
    else if (k === '--skip-backup') args.skipBackup = true;
    else if (k === '--schema-only') args.schemaOnly = true;
  }
  return args;
}

function asArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asBool(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val || '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

function asDateStr(val) {
  if (!val) return new Date().toISOString();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function asUiOverridesJson(val) {
  if (!val) return '{}';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return '{}';
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? JSON.stringify(parsed) : '{}';
    } catch {
      return '{}';
    }
  }
  return typeof val === 'object' && !Array.isArray(val) ? JSON.stringify(val) : '{}';
}

async function migrate() {
  const args = parseArgs(process.argv);
  const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required before running migration.');
  }

  // Mandatory pre-migration backup safety guard
  if (!args.skipBackup) {
    const { outPath } = await runDatabaseBackup({ prefix: 'pre-migration' });
    console.log(`Pre-migration backup verified: ${outPath}`);
  }

  const schemaPath = path.resolve(process.cwd(), 'database/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    await client.query(schemaSql);
    console.log('PostgreSQL schema applied cleanly.');

    if (args.schemaOnly || !args.input) {
      if (!args.input) {
        console.log('No --input JSON snapshot supplied; schema initialization complete.');
      }
      return;
    }

    const inputPath = path.resolve(process.cwd(), args.input);
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const data = raw.sheets || raw.tables || raw;

    await client.query('BEGIN');

    for (const emp of data.Employees || data.employees || []) {
      if (!emp.id || !emp.username) continue;
      const uiOvJson = asUiOverridesJson(emp.uiOverrides ?? emp.ui_overrides);
      await client.query(
        `INSERT INTO employees (id, name, username, password_hash, salt, phone, email, job_title, role, permissions, ui_overrides, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::timestamptz,$15::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email,
           job_title = EXCLUDED.job_title, role = EXCLUDED.role, permissions = EXCLUDED.permissions,
           ui_overrides = CASE WHEN employees.ui_overrides = '{}'::jsonb THEN EXCLUDED.ui_overrides ELSE employees.ui_overrides END,
           status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
        [
          emp.id, emp.name || '', emp.username, emp.passwordHash || emp.password_hash || '',
          emp.salt || '', emp.phone || '', emp.email || '', emp.jobTitle || emp.job_title || '',
          emp.role || 'agent', JSON.stringify(asArray(emp.permissions)), uiOvJson, emp.status || 'active',
          emp.lastActivity || emp.last_activity || '', asDateStr(emp.createdAt || emp.created_at),
          asDateStr(emp.updatedAt || emp.updated_at)
        ]
      );
      await client.query(
        `INSERT INTO users (id, name, username, phone, email, job_title, role, permissions, ui_overrides, status, last_activity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::timestamptz,$13::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          emp.id, emp.name || '', emp.username, emp.phone || '', emp.email || '',
          emp.jobTitle || emp.job_title || '', emp.role || 'agent',
          JSON.stringify(asArray(emp.permissions)), uiOvJson, emp.status || 'active',
          emp.lastActivity || emp.last_activity || '', asDateStr(emp.createdAt || emp.created_at),
          asDateStr(emp.updatedAt || emp.updated_at)
        ]
      );
    }

    for (const r of data.Reservations || data.reservations || []) {
      const resNum = String(r.reservationNumber || r.reservation_number || r.id || '').trim();
      if (!r.id || !resNum) continue;
      await client.query(
        `INSERT INTO reservations (
           id, source_reservation_id, reservation_number, source_created_at,
           customer_name, customer_phone, customer_email, customer_id_number,
           company_name, branch_name, deliver_branch_name, car_name, plate_number, car_category,
           start_date, start_time, original_end_date, original_end_time, end_date, end_time,
           extended_until_date, extended_until_time, days_count, extended_days_count, total_days_count,
           original_status_code, original_status_ar, pickup_type_ar, return_type_ar,
           payment_method, payment_status, daily_price, discount_amount, vat_amount,
           base_amount, extensions_count, extensions_amount, total_amount, has_extensions,
           internal_status, priority, assigned_employee_ids, assigned_employee_names,
           last_update_text, last_updated_by_id, last_updated_by_name, last_updated_at,
           has_problem, created_at, updated_at, status_history, raw_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
           $40,$41,$42::jsonb,$43::jsonb,$44,$45,$46,$47,$48,$49::timestamptz,$50::timestamptz,$51::jsonb,$52
         )
         ON CONFLICT (reservation_number) DO UPDATE SET
           internal_status = EXCLUDED.internal_status,
           priority = EXCLUDED.priority,
           assigned_employee_ids = EXCLUDED.assigned_employee_ids,
           assigned_employee_names = EXCLUDED.assigned_employee_names,
           status_history = EXCLUDED.status_history,
           updated_at = EXCLUDED.updated_at`,
        [
          r.id, r.sourceReservationId || resNum, resNum, r.sourceCreatedAt || '',
          r.customerName || '', r.customerPhone || '', r.customerEmail || '', r.customerIdNumber || '',
          r.companyName || '', r.branchName || '', r.deliverBranchName || '', r.carName || '',
          r.plateNumber || '', r.carCategory || '', r.startDate || '', r.startTime || '',
          r.originalEndDate || '', r.originalEndTime || '', r.endDate || '', r.endTime || '',
          r.extendedUntilDate || '', r.extendedUntilTime || '',
          Number(r.daysCount || 0), Number(r.extendedDaysCount || 0), Number(r.totalDaysCount || 0),
          r.originalStatusCode || '', r.originalStatusAr || '', r.pickupTypeAr || '', r.returnTypeAr || '',
          r.paymentMethod || '', r.paymentStatus || '', Number(r.dailyPrice || 0), Number(r.discountAmount || 0),
          Number(r.vatAmount || 0), Number(r.baseAmount || 0), Number(r.extensionsCount || 0),
          Number(r.extensionsAmount || 0), Number(r.totalAmount || 0), asBool(r.hasExtensions),
          r.internalStatus || 'تم الإنشاء', r.priority || 'عادي',
          JSON.stringify(asArray(r.assignedEmployeeIds)), JSON.stringify(asArray(r.assignedEmployeeNames)),
          r.lastUpdateText || '', r.lastUpdatedById || '', r.lastUpdatedByName || '', r.lastUpdatedAt || '',
          asBool(r.hasProblem), asDateStr(r.createdAt), asDateStr(r.updatedAt),
          JSON.stringify(asArray(r.statusHistory)), String(r.rawJson || '')
        ]
      );
    }

    for (const s of data.Settings || data.settings || []) {
      if (!s.key) continue;
      await client.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1,$2,$3,$4::timestamptz)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [s.key, String(s.value ?? ''), s.updatedBy || 'MIGRATION', asDateStr(s.updatedAt)]
      );
    }

    for (const fu of data.FollowUps || data.followUps || []) {
      if (!fu.id || !fu.reservationId) continue;
      await client.query(
        `INSERT INTO follow_ups (id, reservation_id, reservation_number, customer_name, employee_id, employee_name, status, action, notes, follow_up_date, follow_up_time, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          fu.id, fu.reservationId, fu.reservationNumber || '', fu.customerName || '',
          fu.employeeId || '', fu.employeeName || '', fu.status || '', fu.action || '',
          fu.notes || '', fu.followUpDate || '', fu.followUpTime || '', asDateStr(fu.createdAt)
        ]
      );
    }

    for (const prb of data.Problems || data.problems || []) {
      if (!prb.id || !prb.problemNumber) continue;
      const pArgs = [
        prb.id, prb.problemNumber, prb.reservationId || null, prb.reservationNumber || '',
        prb.customerName || '', prb.createdById || '', prb.createdByName || '',
        JSON.stringify(asArray(prb.assignedEmployeeIds)), JSON.stringify(asArray(prb.assignedEmployeeNames)),
        prb.description || '', prb.priority || 'متوسط', prb.status || 'جديدة',
        asDateStr(prb.createdAt), asDateStr(prb.updatedAt)
      ];
      await client.query(
        `INSERT INTO problems (id, problem_number, reservation_id, reservation_number, customer_name, created_by_id, created_by_name, assigned_employee_ids, assigned_employee_names, description, priority, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::timestamptz,$14::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        pArgs
      );
      await client.query(
        `INSERT INTO issues (id, problem_number, reservation_id, reservation_number, customer_name, created_by_id, created_by_name, assigned_employee_ids, assigned_employee_names, description, priority, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::timestamptz,$14::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        pArgs
      );
    }

    await client.query('COMMIT');
    console.log('Data migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
