import { registerSW } from 'virtual:pwa-register';

if (typeof window !== 'undefined') {
  try {
    const isProd = Boolean((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD);
    if (isProd) {
      registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, reg) {
          if (reg && typeof window !== 'undefined') {
            (window as any).__RG_SW_REG__ = reg;
          }
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
