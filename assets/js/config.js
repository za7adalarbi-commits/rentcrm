/**
 * RENTAL GATE CRM — Global Auto-Connection Configuration
 * ضع رابط Google Apps Script Web App (/exec) أو رابط Backend API (/api/crm) ليعمل الموقع تلقائيًا.
 * مثال:
 *   gasWebAppUrl: 'https://script.google.com/macros/s/AKfycb.../exec'
 *   backendApiUrl: '/api/crm'
 */
(function (root) {
  'use strict';
  root.RG_APP_CONFIG = Object.assign({
    gasWebAppUrl: '',
    backendApiUrl: ''
  }, root.RG_APP_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
