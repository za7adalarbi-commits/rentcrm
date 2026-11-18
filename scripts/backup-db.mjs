import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const TABLES = [
  'users',
  'employees',
  'reservations',
  'extensions',
  'assignments',
  'follow_ups',
  'follow_up_history',
  'problems',
  'issues',
  'problem_updates',
  'activity_log',
  'notifications',
  'settings',
  'roles',
  'permissions',
  'sessions',
  'sync_log',
  'sync_checkpoints',
  'sheets_mirror_outbox',
  'error_logs'
];

export async function runDatabaseBackup({ outDir = path.resolve(process.cwd(), 'backups'), prefix = 'backup' } = {}) {
  const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `${prefix}-${stamp}.json`);

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false }
  });

  try {
    const snapshot = {
      createdAt: new Date().toISOString(),
      tables: {},
      counts: {}
    };

    for (const table of TABLES) {
      const existsRes = await pool.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
      if (!existsRes.rows[0]?.reg) {
        snapshot.tables[table] = [];
        snapshot.counts[table] = 0;
        continue;
      }
      const res = await pool.query(`SELECT * FROM ${table}`);
      snapshot.tables[table] = res.rows;
      snapshot.counts[table] = res.rows.length;
    }

    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
    return { outPath, counts: snapshot.counts };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDatabaseBackup()
    .then(({ outPath, counts }) => {
      console.log(`Database backup created successfully at: ${outPath}`);
      console.log('Row counts:', JSON.stringify(counts, null, 2));
    })
    .catch((err) => {
      console.error('Backup failed:', err.message || err);
      process.exit(1);
    });
}
