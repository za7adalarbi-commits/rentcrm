import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildSpamSignature } from '../backend/cache';
import { attachAppVersionHeaders, readServerVersionManifest } from '../backend/versionManifest';

function loadCoreFromDisk() {
  const corePath = path.resolve(process.cwd(), 'assets/js/core.js');
  const code = fs.readFileSync(corePath, 'utf8');
  const sandbox: any = { window: {}, globalThis: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.RGCrmCore || sandbox.window.RGCrmCore;
}

test('versionManifest matches vite.config 14-char SHA truncation and sets X-App-Version headers', () => {
  const prevEnv = {
    NODE_ENV: process.env.NODE_ENV,
    VITE_BUILD_VERSION: process.env.VITE_BUILD_VERSION,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    GITHUB_SHA: process.env.GITHUB_SHA,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID
  };

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.VITE_BUILD_VERSION;
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890abcdef';
    const manifest = readServerVersionManifest();
    assert.equal(typeof manifest.version, 'string');
    assert.ok(manifest.version.length > 0);

    const headers: Record<string, string> = {};
    const mockRes = {
      getHeader(k: string) {
        return headers[k.toLowerCase()];
      },
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = String(v);
      }
    };
    const attached = attachAppVersionHeaders(mockRes);
    assert.equal(headers['x-app-version'], attached.version);
    assert.match(headers['access-control-expose-headers'], /X-App-Version/i);

    const manifestSource = fs.readFileSync(path.resolve(process.cwd(), 'backend/versionManifest.ts'), 'utf8');
    const viteSource = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    assert.match(manifestSource, /sha\.slice\(0, 14\)/);
    assert.match(viteSource, /VERCEL_DEPLOYMENT_ID/);
    assert.match(viteSource, /explicit\.slice\(0, 14\)/);
  } finally {
    Object.entries(prevEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
});

test('RGCrmCore buildCacheBustedUrl appends version safely without duplicating or breaking hashes', () => {
  const core = loadCoreFromDisk();
  assert.equal(typeof core.buildCacheBustedUrl, 'function');

  assert.equal(
    core.buildCacheBustedUrl('./assets/vendor/chart.umd.min.js', 'a1b2c3d4e5f678'),
    './assets/vendor/chart.umd.min.js?v=a1b2c3d4e5f678'
  );
  assert.equal(
    core.buildCacheBustedUrl('./assets/js/app.js?lang=ar#reservations', 'rel999'),
    './assets/js/app.js?lang=ar&v=rel999#reservations'
  );
  assert.equal(
    core.buildCacheBustedUrl('./assets/js/app.js?v=old123&lang=ar', 'new456'),
    './assets/js/app.js?v=new456&lang=ar'
  );
  assert.equal(
    core.buildCacheBustedUrl('./assets/js/app.js', 'dev'),
    './assets/js/app.js'
  );
  assert.equal(
    core.buildCacheBustedUrl('./assets/js/app.js', 'local'),
    './assets/js/app.js'
  );
});

test('RGCrmCore shouldTriggerAutoUpdateReload protects unsaved edits, in-flight writes, and prevents reload loops', () => {
  const core = loadCoreFromDisk();
  const now = 1_700_000_000_000;

  assert.equal(
    core.shouldTriggerAutoUpdateReload({ currentVersion: 'v100', remoteVersion: 'v100', nowMs: now }).shouldReload,
    false
  );

  const readyDecision = core.shouldTriggerAutoUpdateReload({
    currentVersion: 'v100',
    remoteVersion: 'v101',
    hasInFlightMutations: false,
    hasUnsavedChanges: false,
    nowMs: now
  });
  assert.equal(readyDecision.shouldReload, true);
  assert.equal(readyDecision.reason, 'new_version_detected');

  const unsavedDecision = core.shouldTriggerAutoUpdateReload({
    currentVersion: 'v100',
    remoteVersion: 'v101',
    hasInFlightMutations: false,
    hasUnsavedChanges: true,
    nowMs: now
  });
  assert.equal(unsavedDecision.shouldReload, false);
  assert.equal(unsavedDecision.reason, 'unsaved_changes');
  assert.equal(unsavedDecision.deferMs, 2500);

  const inflightDecision = core.shouldTriggerAutoUpdateReload({
    currentVersion: 'v100',
    remoteVersion: 'v101',
    hasInFlightMutations: true,
    hasUnsavedChanges: false,
    nowMs: now
  });
  assert.equal(inflightDecision.shouldReload, false);
  assert.equal(inflightDecision.reason, 'inflight_mutations');

  const loopGuardDecision = core.shouldTriggerAutoUpdateReload({
    currentVersion: 'v100',
    remoteVersion: 'v101',
    lastAttemptVer: 'v101',
    lastAttemptAt: now - 5000,
    cooldownMs: 30000,
    nowMs: now
  });
  assert.equal(loopGuardDecision.shouldReload, false);
  assert.equal(loopGuardDecision.reason, 'cooldown_antiloop');
});

test('RGCrmCore computeAdaptiveSyncDelay switches seamlessly between SSE heartbeat and 3s serverless fallback', () => {
  const core = loadCoreFromDisk();
  assert.equal(core.computeAdaptiveSyncDelay({ isOnline: false, isVisible: true, sseConnected: false }), 0);
  assert.equal(core.computeAdaptiveSyncDelay({ isOnline: true, isVisible: false, sseConnected: false }), 0);
  assert.equal(core.computeAdaptiveSyncDelay({ isOnline: true, isVisible: true, sseConnected: false, consecutiveErrors: 0 }), 3000);
  assert.equal(core.computeAdaptiveSyncDelay({ isOnline: true, isVisible: true, sseConnected: true, consecutiveErrors: 0 }), 15000);
  assert.ok(core.computeAdaptiveSyncDelay({ isOnline: true, isVisible: true, sseConnected: false, consecutiveErrors: 2 }) > 3000);
});

test('buildSpamSignature ignores originTabId and clientRequestId transport metadata', () => {
  const sigA = buildSpamSignature('addFollowUp', {
    reservationId: 'RES_1',
    notes: 'checked',
    clientRequestId: 'REQ_1',
    originTabId: 'TAB_A'
  });
  const sigB = buildSpamSignature('addFollowUp', {
    reservationId: 'RES_1',
    notes: 'checked',
    clientRequestId: 'REQ_2',
    originTabId: 'TAB_B'
  });
  assert.equal(sigA, sigB);
});

test('Mirror bundles in src/assets and backend stay byte-for-byte synchronized with root assets', () => {
  const pairs: Array<[string, string]> = [
    ['assets/js/core.js', 'backend/coreBridge.cjs'],
    ['assets/js/app.js', 'src/assets/js/app.js'],
    ['assets/js/employees.js', 'src/assets/js/employees.js']
  ];
  for (const [srcRel, dstRel] of pairs) {
    const a = fs.readFileSync(path.resolve(process.cwd(), srcRel), 'utf8');
    const b = fs.readFileSync(path.resolve(process.cwd(), dstRel), 'utf8');
    assert.equal(a, b, `Mirror mismatch between ${srcRel} and ${dstRel}`);
  }
});

test('Backend queries, router notify order, vercel headers, SW registration, and diagnostics UI wiring are intact', () => {
  const queriesSrc = fs.readFileSync(path.resolve(process.cwd(), 'backend/queries.ts'), 'utf8');
  assert.match(queriesSrc, /UPDATE reservations SET assigned_employee_ids = \$2::jsonb, assigned_employee_names = \$3::jsonb, updated_at = NOW\(\) WHERE id = \$1/);
  assert.match(queriesSrc, /UPDATE problems SET assigned_employee_ids = \$2::jsonb, assigned_employee_names = \$3::jsonb, updated_at = NOW\(\) WHERE id = \$1/);
  assert.match(queriesSrc, /changedDelegations/);
  assert.match(queriesSrc, /changedRoles/);
  assert.match(queriesSrc, /hasMoreReservations/);
  assert.match(queriesSrc, /hasMoreFollowUps/);
  assert.match(queriesSrc, /hasMoreProblems/);

  const routerSrc = fs.readFileSync(path.resolve(process.cwd(), 'backend/router.ts'), 'utf8');
  assert.match(routerSrc, /await publishPgNotify\(executor, rtEvent\)/);

  const vercelJson = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8');
  assert.match(vercelJson, /Access-Control-Expose-Headers/);
  assert.match(vercelJson, /X-App-Version/);

  const pwaRegSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pwaRegister.ts'), 'utf8');
  assert.match(pwaRegSrc, /handleSwControllerChange/);
  assert.match(pwaRegSrc, /__RG_CHECK_SW_UPDATE__/);

  const settingsSrc = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/settings.js'), 'utf8');
  assert.match(settingsSrc, /btn-check-app-update/);
  assert.match(settingsSrc, /btn-show-sync-diagnostics/);
});
