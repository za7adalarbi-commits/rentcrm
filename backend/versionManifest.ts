import fs from 'node:fs';
import path from 'node:path';

export interface AppVersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
  env: string;
}

const SERVER_BOOT_AT = new Date().toISOString();

export function readServerVersionManifest(): AppVersionManifest {
  const isProd = process.env.NODE_ENV === 'production';
  const envLabel = isProd ? 'production' : 'development';
  const rootDir = process.cwd();
  const moduleDir = typeof import.meta !== 'undefined' && (import.meta as any).dirname
    ? (import.meta as any).dirname
    : rootDir;
  const candidates = [
    path.resolve(rootDir, 'dist', 'version.json'),
    path.resolve(moduleDir, '..', 'dist', 'version.json'),
    path.resolve(rootDir, 'version.json')
  ];

  if (isProd) {
    for (const filePath of candidates) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.version) {
            return {
              version: String(parsed.version).trim(),
              buildId: String(parsed.buildId || parsed.version).trim(),
              builtAt: String(parsed.builtAt || SERVER_BOOT_AT).trim(),
              env: envLabel
            };
          }
        }
      } catch {
        // fallback below
      }
    }
  }

  const sha = String(
    process.env.VITE_BUILD_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    ''
  ).trim();
  const resolvedVer = isProd ? (sha ? sha.slice(0, 14) : SERVER_BOOT_AT) : 'dev';

  return {
    version: resolvedVer,
    buildId: resolvedVer,
    builtAt: SERVER_BOOT_AT,
    env: envLabel
  };
}

export function attachAppVersionHeaders(res: any): AppVersionManifest {
  const manifest = readServerVersionManifest();
  if (res && typeof res.setHeader === 'function') {
    try {
      res.setHeader('X-App-Version', manifest.version);
      const existingExpose = typeof res.getHeader === 'function' ? String(res.getHeader('Access-Control-Expose-Headers') || '') : '';
      if (!existingExpose) {
        res.setHeader('Access-Control-Expose-Headers', 'X-App-Version');
      } else if (!existingExpose.toLowerCase().includes('x-app-version')) {
        res.setHeader('Access-Control-Expose-Headers', `${existingExpose}, X-App-Version`);
      }
    } catch {
      // Ignore if headers already sent
    }
  }
  return manifest;
}

