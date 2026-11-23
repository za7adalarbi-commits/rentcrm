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

test('isTimeInRange evaluates normal windows, overnight wraparound windows, and empty bounds', () => {
  assert.equal(core.isTimeInRange('14:30', '', ''), true);
  assert.equal(core.isTimeInRange('', '09:00', '17:00'), false);
  assert.equal(core.isTimeInRange('09:00', '09:00', '17:00'), true);
  assert.equal(core.isTimeInRange('17:00', '09:00', '17:00'), true);
  assert.equal(core.isTimeInRange('18:01', '09:00', '17:00'), false);
  // Overnight shift 22:00 -> 02:00
  assert.equal(core.isTimeInRange('23:15', '22:00', '02:00'), true);
  assert.equal(core.isTimeInRange('01:45', '22:00', '02:00'), true);
  assert.equal(core.isTimeInRange('10:00', '22:00', '02:00'), false);
  // Open-ended single bound
  assert.equal(core.isTimeInRange('15:00', '12:00', ''), true);
  assert.equal(core.isTimeInRange('11:00', '12:00', ''), false);
  assert.equal(core.isTimeInRange('11:00', '', '12:00'), true);
});

test('filterReservations filters accurately by timeField (start, end, both) and overdueUnpaidOnly', () => {
  const nowMs = new Date(2026, 10, 20, 15, 0, 0, 0).getTime();
  const past2h = localDateTimeParts(nowMs, -2);
  const plus3h = localDateTimeParts(nowMs, 3);
  const plus24h = localDateTimeParts(nowMs, 24);

  const reservations = [
    {
      id: 'R1',
      reservationNumber: 'RG-1001',
      customerName: 'أحمد',
      startDate: past2h.date,
      startTime: '09:30',
      endDate: past2h.date,
      endTime: past2h.time,
      internalStatus: 'نشط الآن',
      isAcceptedAndPaid: false
    },
    {
      id: 'R2',
      reservationNumber: 'RG-1002',
      customerName: 'سعد',
      startDate: past2h.date,
      startTime: '14:00',
      endDate: plus3h.date,
      endTime: '20:30',
      extendedUntilDate: plus24h.date,
      extendedUntilTime: '21:15',
      internalStatus: 'تم التمديد',
      isAcceptedAndPaid: true
    },
    {
      id: 'R3',
      reservationNumber: 'RG-1003',
      customerName: 'فهد',
      startDate: past2h.date,
      startTime: '08:00',
      endDate: past2h.date,
      endTime: past2h.time,
      internalStatus: 'تم الاستلام'
    }
  ];

  const byStart = core.filterReservations(reservations, [], {
    timeField: 'start',
    timeFrom: '09:00',
    timeTo: '10:00'
  });
  assert.deepEqual(byStart.map((r: { id: string }) => r.id), ['R1']);

  const byEnd = core.filterReservations(reservations, [], {
    timeField: 'end',
    timeFrom: '21:00',
    timeTo: '22:00'
  });
  assert.deepEqual(byEnd.map((r: { id: string }) => r.id), ['R2']);

  const byBoth = core.filterReservations(reservations, [], {
    timeField: 'both',
    timeFrom: '08:00',
    timeTo: '10:00'
  });
  assert.equal(byBoth.length, 2);

  const overdueOnly = core.filterReservations(reservations, [], {
    overdueUnpaidOnly: true,
    nowMs
  });
  assert.deepEqual(overdueOnly.map((r: { id: string }) => r.id), ['R1']);
});

test('isReservationOverdueUnpaid distinguishes unpaid overdue rentals from closed or paid-extended bookings', () => {
  const nowMs = new Date(2026, 10, 20, 16, 0, 0, 0).getTime();
  const past3h = localDateTimeParts(nowMs, -3);
  const plus6h = localDateTimeParts(nowMs, 6);

  const overdueActive = core.isReservationOverdueUnpaid(
    {
      id: 'OV1',
      reservationNumber: 'RG-OV1',
      endDate: past3h.date,
      endTime: past3h.time,
      internalStatus: 'نشط الآن',
      isAcceptedAndPaid: false
    },
    [],
    nowMs
  );
  assert.equal(overdueActive.isOverdueUnpaid, true);
  assert.ok(overdueActive.overdueMinutes >= 175);
  assert.match(overdueActive.labelAr, /متأخر/);

  const paidExtended = core.isReservationOverdueUnpaid(
    {
      id: 'OV2',
      reservationNumber: 'RG-OV2',
      endDate: past3h.date,
      endTime: past3h.time,
      extendedUntilDate: plus6h.date,
      extendedUntilTime: plus6h.time,
      internalStatus: 'تم التمديد'
    },
    [{ endDate: plus6h.date, endTime: plus6h.time, reservationStatus: 'accepted', paymentStatus: 'paid', paid: true }],
    nowMs
  );
  assert.equal(paidExtended.isOverdueUnpaid, false);

  const unpaidExtension = core.isReservationOverdueUnpaid(
    {
      id: 'OV3',
      reservationNumber: 'RG-OV3',
      endDate: past3h.date,
      endTime: past3h.time,
      extendedUntilDate: plus6h.date,
      extendedUntilTime: plus6h.time,
      internalStatus: 'نشط الآن'
    },
    [{ endDate: plus6h.date, endTime: plus6h.time, isAcceptedAndPaid: false }],
    nowMs
  );
  assert.equal(unpaidExtension.isOverdueUnpaid, true);

  const closedBooking = core.isReservationOverdueUnpaid(
    {
      id: 'OV4',
      reservationNumber: 'RG-OV4',
      endDate: past3h.date,
      endTime: past3h.time,
      internalStatus: 'تم الاستلام'
    },
    [],
    nowMs
  );
  assert.equal(closedBooking.isOverdueUnpaid, false);
});

