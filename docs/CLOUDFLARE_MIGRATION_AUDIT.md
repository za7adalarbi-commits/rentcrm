# Cloudflare Migration Audit Report — Rental Gate CRM

**Audit Date:** 2026-11-18  
**Target Platform:** Cloudflare Workers (with Workers Static Assets) + Neon PostgreSQL  
**Source Platform:** Vercel Serverless (`/api/*`) + Node.js/Express (`server.ts`) + GitHub Pages (`.github/workflows/deploy.yml`)

---

## 1. Current Project Architecture (Verified from Source)

### 1.1 Frontend & Build System
- **Build tool:** Vite `8.3.0` (`vite.config.ts`) + `@tailwindcss/vite` (`src/index.css`).
- **Actual SPA Architecture:** Multi-module Vanilla JS + HTML/CSS application loaded by `/index.html`:
  - `assets/js/config.js`, `core.js`, `idb.js` (IndexedDB offline/instant cache), `api.js` (API transport + SWR cache + local sandbox), `auth.js`, `dashboard.js`, `reports.js`, `reservations.js`, `followups.js`, `problems.js`, `employees.js`, `settings.js`, `app.js`.
  - `assets/vendor/chart.umd.min.js`, `xlsx.full.min.js` (SheetJS Excel export), `jspdf.umd.min.js` (client-side RTL Arabic PDF export).
  - *Note:* `src/main.tsx` and `src/App.tsx` exist from the starter template and are unused by `index.html`.
- **Vite Copy Hook:** `copy-unbundled-src-assets` copies `/assets` and `/src/assets` into `/dist` during `vite build`, and writes `dist/.nojekyll` + `dist/404.html`.
- **Routing:** Client-side hash/path routing (`dashboard`, `reservations`, `my-followups`, `team-followups`, `problems`, `reports`, `employees`, `activity`, `settings`) resolved via `assets/js/core.js`.

### 1.2 Backend Architecture & API Routes
- **Local / Standalone Node Server (`server.ts`):** Express `4.21.2` serving `/api/health`, `/api/crm`, `/api/sync`, and Vite dev middleware (or static `dist/` in production) on port `3000`.
- **Vercel Serverless Functions (`vercel.json`):**
  - `GET /api/health` (`api/health.ts`) — checks `DATABASE_URL` presence and runs `SELECT 1`.
  - `POST|OPTIONS /api/crm` (`api/crm.ts`) — parses JSON/`text/plain` body and delegates ~35 authenticated & public RPC actions (`login`, `logout`, `getMe`, `getAppBootstrap`, `getDashboard`, `getReservations`, `syncLocalCache`, `getReservationDetails`, `claimReservation`, `unclaimReservation`, `quickUpdateReservationStatus`, `updateReservationDetails`, `addFollowUp`, `updateFollowUp`, `getFollowUpHistory`, `assignEmployees`, `removeAssignment`, `getMyFollowUps`, `getTeamFollowUps`, `createProblem`, `updateProblem`, `getProblems`, `getProblemDetails`, `getEmployees`, `getEmployeeDetails`, `createEmployee`, `updateEmployee`, `disableEmployee`, `saveRolePreset`, `deleteRolePreset`, `resetRolePresets`, `savePermissionDefinition`, `deletePermissionDefinition`, `getActivityLogs`, `getNotifications`, `markNotificationRead`, `pullReservations`, `syncRentalGate`, `testConnection`, `saveApiToken`, `getSyncStatus`, `getTriggerStatus`, `getReports`, `exportReportData`, `getSettings`, `updateSettings`) to `backend/router.ts`.
  - `GET|POST|OPTIONS /api/sync` (`api/sync.ts`) — shared-secret (`SYNC_API_SECRET`) endpoint for Google Apps Script incremental batch ingest (`ingestIncrementalSyncBatch`) and outbox write-back (`flushSheetsMirrorOutbox`).

