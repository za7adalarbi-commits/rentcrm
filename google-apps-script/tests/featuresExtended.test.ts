import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('computeTodayMovementsSummary sorts chronological pickups and returns, excludes cancelled, and tracks delayed/completed', () => {
  // 2026-11-19 at 12:00 local time
  const nowMs = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
  const today = '2026-11-19';

  const reservations = [
    {
      id: 'R_PK_LATE',
      reservationNumber: 'RG-201',
      customerName: 'أحمد العلي',
      carName: 'كامري',
      startDate: today,
      startTime: '09:30',
      endDate: '2026-11-22',
      endTime: '14:00',
      internalStatus: 'تم الحجز'
    },
    {
      id: 'R_PK_DONE',
      reservationNumber: 'RG-202',
      customerName: 'سعد الحربي',
      carName: 'إلنترا',
      startDate: today,
      startTime: '10:00',
      endDate: today,
      endTime: '18:00',
      internalStatus: 'تم التسليم'
    },
    {
      id: 'R_RET_EXT',
      reservationNumber: 'RG-203',
      customerName: 'نواف الدوسري',
      carName: 'راف 4',
      startDate: '2026-11-15',
      startTime: '11:00',
      endDate: '2026-11-18',
      endTime: '11:00',
      extendedUntilDate: today,
      extendedUntilTime: '15:30',
      extensionsCount: 1,
      internalStatus: 'تم التمديد'
    },
    {
      id: 'R_RET_CLOSED',
      reservationNumber: 'RG-204',
      customerName: 'ريم الشمري',
      carName: 'سوناتا',
      startDate: '2026-11-16',
      startTime: '08:00',
      endDate: today,
      endTime: '08:30',
      internalStatus: 'تم الاستلام'
    },
    {
      id: 'R_CANCELLED',
      reservationNumber: 'RG-205',
      customerName: 'ماجد',
      startDate: today,
      startTime: '07:00',
      endDate: today,
      endTime: '13:00',
      internalStatus: 'تم الإلغاء'
    }
  ];

  const all = core.computeTodayMovementsSummary(reservations, nowMs);
  assert.equal(all.todayDate, today);
  assert.equal(all.totalCount, 5); // R_PK_LATE(pickup), R_PK_DONE(pickup+return), R_RET_EXT(return), R_RET_CLOSED(return)
  assert.equal(all.pickupCount, 2);
  assert.equal(all.returnCount, 3);
  assert.equal(all.overdueCount, 1); // only R_PK_LATE at 09:30 (R_RET_CLOSED is closed)
  assert.equal(all.completedCount, 2); // R_PK_DONE pickup + R_RET_CLOSED return
  assert.deepEqual(
    all.items.map((it: { key: string; scheduledTime: string }) => `${it.key}@${it.scheduledTime}`),
    [
      'R_RET_CLOSED:return@08:30',
      'R_PK_LATE:pickup@09:30',
      'R_PK_DONE:pickup@10:00',
      'R_RET_EXT:return@15:30',
      'R_PK_DONE:return@18:00'
    ]
  );
  assert.equal(all.items[1].isOverdue, true);
  assert.equal(all.items[3].isExtended, true);

  const onlyPickups = core.computeTodayMovementsSummary(reservations, nowMs, { subFilter: 'pickup' });
  assert.equal(onlyPickups.items.length, 2);

  const searchMatch = core.computeTodayMovementsSummary(reservations, nowMs, { subFilter: 'return', search: 'RG-203' });
  assert.equal(searchMatch.items.length, 1);
  assert.equal(searchMatch.items[0].reservation.id, 'R_RET_EXT');
});

test('computeExtensionComparisonSummary computes deltas from raw extensions and handles zero-extension contracts', () => {
  const withExt = core.computeExtensionComparisonSummary(
    {
      id: 'RES_E1',
      startDate: '2026-11-10',
      originalEndDate: '2026-11-13',
      originalEndTime: '14:00',
      endDate: '2026-11-13',
      daysCount: 3,
      baseAmount: 600,
      totalAmount: 1050
    },
    [
      {
        extensionNumber: 'EXT-1',
        extendDate: '2026-11-13 14:00',
        newEndDate: '2026-11-15 14:00',
        extendDays: 2,
        amount: 300
      },
      {
        extensionNumber: 'EXT-2',
        extendDate: '2026-11-15 14:00',
        newEndDate: '2026-11-16 18:00',
        extendDays: 1,
        amount: 150
      }
    ]
  );

  assert.equal(withExt.hasExtensions, true);
  assert.equal(withExt.extensionsCount, 2);
  assert.equal(withExt.originalEndDate, '2026-11-13');
  assert.equal(withExt.originalEndTime, '14:00');
  assert.equal(withExt.effectiveEndDate, '2026-11-16');
  assert.equal(withExt.effectiveEndTime, '18:00');
  assert.equal(withExt.baseDays, 3);
  assert.equal(withExt.extendedDays, 3);
  assert.equal(withExt.totalDays, 6);
  assert.equal(withExt.baseAmount, 600);
  assert.equal(withExt.extensionsAmount, 450);
  assert.equal(withExt.totalAmount, 1050);
  assert.equal(withExt.amountDeltaPct, 75);
  assert.equal(withExt.extensions.length, 2);

  const noExt = core.computeExtensionComparisonSummary(
    {
      id: 'RES_E0',
      startDate: '2026-11-10',
      originalEndDate: '2026-11-12',
      endDate: '2026-11-12',
      endTime: '12:00',
      daysCount: 2,
      baseAmount: 400,
      totalAmount: 400
    },
    []
  );
  assert.equal(noExt.hasExtensions, false);
  assert.equal(noExt.extensionsCount, 0);
  assert.equal(noExt.extendedDays, 0);
  assert.equal(noExt.extensionsAmount, 0);
  assert.equal(noExt.amountDeltaPct, 0);
});