test('normalizeHandoverSettings, computeShiftHandoverSummary (hour range), and buildShiftHandoverPdfPayload respect custom settings', () => {
  const settings = core.normalizeHandoverSettings({
    defaultPreset: 'today',
    defaultTimeFrom: '08:00',
    defaultTimeTo: '16:00',
    includeTodayMovements: false,
    includePending: true,
    includeClosed: false,
    includeOpenProblems: false,
    includeExpiring24h: false,
    autoIncludeNotes: true
  });
  assert.equal(settings.defaultPreset, 'today');
  assert.equal(settings.defaultTimeFrom, '08:00');
  assert.equal(settings.defaultTimeTo, '16:00');
  assert.equal(settings.includeTodayMovements, false);

  const nowMs = new Date(2026, 10, 20, 15, 0, 0, 0).getTime();
  const todayStr = localDateTimeParts(nowMs, 0).date;
  const inHourIso = new Date(2026, 10, 20, 10, 30, 0, 0).toISOString();

  const summary = core.computeShiftHandoverSummary({
    reservations: [
      {
        id: 'MV1',
        reservationNumber: 'RG-MV1',
        customerName: 'طارق',
        carName: 'سوناتا',
        startDate: todayStr,
        startTime: '10:30',
        endDate: '2026-11-23',
        endTime: '12:00',
        internalStatus: 'تم الحجز',
        lastUpdatedAt: inHourIso
      },
      {
        id: 'MV2',
        reservationNumber: 'RG-MV2',
        customerName: 'ماجد',
        carName: 'كامري',
        startDate: todayStr,
        startTime: '19:30',
        endDate: '2026-11-23',
        endTime: '12:00',
        internalStatus: 'تم الحجز',
        lastUpdatedAt: inHourIso
      },
      {
        id: 'CL1',
        reservationNumber: 'RG-CL1',
        customerName: 'بندر',
        carName: 'إلنترا',
        startDate: '2026-11-18',
        endDate: todayStr,
        internalStatus: 'تم الاستلام',
        lastUpdatedAt: inHourIso
      }
    ],
    problems: [{ id: 'P1', problemNumber: 'PRB-1', status: 'مفتوحة', priority: 'مرتفع', createdAt: inHourIso }],
    followUps: [],
    handoverSettings: settings,
    nowMs
  });

  // Only MV1 falls within 08:00 - 16:00 for todayMovements
  assert.equal(summary.todayMovements.length, 1);
  assert.equal(summary.todayMovements[0].reservation.id, 'MV1');

  const pdfPayload = core.buildShiftHandoverPdfPayload(summary, 'ar', { handoverSettings: settings });
  // includeClosed=false -> CL1 excluded from PDF rows; includePending=true -> MV1 + MV2 included
  assert.equal(pdfPayload.rows.length, 2);
  // includeTodayMovements=false, includeOpenProblems=false, includeExpiring24h=false -> no extraSections
  assert.equal(pdfPayload.extraSections.length, 0);
});

