import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

function localDateTimeParts(baseMs: number, offsetHours: number) {
  const d = new Date(baseMs + offsetHours * 3600000);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    iso: d.toISOString()
  };
}

test('resolveReservationEffectiveEnd prioritizes extendedUntilDate/Time over base endDate/Time', () => {
  const baseOnly = core.resolveReservationEffectiveEnd({
    endDate: '2026-11-20',
    endTime: '14:30',
    extendedUntilDate: '',
    extendedUntilTime: ''
  });
  assert.equal(baseOnly.date, '2026-11-20');
  assert.equal(baseOnly.time, '14:30');
  assert.equal(baseOnly.isExtended, false);
  assert.ok(typeof baseOnly.timestampMs === 'number' && baseOnly.timestampMs > 0);

  const extended = core.resolveReservationEffectiveEnd({
    endDate: '2026-11-20',
    endTime: '14:30',
    extendedUntilDate: '2026-11-22',
    extendedUntilTime: '18:00',
    extensionsCount: 1
  });
  assert.equal(extended.date, '2026-11-22');
  assert.equal(extended.time, '18:00');
  assert.equal(extended.isExtended, true);
});

test('isReservationClosedStatus distinguishes active rentals (تم التسليم) from closed/cancelled contracts', () => {
  assert.equal(core.isReservationClosedStatus({ internalStatus: 'تم التسليم', originalStatusAr: 'تم التسليم' }), false);
  assert.equal(core.isReservationClosedStatus({ internalStatus: 'تم التمديد', originalStatusAr: 'مؤكد' }), false);
  assert.equal(core.isReservationClosedStatus({ internalStatus: 'قيد الانتظار', originalStatusAr: 'قيد الانتظار' }), false);

  assert.equal(core.isReservationClosedStatus({ internalStatus: 'تم الاستلام', originalStatusAr: 'منتهي' }), true);
  assert.equal(core.isReservationClosedStatus({ internalStatus: 'تم الإرجاع' }), true);
  assert.equal(core.isReservationClosedStatus({ internalStatus: 'تم الإلغاء', originalStatusAr: 'ملغي' }), true);
  assert.equal(core.isReservationClosedStatus({ originalStatusCode: 'completed' }), true);
  assert.equal(core.isReservationClosedStatus({ originalStatusCode: 'cancelled' }), true);
});

