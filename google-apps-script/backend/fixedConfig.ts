// Auto-managed by RENTAL GATE CRM Settings ("حفظ وربط وتثبيت في الكود الأساسي").
// Server-only module: never import this file from frontend browser bundles.

export type FixedConnectionMode = '' | 'neon' | 'gas' | 'sandbox';

export interface FixedServerConfig {
  mode: FixedConnectionMode;
  databaseUrl: string;
  gasWebAppUrl: string;
  rgToken: string;
  rgApiBaseUrl: string;
  syncApiSecret: string;
  updatedAt: string;
  updatedBy: string;
}

export const FIXED_SERVER_CONFIG: FixedServerConfig = {
  mode: 'neon',
  databaseUrl: '',
  gasWebAppUrl: '',
  rgToken: '',
  rgApiBaseUrl: 'https://api.rentalgate.net/api',
  syncApiSecret: '',
  updatedAt: '',
  updatedBy: ''
};
