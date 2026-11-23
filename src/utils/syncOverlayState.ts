export type SyncLang = 'ar' | 'en';

export interface SyncTask {
  requestId: string;
  action: string;
  startedAt: number;
  total?: number;
}

export interface SyncOverlayState {
  activeTasks: SyncTask[];
  dismissedBatchAt: number | null;
}

export interface SyncProgressDetail {
  phase: 'start' | 'end';
  requestId: string;
  action: string;
  timestamp?: number;
  total?: number;
  success?: boolean;
}

export type SyncOverlayEvent =
  | {
      type: 'start';
      requestId: string;
      action: string;
      nowMs?: number;
      total?: number;
    }
  | {
      type: 'end';
      requestId: string;
      nowMs?: number;
    }
  | {
      type: 'dismiss';
      nowMs?: number;
    }
  | {
      type: 'reset';
    };

export const INITIAL_SYNC_OVERLAY_STATE: SyncOverlayState = {
  activeTasks: [],
  dismissedBatchAt: null,
};

export const FOREGROUND_SYNC_ACTIONS: Readonly<Record<string, true>> = {
  syncRentalGate: true,
  pullReservations: true,
  syncLocalCache: true,
  applyUnifiedConnectionSetup: true,
  importReservationsFromExcel: true,
  deleteAllReservations: true,
  bulkReassignEmployeeReservations: true,
  syncOfflineQueue: true,
};

const ACTION_COPY_AR: Readonly<Record<string, { title: string; subtitle: string }>> = {
  syncRentalGate: {
    title: 'جاري مزامنة بيانات Rental Gate',
    subtitle: 'يتم سحب الحجوزات والتمديدات وتحديث الجداول السحابية فوراً...',
  },
  pullReservations: {
    title: 'جاري سحب وتحديث الحجوزات',
    subtitle: 'يتم مطابقة التعديلات الجديدة مع قاعدة البيانات والذاكرة المحلية...',
  },
  syncLocalCache: {
    title: 'جاري مزامنة الذاكرة المحلية',
    subtitle: 'يتم تحديث السجلات لضمان أسرع استجابة وتطابق عبر التبويبات...',
  },
  applyUnifiedConnectionSetup: {
    title: 'جاري ربط وتحديث إعدادات الاتصال',
    subtitle: 'يتم التحقق من الخادم وقاعدة البيانات وحفظ الإعدادات الموحدة...',
  },
  importReservationsFromExcel: {
    title: 'جاري استيراد الحجوزات من ملف Excel',
    subtitle: 'تتم معالجة الصفوف وحفظ السجلات الجديدة وتحديث الفلاتر...',
  },
  deleteAllReservations: {
    title: 'جاري مسح وتصفير سجل الحجوزات',
    subtitle: 'يتم تنظيف قاعدة البيانات وإعادة تهيئة الذاكرة المحلية...',
  },
  bulkReassignEmployeeReservations: {
    title: 'جاري نقل وتوزيع الحجوزات',
    subtitle: 'يتم تحديث إسناد الموظفين وتزامن الصلاحيات عبر النظام...',
  },
  syncOfflineQueue: {
    title: 'جاري رفع الإجراءات المحفوظة دون اتصال',
    subtitle: 'تتم مزامنة التحديثات المعلقة مع الخادم لضمان عدم فقدان أي تعديل...',
  },
};

const ACTION_COPY_EN: Readonly<Record<string, { title: string; subtitle: string }>> = {
  syncRentalGate: {
    title: 'Syncing Rental Gate Data',
    subtitle: 'Fetching latest reservations, extensions, and updating cloud records...',
  },
  pullReservations: {
    title: 'Pulling Latest Reservations',
    subtitle: 'Matching updates with the server and refreshing local records...',
  },
  syncLocalCache: {
    title: 'Synchronizing Local Cache',
    subtitle: 'Updating indexed records for instant filtering and cross-tab sync...',
  },
  applyUnifiedConnectionSetup: {
    title: 'Applying Connection Setup',
    subtitle: 'Verifying server endpoint, database connectivity, and configuration...',
  },
  importReservationsFromExcel: {
    title: 'Importing Reservations from Excel',
    subtitle: 'Validating spreadsheet rows and saving new records...',
  },
  deleteAllReservations: {
    title: 'Clearing All Reservations',
    subtitle: 'Cleaning database records and resetting local storage...',
  },
  bulkReassignEmployeeReservations: {
    title: 'Reassigning Reservations',
    subtitle: 'Updating employee assignments across affected bookings...',
  },
  syncOfflineQueue: {
    title: 'Syncing Offline Changes',
    subtitle: 'Uploading queued updates back to the server safely...',
  },
};