test('classifyExpiryRadarItem & computeExpiryRadarSummary bucket, filter, and sort 24h alerts accurately', () => {
  const nowMs = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
  const plus4h = localDateTimeParts(nowMs, 4);
  const plus16h = localDateTimeParts(nowMs, 16);
  const minus2h = localDateTimeParts(nowMs, -2);
  const plus36h = localDateTimeParts(nowMs, 36);
  const minus20h = localDateTimeParts(nowMs, -20);

  const reservations = [
    {
      id: 'R_SOON',
      reservationNumber: 'RG-100',
      customerName: 'سلمان الدوسري',
      customerPhone: '0503344558',
      carName: 'إلنترا 2026',
      endDate: plus4h.date,
      endTime: plus4h.time,
      extendedUntilDate: plus16h.date,
      extendedUntilTime: plus16h.time,
      extensionsCount: 1,
      internalStatus: 'تم التمديد'
    },
    {
      id: 'R_CRIT',
      reservationNumber: 'RG-101',
      customerName: 'فيصل المطيري',
      customerPhone: '0557788991',
      carName: 'راف 4 2026',
      endDate: plus4h.date,
      endTime: plus4h.time,
      internalStatus: 'تم التسليم'
    },
    {
      id: 'R_OVERDUE',
      reservationNumber: 'RG-102',
      customerName: 'نواف القحطاني',
      customerPhone: '0541199882',
      carName: 'التيما 2026',
      endDate: minus2h.date,
      endTime: minus2h.time,
      internalStatus: 'قيد الانتظار'
    },
    {
      id: 'R_CLOSED',
      reservationNumber: 'RG-103',
      customerName: 'ريم المالكي',
      endDate: plus4h.date,
      endTime: plus4h.time,
      internalStatus: 'تم الاستلام'
    },
    {
      id: 'R_FAR',
      reservationNumber: 'RG-104',
      customerName: 'تركي العجمي',
      endDate: plus36h.date,
      endTime: plus36h.time,
      internalStatus: 'تم الحجز'
    },
    {
      id: 'R_OLD_PAST',
      reservationNumber: 'RG-105',
      customerName: 'سعد الحربي',
      endDate: minus20h.date,
      endTime: minus20h.time,
      internalStatus: 'قيد الانتظار'
    }
  ];

  const allSummary = core.computeExpiryRadarSummary(reservations, nowMs);
  assert.equal(allSummary.totalCount, 3);
  assert.equal(allSummary.expiredUnclosedCount, 1);
  assert.equal(allSummary.critical6hCount, 1);
  assert.equal(allSummary.soon24hCount, 1);
  assert.equal(allSummary.extendedInRadarCount, 1);
  // Sorted: expired_unclosed -> critical_6h -> soon_24h
  assert.deepEqual(
    allSummary.items.map((x: { reservation: { id: string } }) => x.reservation.id),
    ['R_OVERDUE', 'R_CRIT', 'R_SOON']
  );

  const critOnly = core.computeExpiryRadarSummary(reservations, nowMs, { subFilter: 'critical_6h' });
  assert.equal(critOnly.items.length, 1);
  assert.equal(critOnly.items[0].reservation.id, 'R_CRIT');

  const searchRes = core.computeExpiryRadarSummary(reservations, nowMs, { search: 'إلنترا' });
  assert.equal(searchRes.items.length, 1);
  assert.equal(searchRes.items[0].reservation.id, 'R_SOON');
});

test('normalizeWhatsappPhone and buildExtensionOfferMessage format Saudi numbers and bilingual outreach', () => {
  assert.equal(core.normalizeWhatsappPhone('0508877123'), '966508877123');
  assert.equal(core.normalizeWhatsappPhone('+966 55 123 9874'), '966551239874');
  assert.equal(core.normalizeWhatsappPhone('00966534455661'), '966534455661');
  assert.equal(core.normalizeWhatsappPhone('٠٥٤١١٩٩٨٨٢'), '966541199882');

  const sample = {
    reservationNumber: 'RG-2026-8847',
    customerName: 'فيصل المطيري',
    carName: 'تويوتا راف 4 2026',
    companyName: 'ذيب',
    endDate: '2026-11-20',
    endTime: '16:00'
  };
  const msgAr = core.buildExtensionOfferMessage(sample, 'ar', { agentName: 'خالد' });
  assert.match(msgAr, /RG-2026-8847/);
  assert.match(msgAr, /تمديد/);
  assert.match(msgAr, /خالد/);

  const msgEn = core.buildExtensionOfferMessage(sample, 'en', { agentName: 'Khalid' });
  assert.match(msgEn, /RG-2026-8847/);
  assert.match(msgEn, /extend your contract/i);
  assert.match(msgEn, /Khalid/);
});

test('resolveShiftWindow handles presets and swaps reversed custom date ranges', () => {
  const nowMs = new Date(2026, 10, 19, 18, 0, 0, 0).getTime();
  const win8h = core.resolveShiftWindow('8h', '', '', nowMs);
  assert.equal(win8h.endMs - win8h.startMs, 8 * 3600000);

  const win12h = core.resolveShiftWindow('12h', '', '', nowMs);
  assert.equal(win12h.endMs - win12h.startMs, 12 * 3600000);

  const customReversed = core.resolveShiftWindow('custom', '2026-11-19', '2026-11-17', nowMs);
  assert.ok(customReversed.startMs <= customReversed.endMs);
  assert.match(customReversed.labelEn, /2026/);
});