test('computePeakHoursHeatmap aggregates reservations and problems into 7x24 matrix with layer filtering', () => {
  // 2026-11-19 is Thursday (dayIndex 4)
  const reservations = [
    { id: 'R1', startDate: '2026-11-19', startTime: '14:15' },
    { id: 'R2', startDate: '2026-11-19', startTime: '14:45' },
    { id: 'R3', startDate: '2026-11-20', startTime: '09:00' } // Friday (dayIndex 5)
  ];
  const problems = [
    { id: 'P1', createdAt: '2026-11-19 14:30' },
    { id: 'P2', createdAt: '2026-11-19 14:55' }
  ];

  const all = core.computePeakHoursHeatmap(reservations, problems, { mode: 'all' });
  assert.equal(all.days.length, 7);
  assert.equal(all.days[0].dayIndex, 6); // starts on Saturday
  assert.equal(all.totalEvents, 5);
  assert.equal(all.reservationEvents, 3);
  assert.equal(all.problemEvents, 2);
  assert.equal(all.peakHour, 14);
  assert.equal(all.peakHourLabel, '14:00');
  assert.equal(all.peakHourTotal, 4);
  assert.equal(all.busiestDay.dayIndex, 4);
  assert.equal(all.peakSlot.dayIndex, 4);
  assert.equal(all.peakSlot.hour, 14);
  assert.equal(all.peakSlot.count, 4);

  const thuRow = all.days.find((d: { dayIndex: number }) => d.dayIndex === 4);
  assert.equal(thuRow.hours[14].intensity, 4);

  const prbOnly = core.computePeakHoursHeatmap(reservations, problems, { mode: 'problems' });
  assert.equal(prbOnly.totalEvents, 2);
  assert.equal(prbOnly.peakSlot.count, 2);
  assert.equal(prbOnly.days.find((d: { dayIndex: number }) => d.dayIndex === 5).rowTotal, 0);
});

test('findMentionSegments, extractMentionedEmployees, and resolveNotificationTarget handle Arabic names, underscores, boundaries, and routing', () => {
  const employees = [
    { id: 'EMP_ADMIN', name: 'فهد الدوسري', username: 'admin', status: 'active' },
    { id: 'EMP_SUP1', name: 'سارة العتيبي', username: 'supervisor', status: 'active' },
    { id: 'EMP_AG1', name: 'خالد الحربي', username: 'agent1', status: 'active' },
    { id: 'EMP_DIS', name: 'موظف معطل', username: 'disabled1', status: 'disabled' }
  ];

  const msg = 'يرجى المراجعة من @سارة العتيبي و @خالد_الحربي و @admin وعدم إرسال بريد test@supervisor.sa أو @موظف معطل';
  const segs = core.findMentionSegments(msg, employees);
  const mentionIds = segs
    .filter((s: { type: string }) => s.type === 'mention')
    .map((s: { employee: { id: string } }) => s.employee.id);
  assert.deepEqual(mentionIds, ['EMP_SUP1', 'EMP_AG1', 'EMP_ADMIN']);

  const notified = core.extractMentionedEmployees(
    'تنبيه إلى @سارة العتيبي و @فهد الدوسري و @sara مجدداً @سارة العتيبي',
    employees,
    { excludeEmployeeId: 'EMP_ADMIN' }
  );
  assert.deepEqual(
    notified.map((e: { id: string }) => e.id),
    ['EMP_SUP1']
  );

  assert.deepEqual(
    core.resolveNotificationTarget({ entityType: 'Reservation', entityId: 'RES_1001', type: 'mention' }),
    { kind: 'reservation', entityId: 'RES_1001', route: 'reservations' }
  );
  assert.deepEqual(
    core.resolveNotificationTarget({ entityType: 'Problem', entityId: 'PRB_701', type: 'mention' }),
    { kind: 'problem', entityId: 'PRB_701', route: 'problems' }
  );
});
