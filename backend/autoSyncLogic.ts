/**
 * Pure domain logic for Rental Gate CRM Automatic Sync scheduling,
 * validation (1s .. 12h), retry backoff, and monitoring status derivation.
 */

export const MIN_AUTO_SYNC_SECONDS = 1;
export const MAX_AUTO_SYNC_SECONDS = 43200; // 12 hours
export const DEFAULT_AUTO_SYNC_SECONDS = 43200; // 12 hours default
export const MAX_RETRY_BACKOFF_SECONDS = 300; // 5 minutes ceiling for backoff retries

export type AutoSyncUnit = 'seconds' | 'minutes' | 'hours';
export type AutoSyncWorkerStatus = 'running' | 'stopped' | 'error';

export interface AutoSyncConfigNormalized {
  enabled: boolean;
  intervalSeconds: number;
  value: number;
  unit: AutoSyncUnit;
  legacyHours: number;
  legacyMinutes: number;
}

export interface AutoSyncValidationResult {
  valid: boolean;
  error: string;
  intervalSeconds: number;
  value: number;
  unit: AutoSyncUnit;
  legacyHours: number;
  legacyMinutes: number;
}

export interface NextRunCalculationInput {
  enabled: boolean;
  intervalSeconds: number;
  nowMs: number;
  currentNextRunAt?: string | Date | null;
  lastRunAt?: string | Date | null;
  consecutiveErrors?: number;
  reason: 'startup' | 'config_changed' | 'auto_completed' | 'auto_error' | 'manual_completed';
}

function toAsciiDigits(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .trim();
}

export function normalizeAutoSyncUnit(rawUnit: unknown): AutoSyncUnit {
  const clean = String(rawUnit ?? '').trim().toLowerCase();
  if (clean === 'seconds' || clean === 'second' || clean === 's' || clean === 'sec') return 'seconds';
  if (clean === 'minutes' || clean === 'minute' || clean === 'm' || clean === 'min') return 'minutes';
  if (clean === 'hours' || clean === 'hour' || clean === 'h' || clean === 'hr') return 'hours';
  return 'seconds';
}

export function unitToSecondsMultiplier(unit: AutoSyncUnit): number {
  if (unit === 'hours') return 3600;
  if (unit === 'minutes') return 60;
  return 1;
}

export function deriveBestValueAndUnit(intervalSeconds: number): { value: number; unit: AutoSyncUnit } {
  const sec = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(intervalSeconds)));
  if (sec % 3600 === 0) return { value: sec / 3600, unit: 'hours' };
  if (sec % 60 === 0) return { value: sec / 60, unit: 'minutes' };
  return { value: sec, unit: 'seconds' };
}

export function computeLegacyHoursMinutes(intervalSeconds: number): { hours: number; minutes: number } {
  const clamped = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(intervalSeconds)));
  const totalMin = Math.max(1, Math.round(clamped / 60));
  return {
    hours: Math.floor(totalMin / 60),
    minutes: totalMin % 60
  };
}