### 1.3 Database & Schema
- **Database:** Neon PostgreSQL (`pg` `Pool` in `backend/db.ts`).
- **Schema (`database/schema.sql`):** 20 tables (`users`, `employees`, `reservations`, `extensions`, `assignments`, `follow_ups`, `follow_up_history`, `problems`, `issues`, `problem_updates`, `activity_log`, `notifications`, `settings`, `roles`, `permissions`, `sessions`, `sync_log`, `sync_checkpoints`, `sheets_mirror_outbox`, `error_logs`) with `pg_trgm` GIN indexes, B-tree indexes, foreign keys, and ACID transactions (`BEGIN`/`COMMIT`/`ROLLBACK`). No Drizzle/Prisma ORM; raw parameterized SQL via `DbExecutor`.

### 1.4 External Integrations
- **Google Apps Script (`google-apps-script/*.gs`):** Pulls reservations & extensions from Rental Gate API (`https://api.rentalgate.net/api`), mirrors to Google Sheets, pushes incremental changes to `/api/sync`, and receives reverse updates via `syncFromNeonMirror` (`GAS_WEBAPP_URL`).
- **Rental Gate API:** Direct optional server pull (`RG_TOKEN` + `fetch`).
- **Exports:** 100% client-side in `assets/js/reports.js` using SheetJS (`xlsx`) and `jsPDF` + Canvas, plus GAS `Export.gs` CSV/JSON string generation.

### 1.5 File Uploads & Attachments
- **Finding:** There are **no** server-side file upload endpoints, multipart handlers, `multer` middleware, `DriveApp` upload flows, or attachment tables in the current codebase. Therefore, **Cloudflare R2 is not required** for current functionality (documented as optional for future attachment features).

### 1.6 Scheduled Tasks & Background Processes
- **Vercel Cron:** None configured in `vercel.json`.
- **Google Apps Script Triggers (`Triggers.gs`, `NeonSync.gs`):**
  - `scheduledAutoSync` (12h default, configurable 1–168h).
  - `scheduledMinuteSync` (every 1 minute incremental pull & push to `/api/sync`).
- **Outbox Mirror Flush:** Triggered asynchronously after CRM mutations (`flushSheetsMirrorOutbox(executor).catch(...)`) and during `/api/sync`.

### 1.7 Environment Variables
- **Server-side:** `DATABASE_URL` (fallback `POSTGRES_URL`, `NEON_DATABASE_URL`), `SYNC_API_SECRET`, `GAS_WEBAPP_URL`, `RG_TOKEN`, `RG_API_BASE_URL`, `PG_POOL_MAX`, `PGSSLMODE`, `SEED_ADMIN_PASSWORD`, `SEED_SUPERVISOR_PASSWORD`, `SEED_AGENT_PASSWORD`.
- **Frontend build-time (public):** `VITE_BACKEND_API_URL`, `VITE_GAS_WEBAPP_URL`, `VITE_BASE_PATH`.

---

## 2. Cloudflare Compatibility Analysis

| Component | Current Implementation | Cloudflare Workers Compatibility | Required Action |
|---|---|---|---|
| Frontend SPA (`dist/`) | Vite build + static `assets/` | **Compatible** (Workers Static Assets / Pages) | Set `not_found_handling: "single-page-application"`, skip `404.html` outside GitHub Pages |
| `backend/db.ts` (`pg`) | `node-postgres` TCP `Pool` | **Incompatible without Hyperdrive/polyfills** | Add Cloudflare adapter using `@neondatabase/serverless` (WebSocket `Pool` + Hyperdrive support) |
| `backend/db.ts` (`fs.readFileSync`) | Reads `database/schema.sql` from disk | **Incompatible** (no runtime filesystem in Workers) | Inline `SCHEMA_SQL` constant in `backend/schemaSql.ts` |
| `backend/auth.ts` (`createRequire`) | Dynamic `require('../assets/js/core.js')` | **Incompatible** in bundled Worker | Replace with static import so bundler includes `core.js` |
| `backend/*.ts` (`process.env`) | Reads/writes `process.env` directly | **Partial** (`env` bindings passed to Worker `fetch(req, env, ctx)`) | Add `backend/env.ts` supporting both `process.env` and Worker `env` context |
| `backend/queries.ts` (`process.env.RG_TOKEN = ...`) | Mutates `process.env` at runtime | **Non-persistent in Workers isolates** | Use safe runtime setter + GAS forwarding; document Worker Secrets via Wrangler |
| Fire-and-forget outbox calls | `.catch(() => undefined)` unawaited promises | **May be aborted early in Workers** | Register background outbox promises via `ctx.waitUntil(...)` |
| `node:crypto` | `sha256Hex`, `timingSafeEqual`, `randomUUID` | **Compatible** with `nodejs_compat` flag | Enable `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` |
| Express `server.ts` / Vercel `/api/*.ts` | Node HTTP & Vercel handler signatures `(req, res)` | **Not used by Workers**, must stay intact for Vercel/local | Add Web-standard Worker entrypoint (`backend/worker.ts`) calling shared `dispatchCrmRequest` / `syncService` |
| PDF & Excel Exports | Client-side Canvas + `jsPDF` + `XLSX` | **100% Compatible** | No server changes needed |