test('isDelegationActive and applyActiveDelegationsToUser grant temporary supervisor role & auto-expire', () => {
  const nowMs = new Date(2026, 10, 20, 12, 0, 0, 0).getTime();
  const baseAgent = {
    id: 'EMP_AG1',
    name: 'سارة الغامدي',
    role: 'agent',
    permissions: ['view_dashboard', 'pull_reservations', 'add_followup']
  };

  const activeDel = {
    id: 'DEL_1',
    delegateEmployeeId: 'EMP_AG1',
    delegateEmployeeName: 'سارة الغامدي',
    delegatedRole: 'supervisor',
    grantedById: 'EMP_GM',
    grantedByName: 'المدير العام',
    startsAt: new Date(nowMs - 3600000).toISOString(),
    expiresAt: new Date(nowMs + 3600000).toISOString(),
    status: 'active',
    reason: 'تغطية إجازة المشرف'
  };

  const expiredDel = {
    id: 'DEL_2',
    delegateEmployeeId: 'EMP_AG1',
    delegatedRole: 'supervisor',
    startsAt: new Date(nowMs - 7200000).toISOString(),
    expiresAt: new Date(nowMs - 60000).toISOString(),
    status: 'active'
  };

  const revokedDel = Object.assign({}, activeDel, { id: 'DEL_3', status: 'revoked' });

  assert.equal(core.isDelegationActive(activeDel, nowMs), true);
  assert.equal(core.isDelegationActive(expiredDel, nowMs), false);
  assert.equal(core.isDelegationActive(revokedDel, nowMs), false);

  const promoted = core.applyActiveDelegationsToUser(baseAgent, [expiredDel, activeDel], nowMs);
  assert.equal(promoted.role, 'supervisor');
  assert.equal(promoted.baseRole, 'agent');
  assert.ok(promoted.permissions.indexOf('assign_employees') !== -1);
  assert.ok(promoted.permissions.indexOf('pin_reservation_note') !== -1);
  assert.equal(promoted.activeDelegation.id, 'DEL_1');

  const unpromoted = core.applyActiveDelegationsToUser(baseAgent, [expiredDel, revokedDel], nowMs);
  assert.equal(unpromoted.role, 'agent');
  assert.equal(unpromoted.activeDelegation, null);
});

test('computeAuditFieldDiffs extracts only changed fields with Arabic labels', () => {
  const diffs = core.computeAuditFieldDiffs(
    { totalAmount: 1200, internalStatus: 'تم الحجز', carName: 'كامري' },
    { totalAmount: 1450, internalStatus: 'تم التمديد', carName: 'كامري' },
    [
      { field: 'totalAmount', label: 'المبلغ الإجمالي' },
      { field: 'internalStatus', label: 'الحالة الداخلية' },
      { field: 'carName', label: 'السيارة' }
    ]
  );

  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs[0], { field: 'totalAmount', label: 'المبلغ الإجمالي', before: '1200', after: '1450' });
  assert.deepEqual(diffs[1], { field: 'internalStatus', label: 'الحالة الداخلية', before: 'تم الحجز', after: 'تم التمديد' });
});