export function validateAutoSyncSettingsInput(input: {
  enabled?: boolean;
  value?: unknown;
  unit?: unknown;
  intervalSeconds?: unknown;
  hours?: unknown;
  minutes?: unknown;
}): AutoSyncValidationResult {
  const hasValueUnit =
    input.value !== undefined && input.value !== null && toAsciiDigits(input.value) !== '';
  const hasIntervalSec =
    input.intervalSeconds !== undefined &&
    input.intervalSeconds !== null &&
    toAsciiDigits(input.intervalSeconds) !== '';
  const hasHoursOrMin =
    (input.hours !== undefined && input.hours !== null && toAsciiDigits(input.hours) !== '') ||
    (input.minutes !== undefined && input.minutes !== null && toAsciiDigits(input.minutes) !== '');

  let unit: AutoSyncUnit = normalizeAutoSyncUnit(input.unit || 'seconds');
  let rawSeconds: number;
  let parsedDisplayValue: number;

  if (hasValueUnit) {
    const numStr = toAsciiDigits(input.value);
    const numVal = Number(numStr);
    if (!numStr || !Number.isFinite(numVal)) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: يرجى إدخال رقم صحيح لفترة المزامنة التلقائية.',
        intervalSeconds: DEFAULT_AUTO_SYNC_SECONDS,
        value: 12,
        unit: 'hours',
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    const mult = unitToSecondsMultiplier(unit);
    const exactSeconds = numVal * mult;
    if (exactSeconds < MIN_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).',
        intervalSeconds: MIN_AUTO_SYNC_SECONDS,
        value: numVal,
        unit,
        legacyHours: 0,
        legacyMinutes: 1
      };
    }
    if (exactSeconds > MAX_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
        intervalSeconds: MAX_AUTO_SYNC_SECONDS,
        value: numVal,
        unit,
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    rawSeconds = Math.round(exactSeconds);
    parsedDisplayValue = Number.isInteger(numVal) ? numVal : rawSeconds;
    if (!Number.isInteger(numVal)) {
      const derived = deriveBestValueAndUnit(rawSeconds);
      parsedDisplayValue = derived.value;
      unit = derived.unit;
    }
  } else if (hasIntervalSec) {
    const secStr = toAsciiDigits(input.intervalSeconds);
    const secNum = Number(secStr);
    if (!secStr || !Number.isFinite(secNum)) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: يرجى إدخال رقم صحيح لفترة المزامنة التلقائية.',
        intervalSeconds: DEFAULT_AUTO_SYNC_SECONDS,
        value: 12,
        unit: 'hours',
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    if (secNum < MIN_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).',
        intervalSeconds: MIN_AUTO_SYNC_SECONDS,
        value: secNum,
        unit: 'seconds',
        legacyHours: 0,
        legacyMinutes: 1
      };
    }
    if (secNum > MAX_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
        intervalSeconds: MAX_AUTO_SYNC_SECONDS,
        value: secNum,
        unit: 'seconds',
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    rawSeconds = Math.round(secNum);
    const derived = input.unit ? { value: Math.max(1, Math.round(rawSeconds / unitToSecondsMultiplier(unit))), unit } : deriveBestValueAndUnit(rawSeconds);
    if (input.unit && derived.value * unitToSecondsMultiplier(unit) !== rawSeconds) {
      const best = deriveBestValueAndUnit(rawSeconds);
      parsedDisplayValue = best.value;
      unit = best.unit;
    } else {
      parsedDisplayValue = derived.value;
      unit = derived.unit;
    }
  } else if (hasHoursOrMin) {
    const h = Number(toAsciiDigits(input.hours ?? 0) || '0');
    const m = Number(toAsciiDigits(input.minutes ?? 0) || '0');
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: قيم الساعات والدقائق يجب أن تكون أرقاماً صالحة غير سالبة.',
        intervalSeconds: DEFAULT_AUTO_SYNC_SECONDS,
        value: 12,
        unit: 'hours',
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    const exactSeconds = Math.round(h * 3600 + m * 60);
    if (exactSeconds < MIN_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).',
        intervalSeconds: MIN_AUTO_SYNC_SECONDS,
        value: 0,
        unit: 'minutes',
        legacyHours: 0,
        legacyMinutes: 1
      };
    }
    if (exactSeconds > MAX_AUTO_SYNC_SECONDS) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR: الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
        intervalSeconds: MAX_AUTO_SYNC_SECONDS,
        value: 12,
        unit: 'hours',
        legacyHours: 12,
        legacyMinutes: 0
      };
    }
    rawSeconds = exactSeconds;
    const derived = deriveBestValueAndUnit(rawSeconds);
    parsedDisplayValue = derived.value;
    unit = derived.unit;
  } else {
    rawSeconds = DEFAULT_AUTO_SYNC_SECONDS;
    parsedDisplayValue = 12;
    unit = 'hours';
  }

  const legacy = computeLegacyHoursMinutes(rawSeconds);
  return {
    valid: true,
    error: '',
    intervalSeconds: rawSeconds,
    value: parsedDisplayValue,
    unit,
    legacyHours: legacy.hours,
    legacyMinutes: legacy.minutes
  };
}

export function normalizeAutoSyncConfig(settingsMap: Record<string, any> = {}): AutoSyncConfigNormalized {
  const enabled = settingsMap.auto_sync_enabled === false || settingsMap.auto_sync_enabled === 'false'
    ? false
    : true;

  const hasSec =
    settingsMap.auto_sync_interval_seconds !== undefined &&
    settingsMap.auto_sync_interval_seconds !== null &&
    String(settingsMap.auto_sync_interval_seconds).trim() !== '';

  let intervalSeconds = DEFAULT_AUTO_SYNC_SECONDS;
  if (hasSec) {
    const parsedSec = Number(toAsciiDigits(settingsMap.auto_sync_interval_seconds));
    if (Number.isFinite(parsedSec)) {
      intervalSeconds = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(parsedSec)));
    }
  } else if (
    settingsMap.auto_sync_interval_hours !== undefined ||
    settingsMap.auto_sync_interval_minutes !== undefined
  ) {
    const h = Number(toAsciiDigits(settingsMap.auto_sync_interval_hours ?? 0) || '0');
    const m = Number(toAsciiDigits(settingsMap.auto_sync_interval_minutes ?? 0) || '0');
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const calc = Math.round(Math.max(0, h) * 3600 + Math.max(0, m) * 60);
      if (calc > 0) {
        intervalSeconds = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, calc));
      }
    }
  }

  const best = deriveBestValueAndUnit(intervalSeconds);
  let value = best.value;
  let unit = best.unit;
  if (settingsMap.auto_sync_interval_unit && settingsMap.auto_sync_interval_value !== undefined) {
    const explicitUnit = normalizeAutoSyncUnit(settingsMap.auto_sync_interval_unit);
    const explicitVal = Number(toAsciiDigits(settingsMap.auto_sync_interval_value));
    if (
      Number.isFinite(explicitVal) &&
      explicitVal >= 1 &&
      Math.round(explicitVal * unitToSecondsMultiplier(explicitUnit)) === intervalSeconds
    ) {
      value = Math.round(explicitVal);
      unit = explicitUnit;
    }
  }

  const legacy = computeLegacyHoursMinutes(intervalSeconds);
  return {
    enabled,
    intervalSeconds,
    value,
    unit,
    legacyHours: legacy.hours,
    legacyMinutes: legacy.minutes
  };
}

