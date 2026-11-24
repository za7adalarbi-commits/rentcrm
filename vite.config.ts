import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const GITHUB_PAGES_BASE = '/RENT-CRM/';

function resolveBuildVersion(command: 'build' | 'serve'): string {
  if (command === 'serve') {
    return 'dev';
  }
  const explicit = String(
    process.env.VITE_BUILD_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    ''
  ).trim();
  if (explicit) {
    return explicit.slice(0, 14);
  }
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${ts}-${rand}`;
}

function isGitHubPagesBuild(): boolean {
  return process.env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_PAGES === 'true';
}

function resolveBasePath(_command: 'build' | 'serve'): string {
  if (process.env.VITE_BASE_PATH) {
    return process.env.VITE_BASE_PATH;
  }
  if (isGitHubPagesBuild()) {
    return GITHUB_PAGES_BASE;
  }
  return '/';
}

function buildSpa404Html(basePath: string): string {
  const normalizedBase = basePath === './' ? './' : (basePath.endsWith('/') ? basePath : `${basePath}/`);
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RENTAL GATE CRM</title>
    <script>
      (function () {
        var base = ${JSON.stringify(normalizedBase)};
        var pathname = window.location.pathname || '/';
        var cleanBase = base === './' ? '/' : base;
        var relative = pathname.indexOf(cleanBase) === 0
          ? pathname.slice(cleanBase.length)
          : pathname.replace(/^\\//, '');
        var route = relative.replace(/^\\/+|\\/+$/g, '').split('/')[0] || '';
        if (route && route !== 'index.html' && route !== '404.html') {
          try {
            sessionStorage.setItem('rg_crm_redirect_route', route);
          } catch (e) {}
        }
        var target = (base === './' ? './' : cleanBase) + (route && route !== 'index.html' && route !== '404.html' ? ('#' + encodeURIComponent(route)) : '');
        window.location.replace(target);
      })();
    </script>
  </head>
  <body></body>
</html>
`;
}

function walkFilesRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dirPath, {withFileTypes: true})) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function minifyCopiedAssets(distAssetsDir: string): void {
  const vendorDir = `${path.sep}vendor${path.sep}`;
  for (const filePath of walkFilesRecursive(distAssetsDir)) {
    if (filePath.includes(vendorDir)) continue;
    const isJs = filePath.endsWith('.js');
    const isCss = filePath.endsWith('.css');
    if (!isJs && !isCss) continue;
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      const result = esbuild.transformSync(source, {
        loader: isJs ? 'js' : 'css',
        minify: true,
        legalComments: 'none',
        charset: 'utf8',
      });
      if (result && typeof result.code === 'string' && result.code.length > 0 && result.code.length < source.length) {
        fs.writeFileSync(filePath, result.code, 'utf8');
      }
    } catch {
      // Preserve unminified asset if transform fails
    }
  }
}

export default defineConfig(({command}) => {
  const base = resolveBasePath(command);
  const rootDir = import.meta.dirname;
  const pwaScope = base === './' ? '/' : base;
  const buildVersion = resolveBuildVersion(command);
  const builtAtIso = new Date().toISOString();

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      // Copies and minifies assets/, stamps dist/version.json before Workbox manifest generation
      {
        name: 'copy-and-minify-assets',
        apply: 'build',
        writeBundle(): void {
          const distDir = path.resolve(rootDir, 'dist');
          const rootAssets = path.resolve(rootDir, 'assets');
          const distRootAssets = path.resolve(distDir, 'assets');
          if (fs.existsSync(distDir) && fs.existsSync(rootAssets)) {
            fs.cpSync(rootAssets, distRootAssets, {recursive: true, force: true});
            minifyCopiedAssets(distRootAssets);
          }
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(path.resolve(distDir, '.nojekyll'), '', 'utf8');
            fs.writeFileSync(path.resolve(distDir, '404.html'), buildSpa404Html(base), 'utf8');
            fs.writeFileSync(
              path.resolve(distDir, 'version.json'),
              JSON.stringify({
                version: buildVersion,
                buildId: buildVersion,
                builtAt: builtAtIso,
                env: 'production',
              }, null, 2),
              'utf8'
            );
          }
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: pwaScope,
          name: 'RENTAL GATE CRM',
          short_name: 'RG CRM',
          description: 'نظام إدارة الحجوزات والمتابعات وتشغيل الورديات لشركة Rental Gate',
          lang: 'ar',
          dir: 'rtl',
          theme_color: '#6b1d2f',
          background_color: '#faf7f7',
          display: 'standalone',
          orientation: 'any',
          scope: pwaScope,
          start_url: pwaScope,
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,webp,svg,woff2}'],
          globIgnores: ['**/vendor/xlsx*.js', '**/vendor/jspdf*.js', '**/version.json'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /\/api\//, /\/version\.json$/],
          ignoreURLParametersMatching: [/^v$/],
          runtimeCaching: [
            {
              urlPattern: /\/version\.json(?:\?.*)?$/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/assets\/js\/config\.js(?:\?.*)?$/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/assets\/.*\.(?:js|css)(?:\?.*)?$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'rg-crm-code-cache',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
              },
            },
            {
              urlPattern: /\/assets\/.*\.(?:png|jpg|jpeg|gif|svg|webp|woff2?)(?:\?.*)?$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'rg-crm-assets-cache',
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60 * 60 * 24 * 14,
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
      {
        name: 'rental-gate-base-assets',
        transformIndexHtml(html) {
          const normalizedBase = base === './' ? './' : (base.endsWith('/') ? base : `${base}/`);
          const defaultGasUrl = String(process.env.VITE_GAS_WEBAPP_URL || '').trim();
          const defaultBackendUrl = String(process.env.VITE_BACKEND_API_URL || '').trim();
          const baseInject = `    <script>window.__RG_BASE_URL__ = ${JSON.stringify(normalizedBase)};window.__RG_BUILD_VERSION__ = ${JSON.stringify(buildVersion)};window.__RG_BUILD_AT__ = ${JSON.stringify(builtAtIso)};window.__RG_DEFAULT_GAS_URL__ = ${JSON.stringify(defaultGasUrl)};window.__RG_DEFAULT_BACKEND_API_URL__ = ${JSON.stringify(defaultBackendUrl)};</script>\n`;
          let nextHtml = html.replace('</head>', `${baseInject}  </head>`);
          nextHtml = nextHtml.replace(/var BUILD_VER = '[^']*';/, `var BUILD_VER = ${JSON.stringify(buildVersion)};`);
          nextHtml = nextHtml.replace(/((?:\.|\/)?(?:assets|src)\/[^"']+\.(?:js|css))\?v=[A-Za-z0-9._-]+/g, `$1?v=${buildVersion}`);
          if (normalizedBase !== './') {
            nextHtml = nextHtml.replace(/(src|href)="\.\/(assets\/|src\/|apple-touch-icon\.png)/g, `$1="${normalizedBase}$2`);
          }
          return nextHtml;
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