test('computeShiftHandoverSummary and buildShiftHandoverPdfPayload aggregate closed, pending, open problems, and radar', () => {
  const nowMs = new Date(2026, 10, 19, 16, 0, 0, 0).getTime();
  const twoHoursAgoIso = new Date(nowMs - 2 * 3600000).toISOString();
  const twoDaysAgoIso = new Date(nowMs - 48 * 3600000).toISOString();
  const plus5h = localDateTimeParts(nowMs, 5);

  const reservations = [
    {
      id: 'RES_C1',
      reservationNumber: 'RG-1',
      customerName: 'ريم',
      carName: 'مازدا 6',
      internalStatus: 'تم الاستلام',
      lastUpdatedAt: twoHoursAgoIso
    },
    {
      id: 'RES_C_OLD',
      reservationNumber: 'RG-2',
      customerName: 'بندر',
      carName: 'إكس تريل',
      internalStatus: 'تم الإلغاء',
      lastUpdatedAt: twoDaysAgoIso
    },
    {
      id: 'RES_P1',
      reservationNumber: 'RG-3',
      customerName: 'ماجد',
      customerPhone: '0534455661',
      carName: 'كيا K5',
      internalStatus: 'تم الإنشاء',
      priority: 'مرتفع',
      hasProblem: true,
      assignedEmployeeIds: ['EMP_AG2'],
      lastUpdatedAt: twoHoursAgoIso
    },
    {
      id: 'RES_ACTIVE_OK',
      reservationNumber: 'RG-4',
      customerName: 'فيصل',
      carName: 'راف 4',
      internalStatus: 'تم التسليم',
      isFollowed: true,
      assignedEmployeeIds: ['EMP_AG1'],
      endDate: plus5h.date,
      endTime: plus5h.time,
      lastUpdatedAt: twoHoursAgoIso
    }
  ];

  const problems = [
    {
      id: 'PRB_1',
      problemNumber: 'PRB-101',
      reservationNumber: 'RG-3',
      customerName: 'ماجد',
      description: 'تأخر تجهيز السيارة',
      priority: 'مرتفع',
      status: 'بانتظار الشركة',
      createdAt: twoHoursAgoIso,
      updatedAt: twoHoursAgoIso
    },
    {
      id: 'PRB_2',
      problemNumber: 'PRB-102',
      reservationNumber: 'RG-1',
      customerName: 'ريم',
      description: 'تم الإغلاق',
      priority: 'عادي',
      status: 'مغلقة',
      createdAt: twoHoursAgoIso,
      updatedAt: twoHoursAgoIso
    }
  ];

  const followUps = [
    {
      id: 'FU_1',
      reservationId: 'RES_ACTIVE_OK',
      followUpDate: plus5h.date,
      createdAt: twoHoursAgoIso
    }
  ];

  const summary = core.computeShiftHandoverSummary({
    reservations,
    problems,
    followUps,
    preset: '8h',
    staffName: 'فهد الدوسري',
    notes: 'يرجى متابعة حجز RG-3 فور استلام الوردية المسائية والتنسيق مع فرع جدة.',
    nowMs
  });

  assert.equal(summary.counts.closedCount, 1);
  assert.equal(summary.closedReservations[0].id, 'RES_C1');
  assert.equal(summary.counts.pendingCount, 1);
  assert.equal(summary.pendingReservations[0].id, 'RES_P1');
  assert.equal(summary.counts.activeHealthyCount, 1);
  assert.equal(summary.counts.openProblemsCount, 1);
  assert.equal(summary.counts.closedProblemsCount, 1);
  assert.equal(summary.counts.expiring24hCount, 1);
  assert.equal(summary.counts.followUpsCount, 1);

  const pdfPayload = core.buildShiftHandoverPdfPayload(summary, 'ar');
  assert.match(pdfPayload.title, /ملخص تسليم الوردية/);
  assert.match(pdfPayload.filename, /^rental-gate-shift-handover-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(pdfPayload.rows.length, 2); // 1 pending + 1 closed in shift
  assert.equal(pdfPayload.extraSections.length, 3); // Today's Pickups & Returns + Open Problems + 24h Expiry Radar Alerts
  assert.ok(pdfPayload.summaryItems.some((it: { value: string }) => it.value.includes('RG-3')));
});
