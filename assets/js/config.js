/**
 * RENTAL GATE CRM — Global Auto-Connection Configuration
 * ضع رابط Google Apps Script Web App (/exec) أو رابط Backend API (/api/crm) ليعمل الموقع تلقائيًا.
 * يمكن تحديث هذا الملف تلقائيًا من داخل الموقع (الإعدادات ← الربط التلقائي الشامل).
 */
(function (root) {
  'use strict';
  root.RG_APP_CONFIG = Object.assign({
    gasWebAppUrl: '',
    backendApiUrl: ''
  }, root.RG_APP_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