export function shouldTrackGlobalSync(
  action: string,
  payload?: Record<string, unknown> | null
): boolean {
  const cleanAction = String(action || '').trim();
  if (!cleanAction) return false;
  if (payload && (payload.silentRefresh || payload.backgroundSync)) {
    return false;
  }
  if (FOREGROUND_SYNC_ACTIONS[cleanAction]) {
    return true;
  }
  return Boolean(payload && payload.showGlobalLoading === true);
}

export function getSyncActionCopy(
  action: string,
  lang: SyncLang = 'ar'
): { title: string; subtitle: string } {
  const cleanAction = String(action || '').trim();
  if (lang === 'en') {
    return (
      ACTION_COPY_EN[cleanAction] || {
        title: 'Synchronizing System Data',
        subtitle: 'Communicating with the server and refreshing workspace state...',
      }
    );
  }
  return (
    ACTION_COPY_AR[cleanAction] || {
      title: 'جاري مزامنة بيانات النظام',
      subtitle: 'يتم التواصل مع الخادم وتحديث حالة البيانات لضمان الدقة الفورية...',
    }
  );
}

export function reduceSyncOverlayState(
  state: SyncOverlayState,
  event: SyncOverlayEvent
): SyncOverlayState {
  if (event.type === 'reset') {
    return INITIAL_SYNC_OVERLAY_STATE;
  }

  if (event.type === 'dismiss') {
    if (state.activeTasks.length === 0) return state;
    return {
      activeTasks: state.activeTasks,
      dismissedBatchAt: event.nowMs ?? Date.now(),
    };
  }

  if (event.type === 'start') {
    const cleanId = String(event.requestId || '').trim();
    if (!cleanId) return state;
    const cleanAction = String(event.action || 'sync').trim();
    const nowMs = typeof event.nowMs === 'number' ? event.nowMs : Date.now();
    const exists = state.activeTasks.some((t) => t.requestId === cleanId);
    if (exists) return state;

    const nextTask: SyncTask = {
      requestId: cleanId,
      action: cleanAction,
      startedAt: nowMs,
      total: typeof event.total === 'number' && event.total > 0 ? event.total : undefined,
    };

    return {
      activeTasks: [...state.activeTasks, nextTask],
      // Re-open if a fresh sync batch starts when no tasks were active before
      dismissedBatchAt: state.activeTasks.length === 0 ? null : state.dismissedBatchAt,
    };
  }

  if (event.type === 'end') {
    const cleanId = String(event.requestId || '').trim();
    const nextTasks = cleanId
      ? state.activeTasks.filter((t) => t.requestId !== cleanId)
      : state.activeTasks.slice(0, -1);

    return {
      activeTasks: nextTasks,
      dismissedBatchAt: nextTasks.length === 0 ? null : state.dismissedBatchAt,
    };
  }

  return state;
}

export function isSyncOverlayVisible(state: SyncOverlayState): boolean {
  return state.activeTasks.length > 0 && state.dismissedBatchAt === null;
}

export function formatElapsedSeconds(
  startedAt: number,
  nowMs: number,
  lang: SyncLang = 'ar'
): string {
  const diffSec = Math.max(0, (nowMs - startedAt) / 1000);
  const rounded = diffSec < 10 ? diffSec.toFixed(1) : String(Math.floor(diffSec));
  return lang === 'en' ? `${rounded}s` : `${rounded} ث`;
}