---

## 3. Required Changes & Potential Breaking Changes

### Required Changes
1. Install `@neondatabase/serverless` (and `@cloudflare/workers-types` for TypeScript checking) to enable Neon PostgreSQL queries and ACID transactions in Cloudflare Workers without requiring paid Hyperdrive.
2. Create `backend/env.ts` to unify runtime environment lookup across Node.js/Vercel (`process.env`) and Cloudflare Workers (`env` binding via `AsyncLocalStorage` + explicit passing), and handle `registerBackgroundTask` (`ctx.waitUntil` in Workers).
3. Create `backend/schemaSql.ts` containing the exact SQL from `database/schema.sql` so `ensureSchemaInitialized` never needs `fs.readFileSync` in Workers.
4. Refactor `backend/auth.ts` to statically import `../assets/js/core.js` instead of `createRequire`.
5. Create `backend/cfDb.ts` providing a request-scoped `@neondatabase/serverless` `Pool` (`DbExecutor` with `query`, `withTransaction`, and `close`) that automatically uses `env.HYPERDRIVE.connectionString` when bound or falls back to `env.DATABASE_URL`.
6. Create `backend/worker.ts` (Cloudflare Worker entry point) implementing:
   - `fetch(request, env, ctx)`: `/api/health`, `/api/crm`, `/api/sync`, CORS security headers, `ASSETS` static asset fallback.
   - `scheduled(controller, env, ctx)`: Cloudflare Cron Trigger handler flushing `sheets_mirror_outbox` and running auto-sync checks.
7. Add `wrangler.jsonc`, `.dev.vars.example`, update `.env.example`, `.gitignore`, `vite.config.ts` (conditional `404.html`), `package.json` (`cf:dev`, `cf:deploy`, `cf:typecheck` scripts), and comprehensive deployment documentation.

### Potential Breaking Changes & Mitigations
- **Background Promises Terminated Early:** Workers terminate unawaited Promises once a `Response` is returned. *Mitigation:* `backend/env.ts` tracks background promises via `ctx.waitUntil` when running inside a Worker.
- **GitHub Pages `404.html` Redirect Breaking SPA Deep Links on Cloudflare:** `vite.config.ts` previously emitted `dist/404.html` on every build. *Mitigation:* Emit `404.html` only for GitHub Pages (`GITHUB_ACTIONS` / `GITHUB_PAGES` / `/RENT-CRM/`), while Cloudflare Workers Static Assets uses `"not_found_handling": "single-page-application"`.
- **In-memory `RG_TOKEN` Save from UI (`saveApiToken`):** Updating `RG_TOKEN` from the Settings UI cannot permanently mutate Cloudflare Worker environment secrets across isolates. *Mitigation:* Forwarding to Google Apps Script `ScriptProperties` still works immediately; for direct Worker pulls (`RG_TOKEN`), set the secret via Cloudflare Dashboard or `wrangler secret put RG_TOKEN` (clearly documented).
- **Free-Tier Cron & Neon Compute Quota:** Running a Cloudflare Cron Trigger every 1 minute keeps Neon compute awake continuously (~720 hrs/month vs 100 CU-hours free limit). *Mitigation:* Configure Cloudflare Cron Trigger at `*/15 * * * *` (every 15 minutes) by default (adjustable down to `* * * * *` in `wrangler.jsonc`), while Google Apps Script triggers remain intact.