export function computeRetryBackoffSeconds(intervalSeconds: number, consecutiveErrors: number): number {
  const base = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(intervalSeconds || DEFAULT_AUTO_SYNC_SECONDS)));
  const errCount = Math.max(0, Math.round(consecutiveErrors || 0));
  if (errCount <= 0) return base;
  // For short intervals (e.g. 1s..30s), gently back off without flooding API, capped at 5 minutes (or intervalSeconds if larger)
  const exp = Math.min(6, errCount - 1);
  const backoffFloor = Math.min(MAX_RETRY_BACKOFF_SECONDS, Math.max(base, base * Math.pow(2, exp)));
  return Math.min(MAX_AUTO_SYNC_SECONDS, Math.max(base, Math.round(backoffFloor)));
}

export function computeNextScheduledRunAt(input: NextRunCalculationInput): string | null {
  if (!input.enabled) return null;
  const intervalMs = Math.max(
    MIN_AUTO_SYNC_SECONDS * 1000,
    Math.min(MAX_AUTO_SYNC_SECONDS * 1000, Math.round((input.intervalSeconds || DEFAULT_AUTO_SYNC_SECONDS) * 1000))
  );
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const parseTs = (v: string | Date | null | undefined): number | null => {
    if (!v) return null;
    const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
    return Number.isFinite(ms) ? ms : null;
  };
  const existingNextMs = parseTs(input.currentNextRunAt);
  const lastRunMs = parseTs(input.lastRunAt);

  if (input.reason === 'manual_completed') {
    // Preserve auto-sync cadence! Do NOT push out or reset an active upcoming auto-sync schedule.
    if (existingNextMs !== null && existingNextMs > nowMs + 250) {
      return new Date(Math.min(existingNextMs, nowMs + intervalMs)).toISOString();
    }
    if (existingNextMs !== null) {
      return new Date(existingNextMs).toISOString();
    }
    return new Date(nowMs + intervalMs).toISOString();
  }

  if (input.reason === 'config_changed') {
    // Immediate activation on save: schedule now + new interval (or sooner if overdue relative to lastRunAt)
    if (lastRunMs !== null && nowMs - lastRunMs >= intervalMs) {
      // Run immediately on next tick (~250ms) because the newly shrunk interval has already elapsed
      return new Date(nowMs + 250).toISOString();
    }
    if (lastRunMs !== null) {
      return new Date(Math.max(nowMs + 250, lastRunMs + intervalMs)).toISOString();
    }
    return new Date(nowMs + intervalMs).toISOString();
  }

  if (input.reason === 'startup') {
    if (existingNextMs !== null) {
      // If server/worker restarted while scheduled run was in the future within interval, keep it; if overdue, run immediately
      if (existingNextMs <= nowMs) {
        return new Date(nowMs + 250).toISOString();
      }
      return new Date(Math.min(existingNextMs, nowMs + intervalMs)).toISOString();
    }
    if (lastRunMs !== null) {
      const target = lastRunMs + intervalMs;
      return new Date(target <= nowMs ? nowMs + 250 : target).toISOString();
    }
    // Initial startup with never-run state: run shortly after boot
    return new Date(nowMs + Math.min(intervalMs, 3000)).toISOString();
  }

  if (input.reason === 'auto_error') {
    const backoffSec = computeRetryBackoffSeconds(input.intervalSeconds, Number(input.consecutiveErrors || 1));
    return new Date(nowMs + backoffSec * 1000).toISOString();
  }

  // 'auto_completed': next run strictly after previous finishes (no overlap)
  return new Date(nowMs + intervalMs).toISOString();
}

export function deriveWorkerStatus(input: {
  enabled: boolean;
  isSyncing?: boolean;
  consecutiveErrors?: number;
  lastError?: string;
}): AutoSyncWorkerStatus {
  if (!input.enabled && !input.isSyncing) return 'stopped';
  if (Number(input.consecutiveErrors || 0) > 0 && String(input.lastError || '').trim() !== '') {
    return 'error';
  }
  return input.enabled ? 'running' : 'stopped';
}
