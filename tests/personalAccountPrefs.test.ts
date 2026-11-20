import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('normalizeTimeFormat and normalizeSidebarPosition validate and normalize values safely', () => {
  assert.equal(core.normalizeTimeFormat('12h'), '12h');
  assert.equal(core.normalizeTimeFormat('12H'), '12h');
  assert.equal(core.normalizeTimeFormat('24h'), '24h');
  assert.equal(core.normalizeTimeFormat(''), '24h');
  assert.equal(core.normalizeTimeFormat('invalid'), '24h');

  assert.equal(core.normalizeSidebarPosition('top'), 'top');
  assert.equal(core.normalizeSidebarPosition('TOP'), 'top');
  assert.equal(core.normalizeSidebarPosition('bottom'), 'bottom');
  assert.equal(core.normalizeSidebarPosition('side'), 'side');
  assert.equal(core.normalizeSidebarPosition('LEFT'), 'side');
  assert.equal(core.normalizeSidebarPosition(''), 'side');
});

test('formatTimePreference converts HH:mm between 24h and 12h for Arabic and English', () => {
  assert.equal(core.formatTimePreference('00:05', '24h', 'ar'), '00:05');
  assert.equal(core.formatTimePreference('14:35', '24h', 'ar'), '14:35');

  assert.equal(core.formatTimePreference('00:05', '12h', 'ar'), '12:05 ص');
  assert.equal(core.formatTimePreference('09:15', '12h', 'ar'), '9:15 ص');
  assert.equal(core.formatTimePreference('12:00', '12h', 'ar'), '12:00 م');
  assert.equal(core.formatTimePreference('14:35', '12h', 'ar'), '2:35 م');
  assert.equal(core.formatTimePreference('23:59', '12h', 'ar'), '11:59 م');

  assert.equal(core.formatTimePreference('00:05', '12h', 'en'), '12:05 AM');
  assert.equal(core.formatTimePreference('09:15', '12h', 'en'), '9:15 AM');
  assert.equal(core.formatTimePreference('12:00', '12h', 'en'), '12:00 PM');
  assert.equal(core.formatTimePreference('14:35', '12h', 'en'), '2:35 PM');
});

test('formatDateTimePreference formats ISO timestamps in 12h and 24h without altering 1-arg baseline', () => {
  const iso = '2026-11-19T14:35:00';
  assert.equal(core.formatDisplayDateTime(iso), '2026-11-19 14:35');
  assert.equal(core.formatDateTimePreference(iso, '24h', 'ar'), '2026-11-19 14:35');
  assert.equal(core.formatDateTimePreference(iso, '12h', 'ar'), '2026-11-19 2:35 م');
  assert.equal(core.formatDateTimePreference(iso, '12h', 'en'), '2026-11-19 2:35 PM');
});

test('normalizeUserLayoutPrefs preserves timeFormat and sidebarPosition defaults and overrides', () => {
  const defaults = core.normalizeUserLayoutPrefs({});
  assert.equal(defaults.timeFormat, '24h');
  assert.equal(defaults.sidebarPosition, 'side');

  const custom = core.normalizeUserLayoutPrefs({
    timeFormat: '12h',
    sidebarPosition: 'bottom',
    dashHidden: ['peak_heatmap']
  });
  assert.equal(custom.timeFormat, '12h');
  assert.equal(custom.sidebarPosition, 'bottom');
  assert.deepEqual(custom.dashHidden, ['peak_heatmap']);
});

test('formatReportCellValue applies timeFormat on time and datetime columns', () => {
  const row = { startTime: '16:45', updatedAt: '2026-11-19T08:20:00' };
  const timeCol = { key: 'startTime', formatType: 'time' };
  const dtCol = { key: 'updatedAt', formatType: 'datetime' };

  assert.equal(core.formatReportCellValue(timeCol, row, 'ar', { timeFormat: '24h' }), '16:45');
  assert.equal(core.formatReportCellValue(timeCol, row, 'ar', { timeFormat: '12h' }), '4:45 م');
  assert.equal(core.formatReportCellValue(timeCol, row, 'en', { timeFormat: '12h' }), '4:45 PM');
  assert.equal(core.formatReportCellValue(dtCol, row, 'en', { timeFormat: '12h' }), '2026-11-19 8:20 AM');
});

test('formatBookingSummaryText and buildShiftHandoverPdfPayload honor timeFormat preference', () => {
  const booking = {
    reservationNumber: 'RG-901',
    customerName: 'سلمان القحطاني',
    customerPhone: '0551234567',
    companyName: 'بدجت',
    carName: 'كامري',
    startDate: '2026-11-19',
    startTime: '09:30',
    endDate: '2026-11-22',
    endTime: '17:15',
    daysCount: 3,
    totalAmount: 900,
    internalStatus: 'تم الحجز'
  };

  const summary12Ar = core.formatBookingSummaryText(booking, 'ar', { timeFormat: '12h' });
  assert.match(summary12Ar, /9:30 ص/);
  assert.match(summary12Ar, /5:15 م/);

  const summary24 = core.formatBookingSummaryText(booking, 'ar', { timeFormat: '24h' });
  assert.match(summary24, /09:30/);
  assert.match(summary24, /17:15/);

  const payload12En = core.buildShiftHandoverPdfPayload({
    staffName: 'Admin',
    shiftWindow: { labelEn: 'Today', labelAr: 'اليوم' },
    counts: { closedCount: 0, pendingCount: 0, openProblemsCount: 0, expiring24hCount: 1, followUpsCount: 0 },
    expiring24h: [{ reservation: booking, effectiveEndDate: '2026-11-22', effectiveEndTime: '17:15', remainingLabelEn: '4h' }]
  }, 'en', { timeFormat: '12h' });
  const flatStr = JSON.stringify(payload12En);
  assert.match(flatStr, /5:15 PM/);
});
