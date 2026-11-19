-- ============================================================================
-- RENTAL GATE CRM — Neon PostgreSQL Schema (17 Exact Core Tables + 3 Ops Tables)
-- Preserves 100% of fields from google-apps-script/Database.gs (RG_SHEETS_SCHEMA)
-- Designed for 100,000+ reservations, trigram full-text search, FKs & transactions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Users (mirrors RG_SHEETS.USERS)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  last_activity TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Employees (mirrors RG_SHEETS.EMPLOYEES)
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  last_activity TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Reservations (mirrors RG_SHEETS.RESERVATIONS — 52 columns)
-- Date-only & time-only fields are stored as TEXT (YYYY-MM-DD / HH:mm[:ss]) to avoid UTC midnight shift.
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  source_reservation_id TEXT NOT NULL DEFAULT '',
  reservation_number TEXT NOT NULL UNIQUE,
  source_created_at TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_id_number TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  deliver_branch_name TEXT NOT NULL DEFAULT '',
  car_name TEXT NOT NULL DEFAULT '',
  plate_number TEXT NOT NULL DEFAULT '',
  car_category TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  original_end_date TEXT NOT NULL DEFAULT '',
  original_end_time TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  extended_until_date TEXT NOT NULL DEFAULT '',
  extended_until_time TEXT NOT NULL DEFAULT '',
  days_count INTEGER NOT NULL DEFAULT 0,
  extended_days_count INTEGER NOT NULL DEFAULT 0,
  total_days_count INTEGER NOT NULL DEFAULT 0,
  original_status_code TEXT NOT NULL DEFAULT '',
  original_status_ar TEXT NOT NULL DEFAULT '',
  pickup_type_ar TEXT NOT NULL DEFAULT '',
  return_type_ar TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  daily_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  extensions_count INTEGER NOT NULL DEFAULT 0,
  extensions_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  has_extensions BOOLEAN NOT NULL DEFAULT FALSE,
  internal_status TEXT NOT NULL DEFAULT 'تم الإنشاء',
  priority TEXT NOT NULL DEFAULT 'عادي',
  assigned_employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_update_text TEXT NOT NULL DEFAULT '',
  last_updated_by_id TEXT NOT NULL DEFAULT '',
  last_updated_by_name TEXT NOT NULL DEFAULT '',
  last_updated_at TEXT NOT NULL DEFAULT '',
  has_problem BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_json TEXT NOT NULL DEFAULT ''
);

-- 4. Extensions (mirrors RG_SHEETS.EXTENSIONS — 23 columns)
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  extension_number TEXT NOT NULL UNIQUE,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL DEFAULT '',
  source_reservation_id TEXT NOT NULL DEFAULT '',
  extension_type TEXT NOT NULL DEFAULT '',
  extension_type_ar TEXT NOT NULL DEFAULT '',
  status_code TEXT NOT NULL DEFAULT '',
  status_ar TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  payment_date TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  extend_days INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  sub_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_accepted_and_paid BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Assignments (mirrors RG_SHEETS.ASSIGNMENTS)
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL DEFAULT '',
  assigned_by_id TEXT NOT NULL DEFAULT '',
  assigned_by_name TEXT NOT NULL DEFAULT '',
  role_type TEXT NOT NULL DEFAULT 'followup',
  status TEXT NOT NULL DEFAULT 'active',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. FollowUps (mirrors RG_SHEETS.FOLLOWUPS)
