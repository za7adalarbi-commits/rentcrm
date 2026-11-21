import { registerSW } from 'virtual:pwa-register';

if (typeof window !== 'undefined') {
  try {
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
  } catch {
    // Ignore
  }
}
