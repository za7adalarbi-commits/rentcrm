import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import autoConnectHandler from '../api/auto-connect';
import { executeAutoConnect, getAutoConnectStatus, readClientConfigFileUrls } from '../backend/autoConnect';
import { getEnv, setRuntimeEnv } from '../backend/env';

const TRACKED_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
  'GAS_WEBAPP_URL',
  'VITE_GAS_WEBAPP_URL',
  'VITE_BACKEND_API_URL',
  'RG_TOKEN',
  'RENTAL_TOKEN',
  'SYNC_API_SECRET',
  'SPREADSHEET_ID'
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of TRACKED_ENV_KEYS) {
    snap[k] = process.env[k];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of TRACKED_ENV_KEYS) {
    const val = snap[k];
    setRuntimeEnv(k, val === undefined ? '' : val);
    if (val === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = val;
    }
  }
}

test('executeAutoConnect writes .env, .gitignore, .env.example, and assets/js/config.js without leaking secrets', async () => {
  const prevEnv = snapshotEnv();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-autoconnect-'));
  try {
    restoreEnv({});
    // Simulate dist existing too so both assets/js/config.js and dist/assets/js/config.js stay synced
    fs.mkdirSync(path.join(tmpDir, 'assets/js'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'dist/assets/js'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets/js/config.js'), '// initial', 'utf8');

    const mockFetch: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('script.google.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.action === 'ping') {
          return new Response(JSON.stringify({ success: true, message: 'OK', data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, message: 'SYNCED', data: { applied: 1 } }), { status: 200 });
      }
      if (u.includes('rentalgate.net')) {
        return new Response(JSON.stringify({ content: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const dbSecretUrl = 'postgresql://neondb_owner:TopSecretPass42@ep-main.neon.tech/rgcrm?sslmode=require';
    const rgSecretToken = 'RG_LIVE_SECRET_TOKEN_XYZ_123456';
    const gasExecUrl = 'https://script.google.com/macros/s/AKfycbDeployAuto123/exec';

    const result = await executeAutoConnect(
      tmpDir,
      {
        databaseUrl: dbSecretUrl,
        gasWebAppUrl: gasExecUrl,
        rgToken: rgSecretToken,
        spreadsheetId: '1AbcSpreadsheetId99',
        gasToken: 'SES_GAS_ADMIN_123',
        initialSetup: true
      },
      {
        fetchFn: mockFetch,
        dbProbeFn: async () => ({
          connected: true,
          initialized: true,
          message: 'PostgreSQL connected'
        })
      }
    );

    assert.equal(result.saved, true);
    assert.ok(result.updatedFiles.includes('.env'));
    assert.ok(result.updatedFiles.includes('assets/js/config.js'));
    assert.ok(result.updatedFiles.includes('dist/assets/js/config.js'));
    assert.equal(result.checks.database?.connected, true);
    assert.equal(result.checks.gas?.connected, true);
    assert.equal(result.checks.gasRemoteSync?.synced, true);
    assert.equal(result.checks.rentalGate?.connected, true);

    // Check .env contents have real server secrets & public vars
    const envContent = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    assert.ok(envContent.includes(`DATABASE_URL=${dbSecretUrl}`));
    assert.ok(envContent.includes(`RG_TOKEN=${rgSecretToken}`));
    assert.ok(envContent.includes(`RENTAL_TOKEN=${rgSecretToken}`));
    assert.ok(envContent.includes(`GAS_WEBAPP_URL=${gasExecUrl}`));
    assert.ok(envContent.includes('VITE_BACKEND_API_URL=/api/crm'));
    assert.ok(envContent.includes('SPREADSHEET_ID=1AbcSpreadsheetId99'));

    // Security check: assets/js/config.js and .env.example NEVER contain secrets
    const cfgContent = fs.readFileSync(path.join(tmpDir, 'assets/js/config.js'), 'utf8');
    assert.ok(cfgContent.includes(`gasWebAppUrl: '${gasExecUrl}'`));
    assert.ok(cfgContent.includes("backendApiUrl: '/api/crm'"));
    assert.equal(cfgContent.includes('TopSecretPass42'), false);
    assert.equal(cfgContent.includes(rgSecretToken), false);
    assert.equal(cfgContent.includes(dbSecretUrl), false);

    const exampleContent = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf8');
    assert.equal(exampleContent.includes('TopSecretPass42'), false);
    assert.equal(exampleContent.includes(rgSecretToken), false);

    const gitignoreContent = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    assert.ok(gitignoreContent.includes('.env'));

    // Partial follow-up update leaving secrets empty MUST preserve saved DATABASE_URL and RG_TOKEN
    const partialRes = await executeAutoConnect(
      tmpDir,
      {
        databaseUrl: '',
        rgToken: '',
        gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbDeployUpdated/exec',
        verifyConnections: false
      },
      { fetchFn: mockFetch }
    );
    assert.equal(partialRes.connectionConfig.gasWebAppUrl, 'https://script.google.com/macros/s/AKfycbDeployUpdated/exec');
    assert.equal(getEnv('RG_TOKEN'), rgSecretToken);
    assert.equal(getEnv('DATABASE_URL'), dbSecretUrl);

    // Status inspection must return masked secrets only
    const status = await getAutoConnectStatus(tmpDir, { checkDbHealth: false });
    assert.equal(status.database.configured, true);
    assert.equal(status.database.maskedUrl.includes('TopSecretPass42'), false);
    assert.equal(status.rentalGate.maskedToken, '****3456');
  } finally {
    restoreEnv(prevEnv);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('/api/auto-connect enforces initialSetup when unconfigured and Bearer GM auth when DB is configured', async () => {
  const prevEnv = snapshotEnv();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-ac-http-'));
  try {
    restoreEnv({});
    const makeRes = () => {
      const out: any = { statusCode: 200, body: null };
      out.status = (code: number) => {
        out.statusCode = code;
        return out;
      };
      out.json = (payload: any) => {
        out.body = payload;
        return out;
      };
      out.end = () => out;
      return out;
    };

    // Case 1: unconfigured DB, POST without initialSetup: true must fail 403
    const resNoInit = makeRes();
    await autoConnectHandler(
      { method: 'POST', headers: {}, body: { gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbX/exec' } },
      resNoInit,
      tmpDir
    );
    assert.equal(resNoInit.statusCode, 403);
    assert.equal(resNoInit.body?.error, 'FORBIDDEN');

    // Case 2: configured DB, unauthenticated POST must fail 401
    setRuntimeEnv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:59999/db?sslmode=disable');
    const resUnauth = makeRes();
    await autoConnectHandler(
      { method: 'POST', headers: {}, body: { initialSetup: true, gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbX/exec' } },
      resUnauth,
      tmpDir
    );
    assert.equal(resUnauth.statusCode, 401);

    // Case 3: readClientConfigFileUrls must ignore JSDoc comments
    fs.mkdirSync(path.join(tmpDir, 'assets/js'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'assets/js/config.js'),
      "/* مثال:\n * gasWebAppUrl: 'https://script.google.com/macros/s/FAKE/exec'\n */\nroot.RG_APP_CONFIG = {\n  gasWebAppUrl: '',\n  backendApiUrl: ''\n};\n",
      'utf8'
    );
    const parsedCfg = readClientConfigFileUrls(tmpDir);
    assert.equal(parsedCfg.gasWebAppUrl, '');
    assert.equal(parsedCfg.backendApiUrl, '');
  } finally {
    restoreEnv(prevEnv);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