CREATE TABLE IF NOT EXISTS follow_ups (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT NOT NULL DEFAULT '',
  follow_up_time TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. FollowUpHistory (mirrors RG_SHEETS.FOLLOWUP_HISTORY)
CREATE TABLE IF NOT EXISTS follow_up_history (
  id TEXT PRIMARY KEY,
  follow_up_id TEXT NOT NULL DEFAULT '',
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL DEFAULT 'update',
  previous_status TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL DEFAULT '',
  previous_action TEXT NOT NULL DEFAULT '',
  new_action TEXT NOT NULL DEFAULT '',
  previous_notes TEXT NOT NULL DEFAULT '',
  new_notes TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Problems (mirrors RG_SHEETS.PROBLEMS — 14 columns)
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  problem_number TEXT NOT NULL UNIQUE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  reservation_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  assigned_employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'متوسط',
  status TEXT NOT NULL DEFAULT 'جديدة',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Issues (mirrors RG_SHEETS.ISSUES — identical schema to Problems for Sheets compatibility)
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  problem_number TEXT NOT NULL UNIQUE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  reservation_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  assigned_employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'متوسط',
  status TEXT NOT NULL DEFAULT 'جديدة',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. ProblemUpdates (mirrors RG_SHEETS.PROBLEM_UPDATES)
CREATE TABLE IF NOT EXISTS problem_updates (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL DEFAULT '',
  previous_priority TEXT NOT NULL DEFAULT '',
  new_priority TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. ActivityLog (mirrors RG_SHEETS.ACTIVITY_LOG)
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  user_role TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  log_date TEXT NOT NULL DEFAULT '',
  log_time TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Notifications (mirrors RG_SHEETS.NOTIFICATIONS)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_employee_id TEXT NOT NULL DEFAULT '',
  recipient_role TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Settings (mirrors RG_SHEETS.SETTINGS)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Roles (mirrors RG_SHEETS.ROLES)
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Permissions (mirrors RG_SHEETS.PERMISSIONS)
CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  "group" TEXT NOT NULL DEFAULT 'عام',
  is_custom BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Sessions (mirrors RG_SHEETS.SESSIONS)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE
);

-- 17. SyncLog (mirrors RG_SHEETS.SYNC_LOG)
CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  triggered_by_id TEXT NOT NULL DEFAULT '',
  triggered_by_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success',
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  extensions_count INTEGER NOT NULL DEFAULT 0,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Operational Tables for Hybrid Cloud Sync, Deduplication & Sheets Mirroring
-- ============================================================================

-- 18. Incremental Sync Checkpoints & Hash State
CREATE TABLE IF NOT EXISTS sync_checkpoints (
  source TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_successful_at TIMESTAMPTZ,
  last_cursor TEXT NOT NULL DEFAULT '',
  last_batch_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. CRM -> Google Sheets Write-Back Outbox Queue (for backup mirror resilience)
CREATE TABLE IF NOT EXISTS sheets_mirror_outbox (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- 20. Server Error & Diagnostics Log (sanitized, never stores secrets)
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  context TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Performance Indexes for 100,000+ Reservations & Fast Faceted Queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_reservations_updated_at_desc ON reservations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at_desc ON reservations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_start_date ON reservations (start_date DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_end_date ON reservations (end_date DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_internal_status ON reservations (internal_status);
CREATE INDEX IF NOT EXISTS idx_reservations_priority ON reservations (priority);
CREATE INDEX IF NOT EXISTS idx_reservations_company_name ON reservations (company_name);
CREATE INDEX IF NOT EXISTS idx_reservations_branch_name ON reservations (branch_name);
CREATE INDEX IF NOT EXISTS idx_reservations_has_problem ON reservations (has_problem) WHERE has_problem = TRUE;
CREATE INDEX IF NOT EXISTS idx_reservations_source_id ON reservations (source_reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservations_assigned_ids_gin ON reservations USING GIN (assigned_employee_ids);
CREATE INDEX IF NOT EXISTS idx_reservations_customer_phone ON reservations (customer_phone);

-- Trigram GIN indexes for instant substring ILIKE search across 100k+ records
CREATE INDEX IF NOT EXISTS idx_reservations_number_trgm ON reservations USING GIN (reservation_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reservations_customer_name_trgm ON reservations USING GIN (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reservations_customer_phone_trgm ON reservations USING GIN (customer_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reservations_car_name_trgm ON reservations USING GIN (car_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reservations_plate_number_trgm ON reservations USING GIN (plate_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_extensions_reservation_id ON extensions (reservation_id);
CREATE INDEX IF NOT EXISTS idx_extensions_reservation_number ON extensions (reservation_number);
CREATE INDEX IF NOT EXISTS idx_extensions_source_res_id ON extensions (source_reservation_id);

CREATE INDEX IF NOT EXISTS idx_assignments_res_active ON assignments (reservation_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_emp_active ON assignments (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_follow_ups_res_created ON follow_ups (reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_emp_created ON follow_ups (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_date ON follow_ups (follow_up_date);

CREATE INDEX IF NOT EXISTS idx_follow_up_history_res ON follow_up_history (reservation_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_problems_res_id ON problems (reservation_id);
CREATE INDEX IF NOT EXISTS idx_problems_status_priority ON problems (status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_problems_assigned_gin ON problems USING GIN (assigned_employee_ids);

CREATE INDEX IF NOT EXISTS idx_problem_updates_problem_id ON problem_updates (problem_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_date ON activity_log (user_id, log_date);

CREATE INDEX IF NOT EXISTS idx_reservations_status_updated ON reservations (internal_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_company_updated ON reservations (company_name, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (recipient_employee_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_role_read ON notifications (recipient_role, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_employee_active ON sessions (employee_id, is_revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON sync_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mirror_outbox_pending ON sheets_mirror_outbox (status, next_retry_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs (created_at DESC);
