import { registerSW } from 'virtual:pwa-register';

if (typeof window !== 'undefined') {
  try {
    const isProd = Boolean((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD);
    if (isProd) {
      let hadControllerAtBoot = Boolean(
        'serviceWorker' in navigator && navigator.serviceWorker.controller
      );
      let swUpdateInterval: number | null = null;

      const emitSwEvent = (name: string, detail?: Record<string, unknown>) => {
        try {
          document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        } catch {
          // Ignore
        }
      };

      const checkSwUpdate = async (): Promise<boolean> => {
        const reg = (window as any).__RG_SW_REG__ as ServiceWorkerRegistration | undefined;
        if (!reg || typeof reg.update !== 'function') return false;
        try {
          await reg.update();
          if (reg.waiting) {
            try {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            } catch {
              // Ignore
            }
            emitSwEvent('rg:swupdatefound', { state: 'waiting' });
            return true;
          }
          return false;
        } catch {
          return false;
        }
      };
      (window as any).__RG_CHECK_SW_UPDATE__ = checkSwUpdate;

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!hadControllerAtBoot) {
            hadControllerAtBoot = true;
            return;
          }
          emitSwEvent('rg:swcontrollerchange', { at: Date.now() });
          const mgr = (window as any).RGUpdateManager;
          if (mgr && typeof mgr.handleSwControllerChange === 'function') {
            mgr.handleSwControllerChange();
          }
        });
      }

      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          try {
            void updateSW(true);
          } catch {
            // Ignore
          }
          emitSwEvent('rg:swupdatefound', { state: 'need_refresh' });
        },
        onRegisteredSW(_swUrl, reg) {
          if (!reg) return;
          (window as any).__RG_SW_REG__ = reg;

          const bindInstalling = (worker: ServiceWorker | null) => {
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                try {
                  worker.postMessage({ type: 'SKIP_WAITING' });
                } catch {
                  // Ignore
                }
                emitSwEvent('rg:swupdatefound', { state: 'installed' });
              }
            });
          };

          if (reg.waiting && navigator.serviceWorker.controller) {
            try {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            } catch {
              // Ignore
            }
            emitSwEvent('rg:swupdatefound', { state: 'waiting' });
          }

          if (reg.installing) {
            bindInstalling(reg.installing);
          }

          reg.addEventListener('updatefound', () => {
            bindInstalling(reg.installing);
          });

          if (swUpdateInterval !== null) {
            window.clearInterval(swUpdateInterval);
          }
          swUpdateInterval = window.setInterval(() => {
            if (document.visibilityState === 'visible' && navigator.onLine !== false) {
              void checkSwUpdate();
            }
          }, 60000);
        },
        onRegisterError() {
          // Ignore silent SW registration failures in unsupported contexts
        },
      });
    } else if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
  } catch {
    // Ignore
  }
}

