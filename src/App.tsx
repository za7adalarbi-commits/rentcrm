import { useEffect, useMemo, useReducer, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  INITIAL_SYNC_OVERLAY_STATE,
  SyncLang,
  SyncProgressDetail,
  formatElapsedSeconds,
  getSyncActionCopy,
  isSyncOverlayVisible,
  reduceSyncOverlayState,
} from './utils/syncOverlayState';

function readDocumentPrefs(): { lang: SyncLang; isDark: boolean } {
  if (typeof document === 'undefined') {
    return { lang: 'ar', isDark: false };
  }
  const html = document.documentElement;
  const langAttr = html.getAttribute('lang');
  const themeAttr = html.getAttribute('data-theme');
  const lang: SyncLang = langAttr === 'en' ? 'en' : 'ar';
  const isDark = themeAttr === 'dark' || html.classList.contains('dark');
  return { lang, isDark };
}

export function GlobalLoadingOverlay() {
  const [state, dispatch] = useReducer(
    reduceSyncOverlayState,
    INITIAL_SYNC_OVERLAY_STATE
  );
  const [prefs, setPrefs] = useState<{ lang: SyncLang; isDark: boolean }>(() =>
    readDocumentPrefs()
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const visible = isSyncOverlayVisible(state);
  const primaryTask = state.activeTasks[0] || null;
  const earliestStartedAt = useMemo(() => {
    if (state.activeTasks.length === 0) return Date.now();
    return state.activeTasks.reduce(
      (minVal, task) => Math.min(minVal, task.startedAt),
      state.activeTasks[0].startedAt
    );
  }, [state.activeTasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleSyncProgress = (ev: Event) => {
      const detail = (ev as CustomEvent<SyncProgressDetail>).detail;
      if (!detail || !detail.requestId) return;
      const ts = typeof detail.timestamp === 'number' ? detail.timestamp : Date.now();
      if (detail.phase === 'start') {
        setNowMs(ts);
        dispatch({
          type: 'start',
          requestId: detail.requestId,
          action: detail.action || 'sync',
          nowMs: ts,
          total: detail.total,
        });
      } else if (detail.phase === 'end') {
        dispatch({
          type: 'end',
          requestId: detail.requestId,
          nowMs: ts,
        });
      }
    };

    window.addEventListener('rg:syncprogress', handleSyncProgress);
    return () => {
      window.removeEventListener('rg:syncprogress', handleSyncProgress);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const syncDocPrefs = () => setPrefs(readDocumentPrefs());
    syncDocPrefs();
    const observer = new MutationObserver(syncDocPrefs);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang', 'dir', 'data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'dismiss', nowMs: Date.now() });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible]);

  const lang = prefs.lang;
  const isEn = lang === 'en';
  const copy = primaryTask
    ? getSyncActionCopy(primaryTask.action, lang)
    : getSyncActionCopy('', lang);
  const elapsedLabel = primaryTask
    ? formatElapsedSeconds(earliestStartedAt, nowMs, lang)
    : '';
  const extraCount = Math.max(0, state.activeTasks.length - 1);

  return (
    <AnimatePresence>
      {visible && primaryTask ? (
        <motion.div
          key="global-sync-overlay"
          data-testid="global-sync-overlay"
          data-sync-action={primaryTask.action}
          role="status"
          aria-live="polite"
          aria-busy="true"
          dir={isEn ? 'ltr' : 'rtl'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm dark:bg-black/75"
        >
          <motion.div
            initial={{ opacity: 1, scale: 0.97, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            {/* Top accent bar */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#D91F2B] via-[#ff4b57] to-[#D91F2B]" />

            <div className="flex items-start gap-4">
              {/* Brand Royal Red spinner emblem */}
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#D91F2B]/10 text-[#D91F2B] dark:bg-[#D91F2B]/20">
                <RefreshCw className="h-6 w-6 animate-spin" strokeWidth={2.2} />
                <span className="sr-only">
                  {isEn ? 'Synchronizing' : 'جاري المزامنة'}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#D91F2B] uppercase">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {isEn ? 'Rental Gate Sync' : 'مزامنة النظام الفورية'}
                  </span>
                  {elapsedLabel ? (
                    <span
                      data-testid="global-sync-elapsed"
                      className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {elapsedLabel}
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-1.5 text-base font-bold leading-snug text-slate-900 dark:text-white">
                  {copy.title}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-zinc-300">
                  {copy.subtitle}
                </p>
              </div>
            </div>

            {/* Subtle animated progress track */}
            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
              <motion.div
                className="h-full w-2/5 rounded-full bg-[#D91F2B]"
                initial={{ x: isEn ? '-100%' : '100%' }}
                animate={{ x: isEn ? '260%' : '-260%' }}
                transition={{
                  repeat: Infinity,
                  duration: 1.25,
                  ease: 'easeInOut',
                }}
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                {primaryTask.total ? (
                  <span>
                    {isEn
                      ? `${primaryTask.total} pending operations`
                      : `${primaryTask.total} عمليات معلقة`}
                  </span>
                ) : extraCount > 0 ? (
                  <span>
                    {isEn
                      ? `+${extraCount} active sync task(s)`
                      : `+${extraCount} مهام مزامنة نشطة`}
                  </span>
                ) : (
                  <span>
                    {isEn
                      ? 'Please wait until updates settle...'
                      : 'يرجى الانتظار حتى اكتمال التحديث...'}
                  </span>
                )}
              </div>

              <button
                type="button"
                data-testid="global-sync-dismiss"
                onClick={() => dispatch({ type: 'dismiss', nowMs: Date.now() })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#D91F2B]/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <EyeOff className="h-3.5 w-3.5" />
                <span>{isEn ? 'Run in background' : 'إخفاء في الخلفية'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function App() {
  return <GlobalLoadingOverlay />;
}
