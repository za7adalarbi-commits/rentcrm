/**
 * RENTAL GATE CRM — Pure Domain Core (Shared by Browser Frontend & Node Unit Tests)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RGCrmCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROLES = {
    GENERAL_MANAGER: 'general_manager',
    SUPERVISOR: 'supervisor',
    AGENT: 'agent'
  };

  var ROLE_LABELS = {
    ar: {
      general_manager: 'المدير العام',
      supervisor: 'المشرف',
      agent: 'موظف خدمة العملاء'
    },
    en: {
      general_manager: 'General Manager',
      supervisor: 'Supervisor',
      agent: 'Customer Support Agent'
    }
  };

  var FOLLOWUP_STATUSES = [
    'تم الحجز',
    'تم التسليم',
    'تم الاستلام',
    'تم الإنشاء',
    'تم الإلغاء',
    'تم التمديد',
    'لم يتم الحجز'
  ];

  var PROBLEM_PRIORITIES = ['عادي', 'متوسط', 'مرتفع'];

  var PROBLEM_STATUSES = [
    'جديدة',
    'قيد المعالجة',
    'بانتظار العميل',
    'بانتظار الشركة',
    'تم الحل',
    'مغلقة'
  ];

  var STATUS_TRANSLATIONS = {
    pending: 'قيد الانتظار',
    new: 'جديد',
    created: 'تم الإنشاء',
    confirmed: 'مؤكد',
    booked: 'تم الحجز',
    reserved: 'تم الحجز',
    active: 'نشط',
    started: 'بدأ التنفيذ',
    in_progress: 'قيد التنفيذ',
    hold: 'معلق',
    delivered: 'تم التسليم',
    picked_up: 'تم الاستلام',
    received: 'تم الاستلام',
    extended: 'تم التمديد',
    automatically_extended: 'تم التمديد تلقائيًا',
    completed: 'مكتمل',
    finished: 'مكتمل',
    finished_by_driver: 'مكتمل عبر السائق',
    cancelled: 'ملغي',
    canceled: 'ملغي',
    declined: 'مرفوض',
    rejected: 'مرفوض',
    expired: 'منتهي',
    no_show: 'لم يحضر',
    draft: 'مسودة',
    unpaid: 'غير مدفوع',
    paid: 'مدفوع',
    wallet_paid: 'مدفوع بالمحفظة',
    admin_approved: 'معتمد إداريًا',
    location_changed: 'تم تغيير الموقع',
    accepted: 'مقبول',
    approved: 'مقبول'
  };

  var WORKFLOW_STATUS_OPTIONS = (function () {
    var seen = {};
    var out = [];
    function pushUnique(st) {
      var clean = normalizeStr(st);
      if (!clean || clean === 'غير محدد' || seen[clean]) return;
      seen[clean] = true;
      out.push(clean);
    }
    for (var i = 0; i < FOLLOWUP_STATUSES.length; i++) {
      pushUnique(FOLLOWUP_STATUSES[i]);
    }
    var mapKeys = Object.keys(STATUS_TRANSLATIONS);
    for (var j = 0; j < mapKeys.length; j++) {
      pushUnique(STATUS_TRANSLATIONS[mapKeys[j]]);
    }
    return out;
  }());

  var DELIVERY_TRANSLATIONS = {
    branch: 'استلام من الفرع',
    office: 'استلام من المكتب',
    pickup: 'استلام من الفرع',
    delivery: 'توصيل للموقع',
    home: 'توصيل للمنزل',
    airport: 'توصيل للمطار',
    train_station: 'محطة القطار',
    my_location: 'توصيل لموقع العميل',
    hotel: 'توصيل للفندق',
    return_branch: 'تسليم في الفرع',
    return_delivery: 'استلام من موقع العميل'
  };

  var PULL_DURATION_PRESETS = [
    { key: 'all', label: 'الكل (بدون تقييد تاريخ)', labelEn: 'All Dates' },
    { key: 'today', label: 'اليوم', labelEn: 'Today' },
    { key: '3d', label: 'آخر 3 أيام', labelEn: 'Last 3 Days' },
    { key: '7d', label: 'آخر 7 أيام', labelEn: 'Last 7 Days' },
    { key: '30d', label: 'آخر 30 يومًا', labelEn: 'Last 30 Days' },
    { key: 'month', label: 'هذا الشهر', labelEn: 'This Month' },
    { key: 'custom', label: 'من تاريخ معين / نطاق مخصص', labelEn: 'From Specific Date' }
  ];

  function normalizeStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function toNum(v, fallback) {
    var n = Number(v);
    return isNaN(n) ? (fallback || 0) : n;
  }

  function formatDisplayDate(val) {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      var shiftedDate = new Date(val.getTime() + 3 * 3600000);
      return shiftedDate.toISOString().substring(0, 10);
    }
    var s = String(val).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Wall-clock API timestamp without Z/offset (e.g. 2026-11-17T15:24:00)
    var wallMatch = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/);
    if (wallMatch) return wallMatch[1];
    // UTC Z or offset timestamp (e.g. Google Sheets midnight 2026-11-16T22:00:00.000Z -> 2026-11-17)
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      var riyadhShifted = new Date(parsed.getTime() + 3 * 3600000);
      return riyadhShifted.toISOString().substring(0, 10);
    }
    return s.substring(0, 10);
  }

  function formatDisplayDateTime(val) {
    if (val === null || val === undefined || val === '') return '';
    var s = String(val).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var wallMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (wallMatch && s.indexOf('Z') === -1 && !/[+-]\d{2}:?\d{2}$/.test(s)) {
      return wallMatch[1] + ' ' + wallMatch[2];
    }
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      var riyadhShifted = new Date(parsed.getTime() + 3 * 3600000);
      return riyadhShifted.toISOString().replace('T', ' ').substring(0, 16);
    }
    return s.replace('T', ' ').substring(0, 16);
  }

  function translateOriginalStatus(code) {
    var key = normalizeStr(code).toLowerCase().replace(/\s+/g, '_');
    return STATUS_TRANSLATIONS[key] || normalizeStr(code) || 'غير محدد';
  }

  function resolveSourceWorkflowStatus(apiItem) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var statusCode = normalizeStr(item.reservationStatus || item.status || item.status_code).toLowerCase().replace(/\s+/g, '_');
    if (statusCode) {
      var translated = translateOriginalStatus(statusCode);
      if (translated && translated !== 'غير محدد') return translated;
    }
    var explicitAr = normalizeStr(item.originalStatusAr || item.statusAr);
    if (explicitAr && explicitAr !== 'غير محدد') return explicitAr;
    return 'تم الإنشاء';
  }

  function isValidWorkflowStatus(status) {
    var clean = normalizeStr(status);
    if (!clean) return false;
    return WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1;
  }

  function getWorkflowStatusOptions(currentStatus) {
    var clean = normalizeStr(currentStatus);
    if (!clean || WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1) {
      return WORKFLOW_STATUS_OPTIONS.slice();
    }
    return [clean].concat(WORKFLOW_STATUS_OPTIONS);
  }

  function normalizeStatusHistory(raw) {
    var arr = [];
    if (Array.isArray(raw)) {
      arr = raw.slice();
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch (e) {}
    }
    return arr.filter(function (entry) {
      return entry && typeof entry === 'object' && normalizeStr(entry.newStatus || entry.status);
    }).map(function (entry, idx) {
      return {
        stageNumber: toNum(entry.stageNumber, idx + 1) || (idx + 1),
        source: normalizeStr(entry.source) || 'system',
        previousStatus: normalizeStr(entry.previousStatus),
        newStatus: normalizeStr(entry.newStatus || entry.status),
        sourceStatusCode: normalizeStr(entry.sourceStatusCode),
        changedAt: normalizeStr(entry.changedAt || entry.createdAt),
        changedById: normalizeStr(entry.changedById || entry.employeeId) || 'system',
        changedByName: normalizeStr(entry.changedByName || entry.employeeName) || 'النظام',
        note: normalizeStr(entry.note)
      };
    });
  }

  function formatStatusStageSourceLabel(source) {
    switch (normalizeStr(source)) {
      case 'api_pull':
        return 'سحب من Rental Gate';
      case 'quick_status':
        return 'تحديث سريع';
      case 'followup':
        return 'متابعة موظف';
      case 'supervisor_edit':
        return 'تعديل المشرف/المدير';
      default:
        return 'تحديث النظام';
    }
  }

  function appendStatusStageEntry(existingHistory, entry) {
    var list = normalizeStatusHistory(existingHistory);
    var e = (entry && typeof entry === 'object') ? entry : {};
    var nextStatus = normalizeStr(e.newStatus || e.status);
    if (!nextStatus) return list;

    var source = normalizeStr(e.source) || 'system';
    var last = list.length ? list[list.length - 1] : null;
    if (last && last.newStatus === nextStatus && source === 'api_pull' && normalizeStr(e.sourceStatusCode) === last.sourceStatusCode) {
      return list;
    }

    var stageNum = list.length + 1;
    list.push({
      stageNumber: stageNum,
      source: source,
      previousStatus: normalizeStr(e.previousStatus !== undefined ? e.previousStatus : (last ? last.newStatus : '')),
      newStatus: nextStatus,
      sourceStatusCode: normalizeStr(e.sourceStatusCode),
      changedAt: normalizeStr(e.changedAt) || new Date().toISOString(),
      changedById: normalizeStr(e.changedById) || 'system',
      changedByName: normalizeStr(e.changedByName) || 'النظام',
      note: normalizeStr(e.note)
    });
    return list;
  }

  function shiftIsoDateDays(isoDate, deltaDays) {
    var match = normalizeStr(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    var d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(deltaDays || 0)));
    return d.toISOString().substring(0, 10);
  }

  function resolvePullDateRange(options, todayStr) {
    var opts = (options && typeof options === 'object') ? options : {};
    var today = /^\d{4}-\d{2}-\d{2}$/.test(normalizeStr(todayStr))
      ? normalizeStr(todayStr)
      : formatDisplayDate(new Date());
    var preset = normalizeStr(opts.preset).toLowerCase() || 'all';
    var rawFrom = /^\d{4}-\d{2}-\d{2}$/.test(normalizeStr(opts.dateFrom)) ? normalizeStr(opts.dateFrom) : '';
    var rawTo = /^\d{4}-\d{2}-\d{2}$/.test(normalizeStr(opts.dateTo)) ? normalizeStr(opts.dateTo) : '';

    var dateFrom = rawFrom;
    var dateTo = rawTo;

    if (preset === 'today') {
      dateFrom = today;
      dateTo = today;
    } else if (preset === '3d') {
      dateFrom = shiftIsoDateDays(today, -2);
      dateTo = today;
    } else if (preset === '7d') {
      dateFrom = shiftIsoDateDays(today, -6);
      dateTo = today;
    } else if (preset === '30d') {
      dateFrom = shiftIsoDateDays(today, -29);
      dateTo = today;
    } else if (preset === 'month') {
      dateFrom = today.substring(0, 7) + '-01';
      dateTo = today;
    } else if (preset === 'all' && !rawFrom && !rawTo) {
      dateFrom = '';
      dateTo = '';
    } else if (rawFrom || rawTo) {
      preset = 'custom';
      dateFrom = rawFrom;
      dateTo = rawTo || (rawFrom ? today : '');
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      var tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }

    var hasCustomRange = Boolean((preset && preset !== 'all') || dateFrom || dateTo);
    return {
      preset: preset || (hasCustomRange ? 'custom' : 'all'),
      dateFrom: dateFrom,
      dateTo: dateTo,
      hasCustomRange: hasCustomRange
    };
  }

  function filterSourceReservationsByPullRange(items, range) {
    var list = Array.isArray(items) ? items : [];
    var r = (range && typeof range === 'object') ? range : {};
    var dFrom = normalizeStr(r.dateFrom);
    var dTo = normalizeStr(r.dateTo);
    if (!dFrom && !dTo) return list.slice();
    return list.filter(function (item) {
      if (!item || typeof item !== 'object') return false;
      var candidateDate = formatDisplayDate(
        item.reservationDate || item.createdAt || item.startDate || item.start_date || item.pickup_date
      );
      if (!candidateDate) return false;
      if (dFrom && candidateDate < dFrom) return false;
      if (dTo && candidateDate > dTo) return false;
      return true;
    });
  }

  function translateDeliveryType(type) {
    var key = normalizeStr(type).toLowerCase().replace(/\s+/g, '_');
    return DELIVERY_TRANSLATIONS[key] || normalizeStr(type) || 'استلام من الفرع';
  }

  function isExtensionAcceptedAndPaid(ext) {
    if (!ext || typeof ext !== 'object') return false;
    if (ext.rejectedByUserId || normalizeStr(ext.rejectionReason)) return false;

    var st = normalizeStr(ext.reservationStatus || ext.status || ext.status_code || ext.state).toLowerCase();
    if (['cancelled', 'canceled', 'declined', 'rejected', 'hold', 'created', 'draft', 'unpaid', 'expired', 'pending'].indexOf(st) !== -1) {
      return false;
    }

    var acceptedStatuses = [
      'accepted', 'approved', 'confirmed', 'active', 'completed', 'paid', 'wallet_paid',
      'admin_approved', 'extended', 'automatically_extended', 'started', 'in_progress',
      'finished', 'finished_by_driver', 'مقبول'
    ];
    if (acceptedStatuses.indexOf(st) === -1) return false;

    var explicitPay = normalizeStr(ext.payment_status || ext.paymentStatus || ext.is_paid).toLowerCase();
    if (explicitPay || ext.paid !== undefined) {
      return ['paid', 'completed', 'true', '1', 'مدفوع'].indexOf(explicitPay) !== -1 || ext.paid === true;
    }

    var payResult = normalizeStr(ext.paymentResult).toLowerCase();
    if (payResult && (payResult.indexOf('fail') !== -1 || payResult.indexOf('reject') !== -1 || payResult.indexOf('declin') !== -1 || payResult === 'unpaid')) {
      return false;
    }
    return Boolean(
      ext.paymentDate ||
      ['paid', 'wallet_paid', 'admin_approved', 'extended', 'automatically_extended', 'finished', 'finished_by_driver'].indexOf(st) !== -1 ||
      ['paid', 'captured', 'success', 'approved', 'completed'].indexOf(payResult) !== -1
    );
  }

  function computeTotalAmount(baseAmount, extensions) {
    var total = toNum(baseAmount, 0);
    if (Array.isArray(extensions)) {
      for (var i = 0; i < extensions.length; i++) {
        total += toNum(extensions[i].amount !== undefined ? extensions[i].amount : extensions[i].total, 0);
      }
    }
    return Math.round(total * 100) / 100;
  }

  function mergeSyncedReservation(existing, apiItem, acceptedExtensions, actor) {
    var resApiId = normalizeStr(apiItem.reservationId || apiItem.id);
    var resNumber = normalizeStr(apiItem.reservationNumber || apiItem.reservation_number || apiItem.code || apiItem.reference || resApiId);
    var statusCode = normalizeStr(apiItem.reservationStatus || apiItem.status || apiItem.status_code).toLowerCase();
    var exts = Array.isArray(acceptedExtensions) ? acceptedExtensions : [];
    var extAmountSum = 0;
    for (var i = 0; i < exts.length; i++) {
      extAmountSum += toNum(exts[i].amount !== undefined ? exts[i].amount : exts[i].total, 0);
    }
    if (exts.length === 0 && apiItem.extended && toNum(apiItem.extensionsTotal, 0) > 0) {
      extAmountSum = toNum(apiItem.extensionsTotal, 0);
    }

    var baseAmount = toNum(apiItem.total !== undefined ? apiItem.total : (apiItem.total_price || apiItem.amount || apiItem.base_amount), 0);
    var totalAmount = exts.length > 0
      ? computeTotalAmount(baseAmount, exts)
      : Math.round((baseAmount + extAmountSum) * 100) / 100;
    var now = new Date().toISOString();
    var actorId = (actor && (actor.employeeId || actor.id)) || 'system';
    var actorName = (actor && actor.name) || 'النظام';

    var sourceStatusAr = resolveSourceWorkflowStatus(apiItem);
    var prevHistory = existing ? normalizeStatusHistory(existing.statusHistory) : [];

    var nextInternalStatus = sourceStatusAr;
    var nextLastUpdateText = 'تم السحب من Rental Gate بالحالة: ' + sourceStatusAr;
    var nextLastUpdatedById = actorId;
    var nextLastUpdatedByName = actorName;
    var nextLastUpdatedAt = now;
    var nextStatusHistory = prevHistory;

    if (!existing) {
      nextStatusHistory = appendStatusStageEntry([], {
        source: 'api_pull',
        previousStatus: '',
        newStatus: sourceStatusAr,
        sourceStatusCode: statusCode,
        changedAt: now,
        changedById: actorId,
        changedByName: actorName,
        note: 'تم السحب من Rental Gate بالحالة: ' + sourceStatusAr
      });
    } else {
      var prevSourceCode = normalizeStr(existing.originalStatusCode).toLowerCase();
      var prevSourceAr = normalizeStr(existing.originalStatusAr);
      var prevInternalStatus = normalizeStr(existing.internalStatus);
      if (prevStatusHistoryMissing(prevHistory) && (prevInternalStatus || prevSourceAr)) {
        prevHistory = appendStatusStageEntry([], {
          source: 'api_pull',
          previousStatus: '',
          newStatus: prevInternalStatus || prevSourceAr,
          sourceStatusCode: prevSourceCode,
          changedAt: existing.createdAt || existing.lastUpdatedAt || now,
          changedById: existing.lastUpdatedById || 'system',
          changedByName: existing.lastUpdatedByName || 'النظام',
          note: 'المرحلة المسجلة قبل التحديث'
        });
      }

      var sourceChanged = Boolean(
        statusCode && (
          (prevSourceCode && statusCode !== prevSourceCode) ||
          (!prevSourceCode && prevSourceAr && sourceStatusAr !== prevSourceAr)
        )
      );

      if (sourceChanged) {
        nextInternalStatus = sourceStatusAr;
        nextLastUpdateText = 'تحديث الحالة من Rental Gate: ' + (prevInternalStatus || prevSourceAr || '-') + ' ← ' + sourceStatusAr;
        nextLastUpdatedById = actorId;
        nextLastUpdatedByName = actorName;
        nextLastUpdatedAt = now;
        nextStatusHistory = appendStatusStageEntry(prevHistory, {
          source: 'api_pull',
          previousStatus: prevInternalStatus || prevSourceAr,
          newStatus: sourceStatusAr,
          sourceStatusCode: statusCode,
          changedAt: now,
          changedById: actorId,
          changedByName: actorName,
          note: nextLastUpdateText
        });
      } else {
        nextInternalStatus = prevInternalStatus || sourceStatusAr;
        nextLastUpdateText = existing.lastUpdateText || ('تم الاستيراد من Rental Gate');
        nextLastUpdatedById = existing.lastUpdatedById || actorId;
        nextLastUpdatedByName = existing.lastUpdatedByName || actorName;
        nextLastUpdatedAt = existing.lastUpdatedAt || now;
        nextStatusHistory = prevHistory;
      }
    }

    return {
      id: existing ? existing.id : ('RES_' + resNumber),
      reservationNumber: resNumber,
      customerName: normalizeStr(apiItem.clientName || apiItem.customer_name || (apiItem.customer && apiItem.customer.name) || 'عميل'),
      customerPhone: normalizeStr(apiItem.clientMobile || apiItem.customer_phone || (apiItem.customer && apiItem.customer.phone) || ''),
      companyName: normalizeStr(apiItem.companyArName || apiItem.companyEnName || apiItem.company_name || (apiItem.company && apiItem.company.name) || ''),
      branchName: normalizeStr(apiItem.receiveBranchArName || apiItem.receiveBranchEnName || apiItem.branch_name || (apiItem.branch && apiItem.branch.name) || ''),
      carName: normalizeStr(apiItem.carNameAr || apiItem.carNameEn || apiItem.car_name || (apiItem.car && apiItem.car.name) || ''),
      plateNumber: normalizeStr(apiItem.plate_number || apiItem.plateNumber || (apiItem.car && apiItem.car.plate_number) || ''),
      startDate: formatDisplayDate(apiItem.startDate || apiItem.start_date || apiItem.pickup_date),
      endDate: formatDisplayDate(apiItem.actualEndDate || apiItem.endDate || apiItem.end_date || apiItem.return_date),
      daysCount: toNum(apiItem.reservationDays || apiItem.days_count || apiItem.days, 1),
      originalStatusCode: statusCode,
      originalStatusAr: translateOriginalStatus(statusCode),
      pickupTypeAr: translateDeliveryType(apiItem.receiveType || apiItem.pickup_type || apiItem.delivery_type),
      returnTypeAr: translateDeliveryType(apiItem.deliverType || apiItem.return_type || apiItem.dropoff_type),
      baseAmount: baseAmount,
      extensionsAmount: Math.round(extAmountSum * 100) / 100,
      totalAmount: totalAmount,
      hasExtensions: exts.length > 0 || Boolean(apiItem.extended),
      internalStatus: nextInternalStatus,
      priority: existing ? existing.priority : 'عادي',
      assignedEmployeeIds: existing ? existing.assignedEmployeeIds : [],
      assignedEmployeeNames: existing ? existing.assignedEmployeeNames : [],
      lastUpdateText: nextLastUpdateText,
      lastUpdatedById: nextLastUpdatedById,
      lastUpdatedByName: nextLastUpdatedByName,
      lastUpdatedAt: nextLastUpdatedAt,
      statusHistory: nextStatusHistory,
      hasProblem: existing ? Boolean(existing.hasProblem) : false,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function prevStatusHistoryMissing(arr) {
    return !Array.isArray(arr) || arr.length === 0;
  }

  function buildCustomersIndexFromReservations(reservations) {
    var list = Array.isArray(reservations) ? reservations : [];
    var byKey = {};
    var order = [];

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var rawPhone = normalizeStr(r.customerPhone).replace(/[\s\-()]/g, '');
      var rawName = normalizeStr(r.customerName);
      var key = rawPhone ? ('PH_' + rawPhone) : ('NM_' + rawName.toLowerCase());
      if (!key || key === 'NM_') continue;

      if (!byKey[key]) {
        byKey[key] = {
          id: key,
          customerName: rawName || 'عميل',
          customerPhone: normalizeStr(r.customerPhone),
          totalBookings: 0,
          totalSpent: 0,
          latestReservationId: r.id || '',
          latestReservationNumber: r.reservationNumber || '',
          lastBookingDate: formatDisplayDate(r.startDate || r.createdAt),
          lastUpdatedAt: normalizeStr(r.lastUpdatedAt || r.createdAt),
          reservationIds: [],
          companyNames: [],
          statuses: {}
        };
        order.push(key);
      }

      var c = byKey[key];
      c.totalBookings += 1;
      c.totalSpent = Math.round((c.totalSpent + toNum(r.totalAmount, 0)) * 100) / 100;
      if (r.id && c.reservationIds.indexOf(r.id) === -1) c.reservationIds.push(r.id);
      if (r.companyName && c.companyNames.indexOf(r.companyName) === -1) c.companyNames.push(r.companyName);
      if (r.internalStatus) c.statuses[r.internalStatus] = (c.statuses[r.internalStatus] || 0) + 1;
      var rStamp = normalizeStr(r.lastUpdatedAt || r.createdAt || r.startDate);
      if (!c.lastUpdatedAt || rStamp > c.lastUpdatedAt) {
        c.lastUpdatedAt = rStamp;
        c.customerName = rawName || c.customerName;
        c.latestReservationId = r.id || c.latestReservationId;
        c.latestReservationNumber = r.reservationNumber || c.latestReservationNumber;
        c.lastBookingDate = formatDisplayDate(r.startDate || r.createdAt) || c.lastBookingDate;
      }
    }

    return order.map(function (k) { return byKey[k]; }).sort(function (a, b) {
      return String(b.lastUpdatedAt || '').localeCompare(String(a.lastUpdatedAt || ''));
    });
  }

  function mergeReservationBatch(existingList, incomingList) {
    var map = {};
    var order = [];
    var base = Array.isArray(existingList) ? existingList : [];
    var inc = Array.isArray(incomingList) ? incomingList : [];

    for (var i = 0; i < base.length; i++) {
      var b = base[i];
      if (!b || !b.id) continue;
      map[b.id] = b;
      order.push(b.id);
    }
    for (var j = 0; j < inc.length; j++) {
      var item = inc[j];
      if (!item || !item.id) continue;
      if (!Object.prototype.hasOwnProperty.call(map, item.id)) {
        order.push(item.id);
      }
      map[item.id] = Object.assign({}, map[item.id] || {}, item);
    }
    return order.map(function (id) { return map[id]; });
  }

  var ROLE_PERMISSION_MATRIX = {
    general_manager: [
      'view_dashboard', 'view_all_reservations', 'pull_reservations', 'assign_employees', 'add_followup',
      'claim_reservation', 'unclaim_reservation', 'quick_update_status',
      'edit_any_followup', 'edit_reservation_details', 'edit_ticket_details',
      'create_problem', 'update_problem', 'view_employees', 'manage_employees',
      'view_all_logs', 'sync_data', 'manage_settings', 'export_reports'
    ],
    supervisor: [
      'view_dashboard', 'view_all_reservations', 'pull_reservations', 'assign_employees', 'add_followup',
      'claim_reservation', 'unclaim_reservation', 'quick_update_status',
      'edit_any_followup', 'edit_reservation_details', 'edit_ticket_details',
      'create_problem', 'update_problem', 'view_employees', 'view_all_logs',
      'sync_data', 'export_reports'
    ],
    agent: [
      'view_dashboard', 'pull_reservations', 'add_followup', 'claim_reservation', 'unclaim_reservation',
      'quick_update_status', 'create_problem', 'update_problem', 'export_reports'
    ]
  };

  var PERMISSIONS_CATALOG = [
    { key: 'view_dashboard', label: 'عرض لوحة التحكم والإحصائيات', group: 'عام' },
    { key: 'view_all_reservations', label: 'استعراض جميع الحجوزات', group: 'الحجوزات' },
    { key: 'pull_reservations', label: 'سحب وتحديث الحجوزات من قائمة الحجوزات', group: 'الحجوزات' },
    { key: 'claim_reservation', label: 'استلام الحجوزات ذاتيًا', group: 'الحجوزات' },
    { key: 'unclaim_reservation', label: 'إلغاء استلام الحجز', group: 'الحجوزات' },
    { key: 'quick_update_status', label: 'التحديث السريع لحالة الحجز', group: 'الحجوزات' },
    { key: 'add_followup', label: 'إضافة متابعات وملاحظات', group: 'المتابعات' },
    { key: 'edit_any_followup', label: 'تعديل متابعات وتحديثات الفريق', group: 'المتابعات' },
    { key: 'assign_employees', label: 'إسناد وإزالة الموظفين عن الحجوزات', group: 'الإشراف' },
    { key: 'edit_reservation_details', label: 'تعديل تفاصيل الحجوزات والأسعار', group: 'الإشراف' },
    { key: 'create_problem', label: 'تحويل الحجز إلى مشكلة / تذكرة', group: 'المشكلات' },
    { key: 'update_problem', label: 'تحديث حالة التذاكر والمشكلات', group: 'المشكلات' },
    { key: 'edit_ticket_details', label: 'تعديل بيانات ووصف التذاكر', group: 'الإشراف' },
    { key: 'view_employees', label: 'عرض الموظفين وملفات عملائهم', group: 'الإشراف' },
    { key: 'view_all_logs', label: 'الاطلاع على سجل نشاطات الفريق', group: 'التقارير والرقابة' },
    { key: 'export_reports', label: 'تصدير تقارير Excel وPDF', group: 'التقارير والرقابة' },
    { key: 'sync_data', label: 'الوصول إلى Rental Gate API والمزامنة', group: 'الإدارة والربط (API)' },
    { key: 'manage_employees', label: 'إدارة حسابات الموظفين وصلاحياتهم', group: 'الإدارة والربط (API)' },
    { key: 'manage_settings', label: 'تعديل إعدادات النظام والتحديث التلقائي', group: 'الإدارة والربط (API)' }
  ];

  var JOB_ROLE_PRESETS = [
    {
      id: 'agent_standard',
      label: 'موظف خدمة عملاء (الافتراضي)',
      jobTitle: 'موظف خدمة العملاء',
      role: ROLES.AGENT,
      permissions: ROLE_PERMISSION_MATRIX.agent.slice()
    },
    {
      id: 'agent_senior',
      label: 'موظف متابعة أول (صلاحيات موسعة)',
      jobTitle: 'موظف متابعة أول',
      role: ROLES.AGENT,
      permissions: ROLE_PERMISSION_MATRIX.agent.concat(['view_all_reservations', 'view_employees', 'edit_any_followup'])
    },
    {
      id: 'qa_reports',
      label: 'مسؤول جودة وتقارير (قراءة وتصدير)',
      jobTitle: 'أخصائي جودة وتقارير',
      role: ROLES.AGENT,
      permissions: ['view_dashboard', 'view_all_reservations', 'view_employees', 'view_all_logs', 'export_reports']
    },
    {
      id: 'supervisor_ops',
      label: 'مشرف عمليات ومتابعة (مع صلاحية API)',
      jobTitle: 'مشرف خدمة العملاء',
      role: ROLES.SUPERVISOR,
      permissions: ROLE_PERMISSION_MATRIX.supervisor.slice()
    },
    {
      id: 'general_manager',
      label: 'المدير العام (كامل الصلاحيات)',
      jobTitle: 'المدير العام',
      role: ROLES.GENERAL_MANAGER,
      permissions: ROLE_PERMISSION_MATRIX.general_manager.slice()
    }
  ];

  function resolveEffectivePermissions(roleOrUser) {
    if (!roleOrUser) return [];
    if (typeof roleOrUser === 'string') {
      return (ROLE_PERMISSION_MATRIX[roleOrUser] || []).slice();
    }
    var role = roleOrUser.role || ROLES.AGENT;
    var rawPerms = Array.isArray(roleOrUser.permissions) ? roleOrUser.permissions : [];
    if (rawPerms.indexOf('all') !== -1) {
      return ROLE_PERMISSION_MATRIX.general_manager.slice();
    }
    var isLegacyRoleOnly = rawPerms.length === 0 || (
      rawPerms.length === 1 &&
      [ROLES.AGENT, ROLES.SUPERVISOR, ROLES.GENERAL_MANAGER].indexOf(rawPerms[0]) !== -1
    );
    if (isLegacyRoleOnly) {
      return (ROLE_PERMISSION_MATRIX[role] || []).slice();
    }
    return rawPerms.slice();
  }

  function canAccessApi(roleOrUser) {
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    return role === ROLES.GENERAL_MANAGER || role === ROLES.SUPERVISOR;
  }

  function canUserPerform(roleOrUser, action) {
    if (!roleOrUser || !action) return false;
    if (action === 'sync_data' || action === 'manage_api_connection') {
      if (!canAccessApi(roleOrUser)) return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    return allowed.indexOf(action) !== -1;
  }

  function mergePermissionsCatalog(customItems) {
    var overrides = Array.isArray(customItems) ? customItems : [];
    var overrideMap = {};
    var extras = [];
    for (var i = 0; i < overrides.length; i++) {
      var item = overrides[i];
      if (!item || !item.key) continue;
      var cleanKey = normalizeStr(item.key);
      if (!cleanKey) continue;
      overrideMap[cleanKey] = {
        key: cleanKey,
        label: normalizeStr(item.label) || cleanKey,
        group: normalizeStr(item.group) || 'صلاحيات مخصصة',
        isCustom: Boolean(item.isCustom)
      };
    }

    var builtInKeys = {};
    var result = [];
    for (var b = 0; b < PERMISSIONS_CATALOG.length; b++) {
      var base = PERMISSIONS_CATALOG[b];
      builtInKeys[base.key] = true;
      var ov = overrideMap[base.key];
      result.push({
        key: base.key,
        label: ov ? ov.label : base.label,
        group: ov ? ov.group : base.group,
        isCustom: false,
        isRenamed: Boolean(ov && (ov.label !== base.label || ov.group !== base.group))
      });
    }

    for (var j = 0; j < overrides.length; j++) {
      var cand = overrides[j];
      if (!cand || !cand.key) continue;
      var ck = normalizeStr(cand.key);
      if (!ck || builtInKeys[ck] || extras.some(function (x) { return x.key === ck; })) continue;
      extras.push({
        key: ck,
        label: normalizeStr(cand.label) || ck,
        group: normalizeStr(cand.group) || 'صلاحيات مخصصة',
        isCustom: true,
        isRenamed: false
      });
    }

    return result.concat(extras);
  }

  function sanitizePresetPermissions(role, perms) {
    var list = Array.isArray(perms) ? perms : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var k = normalizeStr(list[i]);
      if (!k || seen[k]) continue;
      if (role === ROLES.AGENT && (k === 'sync_data' || k === 'manage_api_connection')) continue;
      seen[k] = true;
      out.push(k);
    }
    return out;
  }

  function normalizeRolePresets(rawPresets) {
    var source = Array.isArray(rawPresets) && rawPresets.length > 0 ? rawPresets : JOB_ROLE_PRESETS;
    var out = [];
    var seen = {};
    for (var i = 0; i < source.length; i++) {
      var p = source[i];
      if (!p) continue;
      var pid = normalizeStr(p.id) || ('preset_' + (i + 1));
      if (seen[pid]) continue;
      seen[pid] = true;
      var role = [ROLES.GENERAL_MANAGER, ROLES.SUPERVISOR, ROLES.AGENT].indexOf(p.role) !== -1 ? p.role : ROLES.AGENT;
      out.push({
        id: pid,
        label: normalizeStr(p.label) || normalizeStr(p.jobTitle) || pid,
        jobTitle: normalizeStr(p.jobTitle) || normalizeStr(p.label) || 'موظف خدمة العملاء',
        role: role,
        permissions: sanitizePresetPermissions(role, p.permissions)
      });
    }
    return out;
  }

  function upsertRolePreset(presets, input) {
    var list = normalizeRolePresets(presets);
    var label = normalizeStr(input && input.label);
    if (!label) throw new Error('اسم الصلاحية الجاهزة مطلوب.');
    var role = [ROLES.GENERAL_MANAGER, ROLES.SUPERVISOR, ROLES.AGENT].indexOf(input.role) !== -1 ? input.role : ROLES.AGENT;
    var jobTitle = normalizeStr(input && input.jobTitle) || label;
    var perms = sanitizePresetPermissions(role, input && input.permissions);
    var pid = normalizeStr(input && input.id);

    var idx = -1;
    if (pid) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === pid) { idx = i; break; }
      }
    }

    var record = {
      id: idx !== -1 ? pid : (pid || ('PRESET_' + Date.now().toString(36).toUpperCase() + '_' + Math.random().toString(36).slice(2, 6).toUpperCase())),
      label: label,
      jobTitle: jobTitle,
      role: role,
      permissions: perms
    };

    if (idx !== -1) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    return { presets: list, saved: record, isNew: idx === -1 };
  }

  function removeRolePreset(presets, presetId) {
    var list = normalizeRolePresets(presets);
    var target = normalizeStr(presetId);
    if (!target) throw new Error('معرف الصلاحية الجاهزة مطلوب.');
    var next = list.filter(function (p) { return p.id !== target; });
    if (next.length === 0) {
      throw new Error('يجب الإبقاء على قالب صلاحية جاهزة واحد على الأقل.');
    }
    return next;
  }

  function upsertPermissionDefinition(customItems, input) {
    var list = Array.isArray(customItems) ? customItems.slice() : [];
    var label = normalizeStr(input && input.label);
    var group = normalizeStr(input && input.group) || 'صلاحيات مخصصة';
    if (!label) throw new Error('اسم الصلاحية مطلوب.');

    var rawKey = normalizeStr(input && input.key);
    if (!rawKey) {
      rawKey = 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
    }
    rawKey = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!rawKey) throw new Error('مفتاح الصلاحية غير صالح.');

    var isBuiltIn = PERMISSIONS_CATALOG.some(function (b) { return b.key === rawKey; });
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (normalizeStr(list[i].key) === rawKey) { idx = i; break; }
    }

    var item = {
      key: rawKey,
      label: label,
      group: group,
      isCustom: !isBuiltIn
    };

    if (idx !== -1) {
      list[idx] = item;
    } else {
      list.push(item);
    }
    return { customPermissions: list, saved: item, catalog: mergePermissionsCatalog(list) };
  }

  function removePermissionDefinition(customItems, key) {
    var list = Array.isArray(customItems) ? customItems.slice() : [];
    var target = normalizeStr(key);
    if (!target) throw new Error('مفتاح الصلاحية مطلوب.');
    var isBuiltIn = PERMISSIONS_CATALOG.some(function (b) { return b.key === target; });
    var next = list.filter(function (c) { return normalizeStr(c.key) !== target; });
    return {
      customPermissions: next,
      removedKey: isBuiltIn ? null : target,
      resetBuiltIn: isBuiltIn,
      catalog: mergePermissionsCatalog(next)
    };
  }

  function claimReservationRecord(reservation, employee) {
    var ids = Array.isArray(reservation && reservation.assignedEmployeeIds) ? reservation.assignedEmployeeIds.slice() : [];
    var names = Array.isArray(reservation && reservation.assignedEmployeeNames) ? reservation.assignedEmployeeNames.slice() : [];
    var empId = normalizeStr(employee && employee.id);
    var empName = normalizeStr(employee && employee.name);
    if (!empId) return { assignedEmployeeIds: ids, assignedEmployeeNames: names, added: false };
    if (ids.indexOf(empId) !== -1) {
      return { assignedEmployeeIds: ids, assignedEmployeeNames: names, added: false };
    }
    ids.push(empId);
    names.push(empName || empId);
    return { assignedEmployeeIds: ids, assignedEmployeeNames: names, added: true };
  }

  function unclaimReservationRecord(reservation, employeeId) {
    var ids = Array.isArray(reservation && reservation.assignedEmployeeIds) ? reservation.assignedEmployeeIds : [];
    var names = Array.isArray(reservation && reservation.assignedEmployeeNames) ? reservation.assignedEmployeeNames : [];
    var targetId = normalizeStr(employeeId);
    var nextIds = [];
    var nextNames = [];
    var removed = false;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === targetId) {
        removed = true;
      } else {
        nextIds.push(ids[i]);
        if (names[i]) nextNames.push(names[i]);
      }
    }
    return { assignedEmployeeIds: nextIds, assignedEmployeeNames: nextNames, removed: removed };
  }

  function filterReservations(reservations, followUps, filters, userContext) {
    var f = filters || {};
    var search = normalizeStr(f.search).toLowerCase();
    var followedSet = {};
    if (Array.isArray(followUps)) {
      for (var i = 0; i < followUps.length; i++) {
        followedSet[followUps[i].reservationId] = true;
      }
    }

    var allowAgentViewAll = !userContext || userContext.allowAgentViewAll !== false;
    var out = [];

    for (var j = 0; j < reservations.length; j++) {
      var r = reservations[j];
      var assignedIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];

      if (userContext && userContext.role === ROLES.AGENT && !allowAgentViewAll && !(userContext.user && canUserPerform(userContext.user, 'view_all_reservations'))) {
        if (assignedIds.indexOf(userContext.employeeId) === -1) continue;
      }

      if (search) {
        var hay = (
          normalizeStr(r.reservationNumber) + ' ' +
          normalizeStr(r.customerName) + ' ' +
          normalizeStr(r.customerPhone) + ' ' +
          normalizeStr(r.carName) + ' ' +
          normalizeStr(r.companyName) + ' ' +
          normalizeStr(r.branchName)
        ).toLowerCase();
        if (hay.indexOf(search) === -1) continue;
      }

      if (f.company && r.companyName !== f.company) continue;
      if (f.branch && r.branchName !== f.branch) continue;
      if (f.status && r.internalStatus !== f.status && r.originalStatusAr !== f.status) continue;
      if (f.priority && r.priority !== f.priority) continue;
      if (f.employeeId && assignedIds.indexOf(f.employeeId) === -1) continue;
      if (f.dateFrom && r.startDate < f.dateFrom) continue;
      if (f.dateTo && r.startDate > f.dateTo) continue;
      if (f.unfollowedOnly && followedSet[r.id]) continue;
      if (f.hasProblemsOnly && !r.hasProblem) continue;

      out.push(Object.assign({}, r, { isFollowed: Boolean(followedSet[r.id]) }));
    }

    var sortBy = f.sortBy || 'lastUpdatedAt';
    var sortDir = f.sortDir === 'asc' ? 1 : -1;
    out.sort(function (a, b) {
      var va = a[sortBy];
      var vb = b[sortBy];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
      return String(va || '').localeCompare(String(vb || '')) * sortDir;
    });

    return out;
  }

  function computeDashboardMetrics(reservations, followUps, problems, employees, dateRange, todayStr) {
    var today = todayStr || new Date().toISOString().substring(0, 10);
    var start = (dateRange && dateRange.start) || '';
    var end = (dateRange && dateRange.end) || '';

    var filteredRes = (reservations || []).filter(function (r) {
      var d = normalizeStr(r.startDate || r.createdAt).substring(0, 10);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    var statusCounts = {};
    for (var s = 0; s < FOLLOWUP_STATUSES.length; s++) {
      statusCounts[FOLLOWUP_STATUSES[s]] = 0;
    }

    var companyCounts = {};
    var todayReservations = 0;
    var newReservations = 0;

    for (var i = 0; i < filteredRes.length; i++) {
      var r = filteredRes[i];
      var st = r.internalStatus || 'تم الإنشاء';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      var createdDate = normalizeStr(r.createdAt).substring(0, 10);
      var startDate = normalizeStr(r.startDate).substring(0, 10);
      if (createdDate === today || startDate === today) {
        todayReservations++;
      }
      if (st === 'تم الإنشاء' || st === 'جديد' || st === 'قيد الانتظار') newReservations++;
      var comp = r.companyName || 'غير محدد';
      companyCounts[comp] = (companyCounts[comp] || 0) + 1;
    }

    var todayFollowUps = 0;
    var dailyFollowUps = {};
    var empFollowUpCounts = {};

    for (var f = 0; f < (followUps || []).length; f++) {
      var fu = followUps[f];
      if (fu.followUpDate === today) todayFollowUps++;
      if (start && fu.followUpDate < start) continue;
      if (end && fu.followUpDate > end) continue;
      dailyFollowUps[fu.followUpDate] = (dailyFollowUps[fu.followUpDate] || 0) + 1;
      empFollowUpCounts[fu.employeeName] = (empFollowUpCounts[fu.employeeName] || 0) + 1;
    }

    var openProblems = 0;
    var closedProblems = 0;
    var highProblems = 0;
    var problemPriorities = { 'عادي': 0, 'متوسط': 0, 'مرتفع': 0 };

    for (var p = 0; p < (problems || []).length; p++) {
      var pr = problems[p];
      var isClosed = pr.status === 'مغلقة' || pr.status === 'تم الحل';
      if (isClosed) closedProblems++;
      else openProblems++;
      if (pr.priority === 'مرتفع' && !isClosed) highProblems++;
      if (Object.prototype.hasOwnProperty.call(problemPriorities, pr.priority)) {
        problemPriorities[pr.priority]++;
      }
    }

    var employeeComparison = (employees || [])
      .filter(function (e) { return e.status === 'active'; })
      .map(function (emp) {
        var assignedCount = 0;
        for (var r2 = 0; r2 < filteredRes.length; r2++) {
          var ids = Array.isArray(filteredRes[r2].assignedEmployeeIds) ? filteredRes[r2].assignedEmployeeIds : [];
          if (ids.indexOf(emp.id) !== -1) assignedCount++;
        }
        return {
          name: emp.name,
          followUps: empFollowUpCounts[emp.name] || 0,
          assigned: assignedCount
        };
      });

    return {
      kpis: {
        totalReservations: filteredRes.length,
        todayReservations: todayReservations,
        newReservations: newReservations,
        booked: statusCounts['تم الحجز'],
        delivered: statusCounts['تم التسليم'],
        received: statusCounts['تم الاستلام'],
        created: statusCounts['تم الإنشاء'],
        cancelled: statusCounts['تم الإلغاء'],
        extended: statusCounts['تم التمديد'],
        notBooked: statusCounts['لم يتم الحجز'],
        openProblems: openProblems,
        highProblems: highProblems,
        todayFollowUps: todayFollowUps
      },
      charts: {
        statusDistribution: statusCounts,
        employeePerformance: empFollowUpCounts,
        dailyFollowUps: dailyFollowUps,
        problemsByPriority: problemPriorities,
        problemsOpenVsClosed: { open: openProblems, closed: closedProblems },
        reservationsByCompany: companyCounts,
        employeeComparison: employeeComparison
      }
    };
  }

  function resolveAssetUrl(relativePath, baseUrl) {
    var cleanRel = normalizeStr(relativePath).replace(/^\/+/, '');
    var base = normalizeStr(baseUrl || (typeof root !== 'undefined' && root.__RG_BASE_URL__) || './');
    if (!base) base = './';
    if (base.charAt(base.length - 1) !== '/') base += '/';
    return base + cleanRel;
  }

  function resolveRouteFromLocation(pathname, hash, search, basePath, validRoutes, fallbackRoute) {
    var allowed = Array.isArray(validRoutes) && validRoutes.length
      ? validRoutes
      : ['dashboard', 'reservations', 'my-followups', 'team-followups', 'problems', 'reports', 'employees', 'activity', 'settings'];
    var fallback = fallbackRoute || 'dashboard';

    function cleanCandidate(raw) {
      var s = normalizeStr(raw).replace(/^#\/?/, '').replace(/^\/+|\/+$/g, '');
      if (!s) return '';
      try { s = decodeURIComponent(s); } catch (e) {}
      var seg = s.split('/')[0];
      return allowed.indexOf(seg) !== -1 ? seg : '';
    }

    var fromHash = cleanCandidate(hash);
    if (fromHash) return fromHash;

    var q = normalizeStr(search).replace(/^\?/, '');
    if (q) {
      var parts = q.split('&');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv[0] === 'route' || kv[0] === 'p') {
          var fromQuery = cleanCandidate(kv[1] || '');
          if (fromQuery) return fromQuery;
        }
      }
    }

    var p = normalizeStr(pathname);
    var b = normalizeStr(basePath || '/');
    if (b && b !== './' && p.indexOf(b) === 0) {
      p = p.slice(b.length);
    } else if (p.indexOf('/RENT-CRM/') === 0) {
      p = p.slice('/RENT-CRM/'.length);
    }
    var fromPath = cleanCandidate(p);
    return fromPath || fallback;
  }

  function dedupeReservationsByNumber(items) {
    var map = {};
    var order = [];
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var key = normalizeStr(item.reservation_number || item.reservationNumber || item.code || item.reference || item.id);
      if (!key) continue;
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        order.push(key);
      }
      map[key] = item;
    }
    return order.map(function (k) { return map[k]; });
  }

  function dedupeExtensionsByNumber(items) {
    var map = {};
    var order = [];
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var ext = list[i];
      if (!ext || typeof ext !== 'object') continue;
      var key = normalizeStr(ext.extensionNumber || ext.extension_number || ext.code || ext.id);
      if (!key) continue;
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        order.push(key);
      }
      map[key] = ext;
    }
    return order.map(function (k) { return map[k]; });
  }

  function validateGasUrl(rawUrl) {
    var clean = normalizeStr(rawUrl);
    if (!clean) {
      return { valid: true, normalized: '', isSandbox: true, message: '' };
    }
    if (!/^https?:\/\//i.test(clean)) {
      return {
        valid: false,
        normalized: clean,
        isSandbox: false,
        message: 'يجب أن يبدأ رابط Google Apps Script بـ https://'
      };
    }
    if (/docs\.google\.com\/spreadsheets/i.test(clean)) {
      return {
        valid: false,
        normalized: clean,
        isSandbox: false,
        message: 'هذا رابط Google Sheets وليس رابط Web App (/exec) من Google Apps Script.'
      };
    }
    if (/\/dev(\?.*)?$/i.test(clean)) {
      return {
        valid: false,
        normalized: clean,
        isSandbox: false,
        message: 'رابط /dev مخصص للمحرر فقط ولا يعمل مع المستخدمين. استخدم رابط النشر المنتهي بـ /exec.'
      };
    }
    if (!/script\.(google|googleusercontent)\.com/i.test(clean) || clean.indexOf('/exec') === -1) {
      return {
        valid: false,
        normalized: clean,
        isSandbox: false,
        message: 'تأكد من نسخ رابط Web App الكامل المنتهي بـ /exec من نافذة Deploy في Apps Script.'
      };
    }
    return { valid: true, normalized: clean, isSandbox: false, message: '' };
  }

  function extractGasUrlFromSearch(search) {
    var q = normalizeStr(search).replace(/^\?/, '');
    if (!q) return '';
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var eqIdx = parts[i].indexOf('=');
      if (eqIdx === -1) continue;
      var k = parts[i].slice(0, eqIdx);
      var v = parts[i].slice(eqIdx + 1);
      if (k === 'gasUrl' || k === 'gas' || k === 'api') {
        try {
          var decoded = decodeURIComponent(v.replace(/\+/g, ' '));
          var check = validateGasUrl(decoded);
          if (check.valid && !check.isSandbox) return check.normalized;
        } catch (e) {}
      }
    }
    return '';
  }

  function resolveGasConnection(search, storedVal, defaultConfigUrl) {
    var q = normalizeStr(search).replace(/^\?/, '');
    var parts = q ? q.split('&') : [];
    var queryAction = '';
    for (var i = 0; i < parts.length; i++) {
      var eqIdx = parts[i].indexOf('=');
      if (eqIdx === -1) continue;
      var k = parts[i].slice(0, eqIdx);
      var rawV = '';
      try { rawV = decodeURIComponent(parts[i].slice(eqIdx + 1).replace(/\+/g, ' ')).trim(); } catch (e) { rawV = ''; }
      if ((k === 'sandbox' && (rawV === '1' || rawV === 'true')) || (k === 'mode' && rawV === 'sandbox') || (k === 'gasUrl' && rawV === 'sandbox')) {
        queryAction = 'sandbox';
        break;
      }
      if ((k === 'gasUrl' || k === 'gas' || k === 'api') && (rawV === 'default' || rawV === 'reset' || rawV === 'auto')) {
        queryAction = 'reset_default';
      }
    }

    var defCheck = validateGasUrl(defaultConfigUrl);
    var validDefault = (defCheck.valid && !defCheck.isSandbox) ? defCheck.normalized : '';

    if (queryAction === 'sandbox') {
      return { url: '', source: 'sandbox_param', defaultUrl: validDefault, persist: false, clearStored: false };
    }
    if (queryAction === 'reset_default') {
      return {
        url: validDefault,
        source: validDefault ? 'global_config' : 'sandbox',
        defaultUrl: validDefault,
        persist: false,
        clearStored: true
      };
    }

    var fromSearch = extractGasUrlFromSearch(search);
    if (fromSearch) {
      return { url: fromSearch, source: 'query_param', defaultUrl: validDefault, persist: true, clearStored: false };
    }

    var stored = normalizeStr(storedVal);
    if (stored === '__SANDBOX__') {
      return { url: '', source: 'local_sandbox', defaultUrl: validDefault, persist: false, clearStored: false };
    }
    if (stored) {
      var storedCheck = validateGasUrl(stored);
      if (storedCheck.valid && !storedCheck.isSandbox) {
        return { url: storedCheck.normalized, source: 'local_storage', defaultUrl: validDefault, persist: false, clearStored: false };
      }
    }

    if (validDefault) {
      return { url: validDefault, source: 'global_config', defaultUrl: validDefault, persist: false, clearStored: false };
    }

    return { url: '', source: 'sandbox', defaultUrl: '', persist: false, clearStored: false };
  }

  function buildAutoConnectShareUrl(origin, pathname, gasUrl) {
    var check = validateGasUrl(gasUrl);
    if (!check.valid || check.isSandbox) return '';
    var cleanOrigin = normalizeStr(origin).replace(/\/+$/, '');
    var cleanPath = normalizeStr(pathname) || '/';
    if (cleanPath.charAt(0) !== '/') cleanPath = '/' + cleanPath;
    return cleanOrigin + cleanPath + '?gasUrl=' + encodeURIComponent(check.normalized);
  }

  function compactGasPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
    var out = {};
    var keys = Object.keys(payload);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'visibleCols' || k === 'silentRefresh' || k.charAt(0) === '_') continue;
      var v = payload[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  function getGasActionTimeoutMs(action) {
    var key = normalizeStr(action);
    if (key === 'pullReservations' || key === 'syncRentalGate' || key === 'exportReportData' || key === 'getReports') {
      return 90000;
    }
    return 35000;
  }

  function buildGasFetchOptions(action, token, payload) {
    var bodyStr = JSON.stringify({
      action: normalizeStr(action),
      token: normalizeStr(token),
      payload: compactGasPayload(payload)
    });
    var opts = {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: bodyStr
    };
    if (bodyStr.length < 60000) {
      opts.keepalive = true;
    }
    return opts;
  }

  function parseGasResponseText(rawText, httpStatus) {
    var trimmed = normalizeStr(rawText);
    if (!trimmed) {
      return {
        success: false,
        message: 'استجابة فارغة من خادم Google Apps Script (HTTP ' + (httpStatus || 0) + ').',
        data: null,
        error: 'EMPTY_RESPONSE'
      };
    }
    if (trimmed.charAt(0) === '<' || /^<!doctype/i.test(trimmed)) {
      return {
        success: false,
        message: 'أعاد الخادم صفحة HTML بدلاً من JSON. تأكد من إعداد النشر في Google Apps Script على (Execute as: Me) و(Who has access: Anyone) واستخدام رابط /exec الصحيح.',
        data: null,
        error: 'HTML_RESPONSE'
      };
    }
    try {
      var parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') {
        return {
          success: false,
          message: 'صيغة الاستجابة من الخادم غير صالحة.',
          data: null,
          error: 'INVALID_RESPONSE'
        };
      }
      return parsed;
    } catch (e) {
      return {
        success: false,
        message: 'تعذر قراءة استجابة JSON من Google Apps Script (HTTP ' + (httpStatus || 0) + ').',
        data: null,
        error: 'INVALID_JSON'
      };
    }
  }

  var API_CACHE_POLICIES = {
    getAppBootstrap: { cacheable: true, ttlMs: 30000, scope: 'dashboard' },
    getMe: { cacheable: true, ttlMs: 300000, scope: 'employees' },
    getEmployees: { cacheable: true, ttlMs: 300000, scope: 'employees' },
    getEmployeeDetails: { cacheable: true, ttlMs: 60000, scope: 'employees' },
    getDashboard: { cacheable: true, ttlMs: 60000, scope: 'dashboard' },
    getReservations: { cacheable: true, ttlMs: 60000, scope: 'reservations' },
    getReservationDetails: { cacheable: true, ttlMs: 60000, scope: 'reservations' },
    getMyFollowUps: { cacheable: true, ttlMs: 60000, scope: 'followUps' },
    getTeamFollowUps: { cacheable: true, ttlMs: 60000, scope: 'followUps' },
    getFollowUpHistory: { cacheable: true, ttlMs: 60000, scope: 'followUps' },
    getProblems: { cacheable: true, ttlMs: 60000, scope: 'problems' },
    getProblemDetails: { cacheable: true, ttlMs: 60000, scope: 'problems' },
    getNotifications: { cacheable: true, ttlMs: 30000, scope: 'notifications' },
    getActivityLogs: { cacheable: true, ttlMs: 60000, scope: 'activity' },
    getReports: { cacheable: true, ttlMs: 60000, scope: 'reports' },
    getSettings: { cacheable: true, ttlMs: 300000, scope: 'settings' },
    getSyncStatus: { cacheable: true, ttlMs: 60000, scope: 'sync' },
    getTriggerStatus: { cacheable: true, ttlMs: 60000, scope: 'sync' }
  };

  var MUTATION_INVALIDATIONS = {
    login: ['*'],
    logout: ['*'],
    claimReservation: ['reservations', 'dashboard', 'employees', 'activity', 'reports'],
    unclaimReservation: ['reservations', 'dashboard', 'employees', 'activity', 'reports'],
    quickUpdateReservationStatus: ['reservations', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    updateReservationDetails: ['reservations', 'dashboard', 'employees', 'activity', 'reports'],
    addFollowUp: ['reservations', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    updateFollowUp: ['reservations', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    assignEmployees: ['reservations', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    removeAssignment: ['reservations', 'dashboard', 'employees', 'activity', 'reports'],
    createProblem: ['reservations', 'problems', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    updateProblem: ['reservations', 'problems', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    createEmployee: ['employees', 'dashboard', 'activity', 'reports'],
    updateEmployee: ['employees', 'dashboard', 'activity', 'reports'],
    disableEmployee: ['employees', 'dashboard', 'activity', 'reports'],
    saveRolePreset: ['employees', 'activity'],
    deleteRolePreset: ['employees', 'activity'],
    resetRolePresets: ['employees', 'activity'],
    savePermissionDefinition: ['employees', 'activity'],
    deletePermissionDefinition: ['employees', 'activity'],
    markNotificationRead: ['notifications'],
    pullReservations: ['reservations', 'dashboard', 'employees', 'sync', 'activity', 'reports'],
    syncRentalGate: ['reservations', 'dashboard', 'employees', 'sync', 'activity', 'reports'],
    saveApiToken: ['settings', 'sync', 'activity'],
    updateSettings: ['settings', 'sync', 'reservations', 'activity']
  };

  function getApiCachePolicy(action) {
    var key = normalizeStr(action);
    return API_CACHE_POLICIES[key] || { cacheable: false, ttlMs: 0, scope: '' };
  }

  function stableSerializePayload(payload) {
    if (!payload || typeof payload !== 'object') return '{}';
    var ignored = { visibleCols: true, forceRefresh: true, silentRefresh: true };
    var keys = Object.keys(payload).filter(function (k) {
      return !ignored[k] && payload[k] !== undefined;
    }).sort();
    var clean = {};
    for (var i = 0; i < keys.length; i++) {
      clean[keys[i]] = payload[keys[i]];
    }
    return JSON.stringify(clean);
  }

  function buildApiCacheKey(gasUrl, token, action, payload) {
    var mode = normalizeStr(gasUrl) || 'sandbox';
    var ses = normalizeStr(token) || 'anon';
    return mode + '|' + ses + '|' + normalizeStr(action) + '|' + stableSerializePayload(payload);
  }

  function getCacheInvalidationScopes(action) {
    var key = normalizeStr(action);
    return MUTATION_INVALIDATIONS[key] || [];
  }

  function normalizeLoginUsername(raw) {
    var s = normalizeStr(raw);
    if (!s) return '';
    s = s.replace(/[٠-٩]/g, function (d) {
      return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    }).replace(/[۰-۹]/g, function (d) {
      return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    });
    return s.toLowerCase();
  }

  var RESERVATION_REPORT_COLUMNS = [
    { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 1.0, formatType: 'ltr' },
    { key: 'customerName', label: 'اسم العميل', labelEn: 'Customer Name', widthWeight: 1.45, formatType: 'text' },
    { key: 'customerPhone', label: 'الجوال', labelEn: 'Phone', widthWeight: 1.0, formatType: 'ltr' },
    { key: 'companyName', label: 'الشركة', labelEn: 'Company', widthWeight: 1.2, formatType: 'text' },
    { key: 'branchName', label: 'الفرع', labelEn: 'Branch', widthWeight: 1.25, formatType: 'text' },
    { key: 'carName', label: 'السيارة', labelEn: 'Vehicle', widthWeight: 1.25, formatType: 'text' },
    { key: 'startDate', label: 'بداية الحجز', labelEn: 'Start Date', widthWeight: 0.95, formatType: 'date' },
    { key: 'endDate', label: 'نهاية الحجز', labelEn: 'End Date', widthWeight: 0.95, formatType: 'date' },
    { key: 'originalStatusAr', label: 'حالة الحجز الأصلية', labelEn: 'Original Status', widthWeight: 1.0, formatType: 'text' },
    { key: 'internalStatus', label: 'حالة المتابعة الداخلية', labelEn: 'Internal Status', widthWeight: 1.05, formatType: 'text' },
    { key: 'assignedEmployeeNames', label: 'الموظفون المسؤولون', labelEn: 'Assigned Staff', widthWeight: 1.3, formatType: 'list' },
    { key: 'priority', label: 'الأولوية', labelEn: 'Priority', widthWeight: 0.75, formatType: 'text' },
    { key: 'totalAmount', label: 'الإجمالي', labelEn: 'Total (SAR)', widthWeight: 0.8, formatType: 'number' },
    { key: 'lastUpdateText', label: 'آخر تحديث', labelEn: 'Last Update', widthWeight: 1.65, formatType: 'text' },
    { key: 'lastUpdatedByName', label: 'آخر موظف', labelEn: 'Updated By', widthWeight: 1.05, formatType: 'text' }
  ];

  var REPORT_COLUMNS_BY_TYPE = {
    all_reservations: RESERVATION_REPORT_COLUMNS,
    by_status: RESERVATION_REPORT_COLUMNS,
    unfollowed: RESERVATION_REPORT_COLUMNS,
    priorities: RESERVATION_REPORT_COLUMNS,
    employee_performance: [
      { key: 'employeeName', label: 'اسم الموظف', labelEn: 'Employee', widthWeight: 1.4, formatType: 'text' },
      { key: 'jobTitle', label: 'المسمى الوظيفي', labelEn: 'Job Title', widthWeight: 1.3, formatType: 'text' },
      { key: 'role', label: 'الدور الوظيفي', labelEn: 'Role', widthWeight: 1.1, formatType: 'role' },
      { key: 'assignedReservations', label: 'الحجوزات المسندة', labelEn: 'Assigned Bookings', widthWeight: 0.9, formatType: 'number' },
      { key: 'followUpsCount', label: 'عدد المتابعات', labelEn: 'Follow-Ups', widthWeight: 0.85, formatType: 'number' },
      { key: 'problemsCount', label: 'عدد المشكلات', labelEn: 'Problems', widthWeight: 0.85, formatType: 'number' },
      { key: 'lastActivity', label: 'آخر نشاط', labelEn: 'Last Activity', widthWeight: 1.2, formatType: 'datetime' }
    ],
    followups_log: [
      { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'customerName', label: 'اسم العميل', labelEn: 'Customer', widthWeight: 1.3, formatType: 'text' },
      { key: 'employeeName', label: 'الموظف', labelEn: 'Employee', widthWeight: 1.15, formatType: 'text' },
      { key: 'status', label: 'الحالة', labelEn: 'Status', widthWeight: 0.95, formatType: 'text' },
      { key: 'action', label: 'الإجراء المتخذ', labelEn: 'Action', widthWeight: 1.65, formatType: 'text' },
      { key: 'notes', label: 'الملاحظات', labelEn: 'Notes', widthWeight: 1.5, formatType: 'text' },
      { key: 'followUpDate', label: 'التاريخ', labelEn: 'Date', widthWeight: 0.9, formatType: 'date' },
      { key: 'followUpTime', label: 'الوقت', labelEn: 'Time', widthWeight: 0.75, formatType: 'ltr' }
    ],
    problems: [
      { key: 'problemNumber', label: 'رقم المشكلة', labelEn: 'Ticket #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'customerName', label: 'اسم العميل', labelEn: 'Customer', widthWeight: 1.25, formatType: 'text' },
      { key: 'priority', label: 'الأولوية', labelEn: 'Priority', widthWeight: 0.75, formatType: 'text' },
      { key: 'status', label: 'الحالة', labelEn: 'Status', widthWeight: 0.95, formatType: 'text' },
      { key: 'description', label: 'وصف المشكلة', labelEn: 'Description', widthWeight: 1.85, formatType: 'text' },
      { key: 'assignedEmployeeNames', label: 'المسؤولون', labelEn: 'Assignees', widthWeight: 1.2, formatType: 'list' },
      { key: 'createdByName', label: 'أنشأها', labelEn: 'Created By', widthWeight: 1.05, formatType: 'text' },
      { key: 'updatedAt', label: 'آخر تحديث', labelEn: 'Updated At', widthWeight: 1.15, formatType: 'datetime' }
    ],
    extensions: [
      { key: 'extensionNumber', label: 'رقم التمديد', labelEn: 'Extension #', widthWeight: 1.0, formatType: 'ltr' },
      { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 1.0, formatType: 'ltr' },
      { key: 'statusAr', label: 'الحالة', labelEn: 'Status', widthWeight: 1.0, formatType: 'text' },
      { key: 'paymentStatus', label: 'حالة الدفع', labelEn: 'Payment', widthWeight: 0.95, formatType: 'text' },
      { key: 'extendDays', label: 'أيام التمديد', labelEn: 'Days', widthWeight: 0.85, formatType: 'number' },
      { key: 'startDate', label: 'بداية التمديد', labelEn: 'Start Date', widthWeight: 1.0, formatType: 'date' },
      { key: 'endDate', label: 'نهاية التمديد', labelEn: 'End Date', widthWeight: 1.0, formatType: 'date' },
      { key: 'amount', label: 'المبلغ (ر.س)', labelEn: 'Amount', widthWeight: 0.95, formatType: 'number' }
    ],
    sync_log: [
      { key: 'startedAt', label: 'وقت المزامنة', labelEn: 'Started At', widthWeight: 1.25, formatType: 'datetime' },
      { key: 'status', label: 'الحالة', labelEn: 'Status', widthWeight: 0.85, formatType: 'text' },
      { key: 'triggeredByName', label: 'المشغل', labelEn: 'Triggered By', widthWeight: 1.2, formatType: 'text' },
      { key: 'importedCount', label: 'جديد', labelEn: 'Imported', widthWeight: 0.75, formatType: 'number' },
      { key: 'updatedCount', label: 'محدث', labelEn: 'Updated', widthWeight: 0.75, formatType: 'number' },
      { key: 'extensionsCount', label: 'التمديدات', labelEn: 'Extensions', widthWeight: 0.8, formatType: 'number' },
      { key: 'durationMs', label: 'المدة (م.ث)', labelEn: 'Duration ms', widthWeight: 0.85, formatType: 'number' },
      { key: 'errorMessage', label: 'ملاحظات الخطأ', labelEn: 'Error', widthWeight: 1.5, formatType: 'text' }
    ],
    activity_log: [
      { key: 'userName', label: 'المستخدم', labelEn: 'User', widthWeight: 1.15, formatType: 'text' },
      { key: 'actionType', label: 'العملية', labelEn: 'Action', widthWeight: 1.1, formatType: 'text' },
      { key: 'entityType', label: 'العنصر', labelEn: 'Entity', widthWeight: 0.9, formatType: 'ltr' },
      { key: 'entityId', label: 'المرجع', labelEn: 'Ref', widthWeight: 1.0, formatType: 'ltr' },
      { key: 'details', label: 'التفاصيل', labelEn: 'Details', widthWeight: 1.8, formatType: 'text' },
      { key: 'logDate', label: 'التاريخ', labelEn: 'Date', widthWeight: 0.95, formatType: 'date' },
      { key: 'logTime', label: 'الوقت', labelEn: 'Time', widthWeight: 0.8, formatType: 'ltr' }
    ]
  };

  function getReportColumns(reportType, sampleRows) {
    var preset = REPORT_COLUMNS_BY_TYPE[normalizeStr(reportType)];
    if (preset && preset.length) {
      return preset.map(function (c) { return Object.assign({}, c); });
    }
    var first = Array.isArray(sampleRows) && sampleRows.length ? sampleRows[0] : null;
    if (!first) return RESERVATION_REPORT_COLUMNS.slice();
    var hidden = { rawJson: true, id: true, reservationId: true, employeeId: true, createdById: true, lastUpdatedById: true, assignedEmployeeIds: true };
    return Object.keys(first).filter(function (k) { return !hidden[k]; }).map(function (k) {
      return { key: k, label: k, labelEn: k, widthWeight: 1.0, formatType: 'text' };
    });
  }

  function formatReportCellValue(col, row, lang, options) {
    var opts = options || {};
    var fallback = opts.emptyFallback !== undefined ? opts.emptyFallback : '-';
    if (!row || !col) return fallback;
    var val = typeof col.value === 'function' ? col.value(row) : row[col.key];
    if (Array.isArray(val)) {
      var joined = val.map(normalizeStr).filter(Boolean).join('، ');
      return joined || fallback;
    }
    if (val === undefined || val === null || val === '') return fallback;

    var ft = col.formatType || 'text';
    if (ft === 'date') {
      return formatDisplayDate(val) || String(val);
    }
    if (ft === 'datetime') {
      return formatDisplayDateTime(val) || String(val);
    }
    if (ft === 'role') {
      var dict = ROLE_LABELS[lang === 'en' ? 'en' : 'ar'] || ROLE_LABELS.ar;
      return dict[val] || String(val);
    }
    if (ft === 'number') {
      var num = Number(val);
      if (!isNaN(num)) {
        return opts.keepNumber ? num : String(Math.round(num * 100) / 100);
      }
    }
    if (typeof val === 'boolean') {
      return val ? (lang === 'en' ? 'Yes' : 'نعم') : (lang === 'en' ? 'No' : 'لا');
    }
    return String(val).replace(/\s+/g, ' ').trim() || fallback;
  }

  function computePdfColumnWidths(columns, totalWidth) {
    var cols = Array.isArray(columns) ? columns : [];
    var totalW = Number(totalWidth || 0);
    if (!cols.length || totalW <= 0) return [];
    var weights = cols.map(function (c) {
      var w = Number(c && c.widthWeight);
      return w > 0 ? w : 1;
    });
    var sum = weights.reduce(function (acc, w) { return acc + w; }, 0) || cols.length;
    var minW = Math.min(totalW / (cols.length * 1.6), totalW * 0.065);
    var rawWidths = weights.map(function (w) {
      return Math.max(minW, (w / sum) * totalW);
    });
    var rawSum = rawWidths.reduce(function (acc, w) { return acc + w; }, 0) || totalW;
    return rawWidths.map(function (w) {
      return (w / rawSum) * totalW;
    });
  }

  function isPureLtrText(text) {
    var s = normalizeStr(text);
    if (!s) return false;
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s)) {
      return false;
    }
    return /[A-Za-z0-9]/.test(s);
  }

  function formatBidiPdfText(text) {
    var s = text === null || text === undefined ? '' : String(text);
    if (!s) return '';
    if (!/[\u0600-\u06FF]/.test(s)) return s;
    // Isolate multi-word LTR runs (codes, English brand/model names, ISO dates+times, phones) so RTL canvas won't invert word order or punctuation
    return s.replace(/([A-Za-z0-9]+(?:[-_./:+][A-Za-z0-9]+)*(?:[ \t]+[A-Za-z0-9]+(?:[-_./:+][A-Za-z0-9]+)*)*)/g, function (match) {
      return '\u2066' + match + '\u2069';
    });
  }

  function buildCompressedExcelSheets(sheetsConfig, options) {
    var list = Array.isArray(sheetsConfig) ? sheetsConfig : [];
    var opts = options || {};
    var sanitizeSheetName = function (name, idx) {
      var clean = String(name || ('Sheet_' + (idx + 1)))
        .replace(/[\\/?*\[\]:]/g, '-')
        .trim();
      return (clean || ('Sheet_' + (idx + 1))).substring(0, 31);
    };

    if (!opts.compressEnabled) {
      return list.map(function (cfg, idx) {
        return {
          name: sanitizeSheetName(cfg && cfg.name, idx),
          headers: Array.isArray(cfg && cfg.headers) ? cfg.headers : [],
          rows: Array.isArray(cfg && cfg.rows) ? cfg.rows : [],
          preformattedAoa: null
        };
      });
    }

    var rawTarget = parseInt(opts.targetSheets, 10);
    var maxSheets = Math.min(10, Math.max(1, isNaN(rawTarget) ? 1 : rawTarget));
    if (list.length === 0) return [];

    function extractCompactAoa(cfg) {
      var headers = Array.isArray(cfg.headers) ? cfg.headers : [];
      var rows = Array.isArray(cfg.rows) ? cfg.rows : [];
      var aoa = [headers.map(function (h) { return h.label || h.key || ''; })];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        aoa.push(headers.map(function (h) {
          var v = typeof h.value === 'function' ? h.value(r) : r[h.key];
          if (Array.isArray(v)) v = v.map(normalizeStr).filter(Boolean).join('، ');
          if (v === undefined || v === null) return '';
          if (typeof v === 'number') return v;
          if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
          return String(v).replace(/\s+/g, ' ').trim();
        }));
      }
      return aoa;
    }

    // Case 1: Single dataset, user requested splitting/packing into up to maxSheets (1..10) sheets
    if (list.length === 1) {
      var single = list[0];
      var sHeaders = Array.isArray(single.headers) ? single.headers : [];
      var sRows = Array.isArray(single.rows) ? single.rows : [];
      var bucketCount = sRows.length > 0 ? Math.min(maxSheets, sRows.length) : 1;
      if (bucketCount === 1) {
        return [{
          name: sanitizeSheetName(single.name || 'Compressed_1', 0),
          headers: sHeaders,
          rows: sRows,
          preformattedAoa: extractCompactAoa(single)
        }];
      }
      var totalRows = sRows.length;
      var baseSize = Math.floor(totalRows / bucketCount);
      var remainder = totalRows % bucketCount;
      var cursor = 0;
      var out = [];
      for (var b = 0; b < bucketCount; b++) {
        var take = baseSize + (b < remainder ? 1 : 0);
        if (take <= 0) continue;
        var sliceRows = sRows.slice(cursor, cursor + take);
        cursor += take;
        var partCfg = { name: 'ورقة_' + (out.length + 1), headers: sHeaders, rows: sliceRows };
        out.push({
          name: sanitizeSheetName(partCfg.name, out.length),
          headers: sHeaders,
          rows: sliceRows,
          preformattedAoa: extractCompactAoa(partCfg)
        });
      }
      return out;
    }

    // Case 2: Multiple datasets -> pack into at most maxSheets (1..10) sheets
    if (list.length <= maxSheets) {
      return list.map(function (cfg, idx) {
        return {
          name: sanitizeSheetName(cfg.name, idx),
          headers: Array.isArray(cfg.headers) ? cfg.headers : [],
          rows: Array.isArray(cfg.rows) ? cfg.rows : [],
          preformattedAoa: extractCompactAoa(cfg)
        };
      });
    }

    var packed = [];
    for (var k = 0; k < maxSheets - 1; k++) {
      packed.push({
        name: sanitizeSheetName(list[k].name, k),
        headers: Array.isArray(list[k].headers) ? list[k].headers : [],
        rows: Array.isArray(list[k].rows) ? list[k].rows : [],
        preformattedAoa: extractCompactAoa(list[k])
      });
    }

    var mergedAoa = [];
    var mergedHeaders = [];
    var mergedRows = [];
    for (var m = maxSheets - 1; m < list.length; m++) {
      var section = list[m];
      var sectionAoa = extractCompactAoa(section);
      if (mergedAoa.length > 0) mergedAoa.push([]);
      mergedAoa.push(['--- ' + (section.name || ('القسم ' + (m + 1))) + ' ---']);
      for (var rowIdx = 0; rowIdx < sectionAoa.length; rowIdx++) {
        mergedAoa.push(sectionAoa[rowIdx]);
      }
      if (!mergedHeaders.length && Array.isArray(section.headers)) mergedHeaders = section.headers;
      if (Array.isArray(section.rows)) mergedRows = mergedRows.concat(section.rows);
    }

    packed.push({
      name: sanitizeSheetName(maxSheets === 1 ? 'بيانات_مضغوطة' : ('مضغوط_' + maxSheets), maxSheets - 1),
      headers: mergedHeaders,
      rows: mergedRows,
      preformattedAoa: mergedAoa
    });

    return packed;
  }

  function buildMutationLockKey(action, payload) {
    var act = normalizeStr(action);
    var p = (payload && typeof payload === 'object') ? payload : {};
    switch (act) {
      case 'claimReservation':
      case 'unclaimReservation':
      case 'quickUpdateReservationStatus':
      case 'updateReservationDetails':
      case 'assignEmployees':
      case 'addFollowUp':
      case 'createProblem':
        return act + ':' + normalizeStr(p.reservationId || p.reservationNumber);
      case 'removeAssignment':
        return act + ':' + normalizeStr(p.reservationId) + ':' + normalizeStr(p.employeeId);
      case 'updateFollowUp':
        return act + ':' + normalizeStr(p.followUpId);
      case 'updateProblem':
        return act + ':' + normalizeStr(p.problemId);
      case 'markNotificationRead':
        return act + ':' + (p.markAll ? 'ALL' : normalizeStr(p.notificationId));
      case 'createEmployee':
        return act + ':' + normalizeLoginUsername(p.username || p.name);
      case 'updateEmployee':
      case 'disableEmployee':
        return act + ':' + normalizeStr(p.employeeId);
      case 'saveRolePreset':
      case 'deleteRolePreset':
        return act + ':' + normalizeStr(p.id || p.presetId || p.label);
      case 'savePermissionDefinition':
      case 'deletePermissionDefinition':
        return act + ':' + normalizeStr(p.key || p.label);
      case 'login':
        return act + ':' + normalizeLoginUsername(p.username);
      default:
        return act;
    }
  }

  function isProblemClosedStatus(status) {
    var s = normalizeStr(status);
    return s === 'مغلقة' || s === 'تم الحل';
  }

  function resolveNotificationTarget(notification) {
    var n = (notification && typeof notification === 'object') ? notification : {};
    var entityType = normalizeStr(n.entityType);
    var entityId = normalizeStr(n.entityId);
    var type = normalizeStr(n.type);
    if (!entityId) {
      return { kind: 'none', entityId: '', route: '' };
    }
    if (entityType === 'Problem' || type === 'new_problem' || type === 'high_priority_problem') {
      return { kind: 'problem', entityId: entityId, route: 'problems' };
    }
    if (entityType === 'Reservation' || type === 'new_assignment' || type === 'reassignment' || type === 'status_change' || type === 'reservation_update') {
      return { kind: 'reservation', entityId: entityId, route: 'reservations' };
    }
    return { kind: 'none', entityId: entityId, route: '' };
  }

  function applyOptimisticProblemPatch(problem, patch, actor, allEmployees) {
    if (!problem || typeof problem !== 'object') return problem;
    var p = (patch && typeof patch === 'object') ? patch : {};
    var nowStr = new Date().toISOString();
    var nextStatus = normalizeStr(p.status) || problem.status || 'جديدة';
    var nextPrio = normalizeStr(p.priority) || problem.priority || 'متوسط';
    var nextDesc = (p.description !== undefined && normalizeStr(p.description)) ? normalizeStr(p.description) : problem.description;
    var nextCust = (p.customerName !== undefined && normalizeStr(p.customerName)) ? normalizeStr(p.customerName) : problem.customerName;

    var nextEmpIds = Array.isArray(p.assignedEmployeeIds)
      ? p.assignedEmployeeIds.slice()
      : (Array.isArray(problem.assignedEmployeeIds) ? problem.assignedEmployeeIds.slice() : []);
    var nextEmpNames = Array.isArray(problem.assignedEmployeeNames) ? problem.assignedEmployeeNames.slice() : [];
    if (Array.isArray(p.assignedEmployeeIds) && Array.isArray(allEmployees)) {
      nextEmpNames = nextEmpIds.map(function (eid) {
        var found = allEmployees.find(function (e) { return e.id === eid; });
        return found ? found.name : '';
      }).filter(Boolean);
    }

    var defaultNote = nextStatus === 'مغلقة'
      ? 'تم إغلاق المشكلة'
      : (nextDesc !== problem.description ? 'تعديل بيانات التذكرة' : ('تحديث الحالة إلى ' + nextStatus));
    var newUpdate = {
      id: 'PRBU_OPT_' + Date.now(),
      problemId: problem.id,
      reservationNumber: problem.reservationNumber,
      employeeId: (actor && actor.id) || '',
      employeeName: (actor && actor.name) || 'النظام',
      previousStatus: problem.status || '',
      newStatus: nextStatus,
      previousPriority: problem.priority || '',
      newPriority: nextPrio,
      note: normalizeStr(p.note) || defaultNote,
      createdAt: nowStr
    };

    var existingUpdates = Array.isArray(problem.updates) ? problem.updates.slice() : [];
    return Object.assign({}, problem, {
      status: nextStatus,
      priority: nextPrio,
      description: nextDesc,
      customerName: nextCust,
      assignedEmployeeIds: nextEmpIds,
      assignedEmployeeNames: nextEmpNames,
      updatedAt: nowStr,
      updates: [newUpdate].concat(existingUpdates)
    });
  }

  function hashFnvStep(str, seed) {
    var h = seed === undefined ? 2166136261 : seed;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
  }

  function feedFingerprintHash(val, h, depth) {
    if (depth > 8) return hashFnvStep('D', h);
    if (val === null || val === undefined) return hashFnvStep('N', h);
    var t = typeof val;
    if (t === 'string') return hashFnvStep('S:' + val, h);
    if (t === 'number' || t === 'boolean') return hashFnvStep(t.charAt(0) + ':' + String(val), h);
    if (Array.isArray(val)) {
      h = hashFnvStep('A[' + val.length + ']', h);
      for (var i = 0; i < val.length; i++) {
        h = feedFingerprintHash(val[i], h, depth + 1);
      }
      return h;
    }
    if (t === 'object') {
      var keys = Object.keys(val).sort();
      h = hashFnvStep('O{' + keys.length + '}', h);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        if (val[k] === undefined) continue;
        h = hashFnvStep('K:' + k, h);
        h = feedFingerprintHash(val[k], h, depth + 1);
      }
      return h;
    }
    return h;
  }

  function computeDataFingerprint(data) {
    if (data === undefined || data === null) return '0';
    var h = feedFingerprintHash(data, 2166136261, 0);
    return (h >>> 0).toString(16);
  }

  function shouldAutoRefreshNow(flags) {
    var f = flags || {};
    return !f.isModalOpen && !f.isInputFocused && !f.isOffline && !f.isHidden && !f.hasActiveLocks;
  }

  return {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    ROLE_PERMISSION_MATRIX: ROLE_PERMISSION_MATRIX,
    PERMISSIONS_CATALOG: PERMISSIONS_CATALOG,
    JOB_ROLE_PRESETS: JOB_ROLE_PRESETS,
    FOLLOWUP_STATUSES: FOLLOWUP_STATUSES,
    WORKFLOW_STATUS_OPTIONS: WORKFLOW_STATUS_OPTIONS,
    PULL_DURATION_PRESETS: PULL_DURATION_PRESETS,
    PROBLEM_PRIORITIES: PROBLEM_PRIORITIES,
    PROBLEM_STATUSES: PROBLEM_STATUSES,
    REPORT_COLUMNS_BY_TYPE: REPORT_COLUMNS_BY_TYPE,
    translateOriginalStatus: translateOriginalStatus,
    resolveSourceWorkflowStatus: resolveSourceWorkflowStatus,
    isValidWorkflowStatus: isValidWorkflowStatus,
    getWorkflowStatusOptions: getWorkflowStatusOptions,
    normalizeStatusHistory: normalizeStatusHistory,
    appendStatusStageEntry: appendStatusStageEntry,
    formatStatusStageSourceLabel: formatStatusStageSourceLabel,
    resolvePullDateRange: resolvePullDateRange,
    filterSourceReservationsByPullRange: filterSourceReservationsByPullRange,
    buildCustomersIndexFromReservations: buildCustomersIndexFromReservations,
    mergeReservationBatch: mergeReservationBatch,
    translateDeliveryType: translateDeliveryType,
    isExtensionAcceptedAndPaid: isExtensionAcceptedAndPaid,
    computeTotalAmount: computeTotalAmount,
    mergeSyncedReservation: mergeSyncedReservation,
    resolveEffectivePermissions: resolveEffectivePermissions,
    canAccessApi: canAccessApi,
    canUserPerform: canUserPerform,
    mergePermissionsCatalog: mergePermissionsCatalog,
    normalizeRolePresets: normalizeRolePresets,
    upsertRolePreset: upsertRolePreset,
    removeRolePreset: removeRolePreset,
    upsertPermissionDefinition: upsertPermissionDefinition,
    removePermissionDefinition: removePermissionDefinition,
    claimReservationRecord: claimReservationRecord,
    unclaimReservationRecord: unclaimReservationRecord,
    filterReservations: filterReservations,
    computeDashboardMetrics: computeDashboardMetrics,
    resolveAssetUrl: resolveAssetUrl,
    resolveRouteFromLocation: resolveRouteFromLocation,
    dedupeReservationsByNumber: dedupeReservationsByNumber,
    dedupeExtensionsByNumber: dedupeExtensionsByNumber,
    validateGasUrl: validateGasUrl,
    extractGasUrlFromSearch: extractGasUrlFromSearch,
    resolveGasConnection: resolveGasConnection,
    buildAutoConnectShareUrl: buildAutoConnectShareUrl,
    compactGasPayload: compactGasPayload,
    getGasActionTimeoutMs: getGasActionTimeoutMs,
    buildGasFetchOptions: buildGasFetchOptions,
    parseGasResponseText: parseGasResponseText,
    getApiCachePolicy: getApiCachePolicy,
    buildApiCacheKey: buildApiCacheKey,
    getCacheInvalidationScopes: getCacheInvalidationScopes,
    formatDisplayDate: formatDisplayDate,
    formatDisplayDateTime: formatDisplayDateTime,
    normalizeLoginUsername: normalizeLoginUsername,
    getReportColumns: getReportColumns,
    formatReportCellValue: formatReportCellValue,
    computePdfColumnWidths: computePdfColumnWidths,
    isPureLtrText: isPureLtrText,
    formatBidiPdfText: formatBidiPdfText,
    buildCompressedExcelSheets: buildCompressedExcelSheets,
    buildMutationLockKey: buildMutationLockKey,
    isProblemClosedStatus: isProblemClosedStatus,
    resolveNotificationTarget: resolveNotificationTarget,
    applyOptimisticProblemPatch: applyOptimisticProblemPatch,
    computeDataFingerprint: computeDataFingerprint,
    shouldAutoRefreshNow: shouldAutoRefreshNow
  };
}));
