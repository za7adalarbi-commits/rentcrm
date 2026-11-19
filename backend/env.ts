import { AsyncLocalStorage } from 'node:async_hooks';

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface WorkerHyperdriveBinding {
  connectionString: string;
}

export interface WorkerAssetsBinding {
  fetch(request: Request | URL | string, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnvBindings {
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
  NEON_DATABASE_URL?: string;
  HYPERDRIVE?: WorkerHyperdriveBinding;
  SYNC_API_SECRET?: string;
  GAS_WEBAPP_URL?: string;
  RG_TOKEN?: string;
  RG_API_BASE_URL?: string;
  PG_POOL_MAX?: string;
  PGSSLMODE?: string;
  SEED_ADMIN_PASSWORD?: string;
  SEED_SUPERVISOR_PASSWORD?: string;
  SEED_AGENT_PASSWORD?: string;
  CORS_ALLOWED_ORIGINS?: string;
  NODE_ENV?: string;
  ASSETS?: WorkerAssetsBinding;
  [key: string]: any;
}

interface RuntimeContextStore {
  env: WorkerEnvBindings;
  ctx?: WorkerExecutionContext;
  overrides: Record<string, string>;
}

const runtimeStorage = new AsyncLocalStorage<RuntimeContextStore>();
const globalOverrides: Record<string, string> = {};

export function runWithWorkerContext<T>(
  env: WorkerEnvBindings,
  ctx: WorkerExecutionContext | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return runtimeStorage.run({ env: env || {}, ctx, overrides: {} }, fn);
}

export function getActiveWorkerEnv(): WorkerEnvBindings | null {
  return runtimeStorage.getStore()?.env || null;
}

export function getEnv(key: string, fallback = ''): string {
  const store = runtimeStorage.getStore();
  if (store) {
    if (store.overrides[key] !== undefined) {
      return String(store.overrides[key]);
    }
    const bound = store.env?.[key];
    if (typeof bound === 'string' && bound !== '') {
      return bound;
    }
  }
  if (globalOverrides[key] !== undefined) {
    return String(globalOverrides[key]);
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return String(process.env[key] || '');
  }
  return fallback;
}

export function setRuntimeEnv(key: string, value: string): void {
  const clean = String(value ?? '');
  const store = runtimeStorage.getStore();
  if (store) {
    store.overrides[key] = clean;
  } else {
    globalOverrides[key] = clean;
  }
  try {
    if (typeof process !== 'undefined' && process.env) {
      process.env[key] = clean;
    }
  } catch {
    // process.env may be immutable in restricted edge runtimes
  }
}

export function registerBackgroundTask(promise: Promise<unknown>): void {
  const safePromise = Promise.resolve(promise).catch(() => undefined);
  const store = runtimeStorage.getStore();
  if (store?.ctx && typeof store.ctx.waitUntil === 'function') {
    try {
      store.ctx.waitUntil(safePromise);
    } catch {
      // ignore if waitUntil already settled
    }
  }
}

export function isCloudflareWorkerRuntime(): boolean {
  return Boolean(runtimeStorage.getStore()?.env) || typeof (globalThis as any).WebSocketPair !== 'undefined';
}
