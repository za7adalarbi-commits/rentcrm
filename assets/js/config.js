/**
 * RENTAL GATE CRM — Global Auto-Connection Configuration
 * ضع رابط Google Apps Script Web App (/exec) هنا ليعمل الموقع تلقائيًا لجميع المستخدمين دون إدخاله من صفحة تسجيل الدخول.
 * مثال:
 *   gasWebAppUrl: 'https://script.google.com/macros/s/AKfycb.../exec'
 */
(function (root) {
  'use strict';
  root.RG_APP_CONFIG = Object.assign({
    gasWebAppUrl: ''
  }, root.RG_APP_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
