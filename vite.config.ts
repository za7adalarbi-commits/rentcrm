import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const GITHUB_PAGES_BASE = '/RENT-CRM/';

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

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      // Copies and minifies assets/ into dist/ in writeBundle so Workbox precaches minified sizes
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
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['**/vendor/xlsx*.js', '**/vendor/jspdf*.js'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /\/api\//],
          ignoreURLParametersMatching: [/^v$/],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.(?:js|css|png|jpg|svg|woff2)(?:\?.*)?$/i,
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
          enabled: process.env.DISABLE_HMR !== 'true',
          type: 'module',
          navigateFallback: 'index.html',
          navigateFallbackAllowlist: [/^\/$/],
        },
      }),
      {
        name: 'rental-gate-base-assets',
        transformIndexHtml(html) {
          const normalizedBase = base === './' ? './' : (base.endsWith('/') ? base : `${base}/`);
          const defaultGasUrl = String(process.env.VITE_GAS_WEBAPP_URL || '').trim();
          const defaultBackendUrl = String(process.env.VITE_BACKEND_API_URL || '').trim();
          const baseInject = `    <script>window.__RG_BASE_URL__ = ${JSON.stringify(normalizedBase)};window.__RG_DEFAULT_GAS_URL__ = ${JSON.stringify(defaultGasUrl)};window.__RG_DEFAULT_BACKEND_API_URL__ = ${JSON.stringify(defaultBackendUrl)};</script>\n`;
          let nextHtml = html.replace('</head>', `${baseInject}  </head>`);
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
