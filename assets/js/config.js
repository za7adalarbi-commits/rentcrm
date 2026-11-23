/**
 * RENTAL GATE CRM — Global Fixed Connection Configuration
 * يتم تحديث هذا الملف تلقائيًا عند الحفظ والربط من صفحة الإعدادات في الموقع.
 * لا يحتوي على أي توكنات أو أسرار — القيم العامة للوضع وربط الواجهة فقط.
 */
(function (root) {
  'use strict';
  root.RG_APP_CONFIG = Object.assign({
    mode: 'neon',
    gasWebAppUrl: '',
    backendApiUrl: '/api/crm'
  }, root.RG_APP_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