test('ICS calendar builders generate valid RFC-5545 VCALENDAR/VEVENT output', () => {
  const res = {
    id: 'RES_ICS',
    reservationNumber: 'RG-9001',
    customerName: 'فهد الشمري',
    customerPhone: '0501234567',
    carName: 'هيونداي سوناتا 2026',
    companyName: 'ذيب',
    branchName: 'مطار الملك خالد',
    startDate: '2026-11-21',
    startTime: '10:00',
    endDate: '2026-11-24',
    endTime: '14:00',
    internalStatus: 'تم الحجز'
  };

  const events = core.buildReservationIcsEvents(res, 'ar');
  assert.equal(events.length, 2);
  const ics = core.buildIcsCalendarContent(events, 'Rental Gate CRM');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /SUMMARY:تسليم حجز #RG-9001/);
  assert.match(ics, /SUMMARY:استلام \/ نهاية حجز #RG-9001/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);

  const todayEvents = core.buildTodayScheduleIcsEvents(
    {
      items: [
        {
          movementType: 'pickup',
          scheduledDate: '2026-11-21',
          scheduledTime: '11:30',
          reservation: res
        }
      ]
    },
    'ar'
  );
  assert.equal(todayEvents.length, 1);
  assert.match(todayEvents[0].summary, /\[تسليم\] #RG-9001/);
});

test('CALL_WRAPUP_OUTCOMES exposes the 5 call outcomes with expected Arabic labels', () => {
  assert.equal(core.CALL_WRAPUP_OUTCOMES.length, 5);
  const keys = core.CALL_WRAPUP_OUTCOMES.map((o: { key: string }) => o.key);
  assert.deepEqual(keys, ['confirmed', 'no_answer', 'extending_24h', 'returning_on_time', 'callback_later']);
  const noAns = core.CALL_WRAPUP_OUTCOMES.find((o: { key: string }) => o.key === 'no_answer');
  assert.equal(noAns.isNoAnswer, true);
  assert.equal(noAns.labelAr, 'لم يرد');
  const ext = core.CALL_WRAPUP_OUTCOMES.find((o: { key: string }) => o.key === 'extending_24h');
  assert.match(ext.labelAr, /بيمدد خلال 24 ساعة/);
});

test('normalizeHandoverPdfVisibility inherits base handover settings and defaults all 7 table columns on', () => {
  const vis = core.normalizeHandoverPdfVisibility(
    { includeSummaryKpis: false, includeCustomerPhone: false, colPriority: false },
    {
      includeTodayMovements: true,
      includePending: false,
      includeClosed: true,
      includeOpenProblems: false,
      includeExpiring24h: true,
      autoIncludeNotes: false
    }
  );

  assert.equal(vis.includeSummaryKpis, false);
  assert.equal(vis.includeCustomerPhone, false);
  assert.equal(vis.colPriority, false);
  assert.equal(vis.colCategory, true);
  assert.equal(vis.colReservationNumber, true);
  assert.equal(vis.colCustomerName, true);
  assert.equal(vis.includeTodayMovements, true);
  assert.equal(vis.includePending, false);
  assert.equal(vis.includeClosed, true);
  assert.equal(vis.includeOpenProblems, false);
  assert.equal(vis.includeExpiring24h, true);
  assert.equal(vis.autoIncludeNotes, false);
});

test('buildShiftHandoverPdfPayload respects pdfVisibility for KPIs, notes, phone numbers, columns, and table omission', () => {
  const nowMs = new Date(2026, 10, 20, 14, 0, 0, 0).getTime();
  const todayStr = '2026-11-20';
  const inShiftIso = new Date(nowMs - 30 * 60 * 1000).toISOString();

  const summary = core.computeShiftHandoverSummary({
    reservations: [
      {
        id: 'PEND_1',
        reservationNumber: 'RG-P1',
        customerName: 'سالم الدوسري',
        customerPhone: '0551112233',
        carName: 'هيونداي سوناتا',
        branchName: 'الرياض',
        startDate: todayStr,
        startTime: '13:00',
        endDate: '2026-11-22',
        endTime: '13:00',
        internalStatus: 'قيد الانتظار',
        priority: 'مرتفع',
        lastUpdatedAt: inShiftIso
      },
      {
        id: 'CLOS_1',
        reservationNumber: 'RG-C1',
        customerName: 'خالد الحربي',
        customerPhone: '0559998877',
        carName: 'تويوتا كامري',
        branchName: 'جدة',
        startDate: '2026-11-18',
        endDate: todayStr,
        endTime: '11:00',
        internalStatus: 'تم الاستلام',
        lastUpdatedAt: inShiftIso
      }
    ],
    problems: [
      {
        id: 'PRB_1',
        problemNumber: 'P-100',
        reservationNumber: 'RG-P1',
        customerName: 'سالم الدوسري',
        status: 'مفتوحة',
        priority: 'مرتفع',
        description: 'تأخر تأكيد الدفع',
        createdAt: inShiftIso
      }
    ],
    followUps: [],
    notes: 'تأكد من متابعة حجز RG-P1 أولاً',
    nowMs
  });

  // 1) Custom columns + hidden phone + hidden KPIs + hidden notes + hidden Closed
  const customPayload = core.buildShiftHandoverPdfPayload(summary, 'ar', {
    pdfVisibility: {
      includeSummaryKpis: false,
      autoIncludeNotes: false,
      includePending: true,
      includeClosed: false,
      includeTodayMovements: true,
      includeOpenProblems: false,
      includeExpiring24h: false,
      includeCustomerPhone: false,
      colCategory: false,
      colReservationNumber: true,
      colCustomerName: true,
      colCarName: false,
      colStatus: true,
      colPriority: false,
      colLastUpdate: false
    }
  });

  assert.equal(customPayload.summaryItems.length, 0);
  assert.deepEqual(
    customPayload.columns.map((c: { key: string }) => c.key),
    ['reservationNumber', 'customerName', 'internalStatus']
  );
  assert.equal(customPayload.rows.length, 1);
  assert.equal(customPayload.rows[0].customerName, 'سالم الدوسري');
  assert.equal(customPayload.extraSections.length, 1);
  assert.ok(!customPayload.extraSections[0].lines[0].includes('0551112233'));

  // 2) Both pending and closed hidden -> table completely omitted (columns=[] and rows=[])
  const noTablePayload = core.buildShiftHandoverPdfPayload(summary, 'ar', {
    pdfVisibility: {
      includeSummaryKpis: true,
      autoIncludeNotes: true,
      includePending: false,
      includeClosed: false,
      includeTodayMovements: false,
      includeOpenProblems: true,
      includeExpiring24h: false
    }
  });

  assert.equal(noTablePayload.summaryItems.length, 8);
  assert.equal(noTablePayload.columns.length, 0);
  assert.equal(noTablePayload.rows.length, 0);
  assert.equal(noTablePayload.extraSections.length, 1);
});

