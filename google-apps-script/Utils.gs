/**
 * RENTAL GATE CRM — Utilities & Domain Constants
 * Google Apps Script Backend
 */

var RG_SHEETS = {
  USERS: 'Users',
  EMPLOYEES: 'Employees',
  CUSTOMERS: 'Customers',
  RESERVATIONS: 'Reservations',
  EXTENSIONS: 'Extensions',
  ASSIGNMENTS: 'Assignments',
  FOLLOWUPS: 'FollowUps',
  FOLLOWUP_HISTORY: 'FollowUpHistory',
  ISSUES: 'Issues',
  PROBLEMS: 'Problems',
  PROBLEM_UPDATES: 'ProblemUpdates',
  ACTIVITY_LOG: 'ActivityLog',
  NOTIFICATIONS: 'Notifications',
  SETTINGS: 'Settings',
  ROLES: 'Roles',
  PERMISSIONS: 'Permissions',
  SESSIONS: 'Sessions',
  SYNC_LOG: 'SyncLog'
};

var RG_ROLES = {
  GENERAL_MANAGER: 'general_manager',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent'
};

var RG_FOLLOWUP_STATUSES = [
  'تم الحجز',
  'تم التسليم',
  'تم الاستلام',
  'تم الإنشاء',
  'تم الإلغاء',
  'تم التمديد',
  'لم يتم الحجز'
];

var RG_PROBLEM_PRIORITIES = ['عادي', 'متوسط', 'مرتفع'];

var RG_PROBLEM_STATUSES = [
  'جديدة',
  'قيد المعالجة',
  'بانتظار العميل',
  'بانتظار الشركة',
  'تم الحل',
  'مغلقة'
];

var RG_STATUS_MAP = {
  pending: 'قيد الانتظار',
  new: 'جديد',
  created: 'تم الإنشاء',
  confirmed: 'مؤكد',
  booked: 'تم الحجز',
  reserved: 'تم الحجز',
  active: 'ناشط',
  started: 'بدأ التنفيذ',
  in_progress: 'قيد التنفيذ',
  on_the_way: 'في الطريق',
  ready: 'جاهز للاستلام',
  ready_for_pickup: 'جاهز للاستلام',
  hold: 'معلق',
  delivered: 'تم التسليم',
  picked_up: 'ناشط',
  received: 'ناشط',
  on_rent: 'ناشط',
  rented: 'ناشط',
  car_received: 'ناشط',
  ongoing: 'ناشط',
  returned: 'تم الإرجاع',
  extended: 'تم التمديد',
  automatically_extended: 'تم التمديد تلقائيًا',
  completed: 'مكتمل',
  finished: 'مكتمل',
  closed: 'منتهي',
  ended: 'منتهي',
  finished_by_driver: 'مكتمل عبر السائق',
  cancelled: 'ملغي',
  canceled: 'ملغي',
  declined: 'مرفوض',
  rejected: 'مرفوض',
  expired: 'منتهي',
  no_show: 'لم يحضر',
  draft: 'مسودة',
  unpaid: 'غير مدفوع',
  waiting_payment: 'بانتظار الدفع',
  awaiting_payment: 'بانتظار الدفع',
  paid: 'مدفوع',
  wallet_paid: 'مدفوع بالمحفظة',
  paid_by_wallet: 'مدفوع بالمحفظة',
  paid_wallet: 'مدفوع بالمحفظة',
  admin_approved: 'معتمد إداريًا',
  location_changed: 'تم تغيير الموقع',
  accepted: 'مقبول',
  approved: 'مقبول'
};

var RG_DELIVERY_MAP = {
  branch: 'استلام من الفرع',
  office: 'استلام من المكتب',
  pickup: 'استلام من الفرع',
  delivery: 'توصيل للموقع',
  home: 'توصيل للمنزل',
  airport: 'توصيل للمطار',
  train_station: 'محطة القطار',
  my_location: 'توصيل لموقع العميل',
  custom: 'موقع خاص',
  custom_location: 'موقع خاص',
  location: 'موقع خاص',
  private_location: 'موقع خاص',
  'private': 'موقع خاص',
  hotel: 'توصيل للفندق',
  return_branch: 'تسليم في الفرع',
  return_delivery: 'استلام من موقع العميل'
};

var RG_EXTENSION_TYPE_MAP = {
  client: 'تمديد بواسطة العميل',
  customer: 'تمديد بواسطة العميل',
  user: 'تمديد بواسطة العميل',
  automatic: 'تمديد تلقائي',
  auto: 'تمديد تلقائي',
  system: 'تمديد تلقائي',
  admin: 'تمديد إداري',
  manual: 'تمديد إداري'
};

function generateId(prefix) {
  var uuid = Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
  return (prefix ? prefix + '_' : '') + uuid;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateOnly(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    var s = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Rental Gate API sends local wall-clock strings without Z (e.g. 2026-11-17T15:24:00)
    var wallMatch = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/);
    if (wallMatch) return wallMatch[1];
  }
  var d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput).substring(0, 10);
  var tz = 'Asia/Riyadh';
  try {
    tz = (typeof getSpreadsheetTz_ === 'function' ? getSpreadsheetTz_() : Session.getScriptTimeZone()) || 'Asia/Riyadh';
  } catch (e) {}
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function formatTimeOnly(dateInput) {
  var d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (isNaN(d.getTime())) return '';
  var tz = 'Asia/Riyadh';
  try {
    tz = Session.getScriptTimeZone() || 'Asia/Riyadh';
  } catch (e) {}
  return Utilities.formatDate(d, tz, 'HH:mm:ss');
}

function extractTimeHM_(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    var s = dateInput.trim();
    if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var hm = s.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
    if (hm) return hm[1];
    var wall = s.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
    if (wall && s.indexOf('Z') === -1 && !/[+-]\d{2}:?\d{2}$/.test(s)) {
      return wall[1];
    }
  }
  var d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  var tz = 'Asia/Riyadh';
  try {
    tz = (typeof getSpreadsheetTz_ === 'function' ? getSpreadsheetTz_() : Session.getScriptTimeZone()) || 'Asia/Riyadh';
  } catch (e) {}
  return Utilities.formatDate(d, tz, 'HH:mm');
}

function formatDateTimeDisplay_(dateInput) {
  if (!dateInput) return '';
  var dPart = formatDateOnly(dateInput);
  var tPart = extractTimeHM_(dateInput);
  return tPart ? (dPart + ' ' + tPart) : dPart;
}

function safeJsonParse(str, fallback) {
  if (str === null || str === undefined || str === '') return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function normalizeStr(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normalizeLoginUsername_(val) {
  var s = normalizeStr(val);
  if (!s) return '';
  s = s.replace(/[\u0660-\u0669]/g, function (d) {
    return String(d.charCodeAt(0) - 0x0660);
  }).replace(/[\u06F0-\u06F9]/g, function (d) {
    return String(d.charCodeAt(0) - 0x06F0);
  });
  return s.toLowerCase();
}

function toNumber(val, fallback) {
  var n = Number(val);
  return isNaN(n) ? (fallback || 0) : n;
}

function toBool(val) {
  if (typeof val === 'boolean') return val;
  var s = String(val).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

function translateOriginalStatus(code) {
  var key = normalizeStr(code).toLowerCase().replace(/\s+/g, '_');
  return RG_STATUS_MAP[key] || normalizeStr(code) || 'غير محدد';
}

var RG_WORKFLOW_STATUS_OPTIONS = (function () {
  var seen = {};
  var out = [];
  function pushStatus(st) {
    var clean = normalizeStr(st);
    if (!clean || clean === 'غير محدد' || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  }
  for (var i = 0; i < RG_FOLLOWUP_STATUSES.length; i++) {
    pushStatus(RG_FOLLOWUP_STATUSES[i]);
  }
  var keys = Object.keys(RG_STATUS_MAP);
  for (var j = 0; j < keys.length; j++) {
    pushStatus(RG_STATUS_MAP[keys[j]]);
  }
  return out;
}());

function isValidWorkflowStatus_(status) {
  var clean = normalizeStr(status);
  return Boolean(clean && RG_WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1);
}

function resolveSourceWorkflowStatus_(apiItem) {
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

function normalizeStatusHistory_(raw) {
  var arr = [];
  if (Array.isArray(raw)) {
    arr = raw.slice();
  } else if (typeof raw === 'string' && raw.trim()) {
    var parsed = safeJsonParse(raw, []);
    if (Array.isArray(parsed)) arr = parsed;
  }
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var entry = arr[i];
    if (!entry || typeof entry !== 'object') continue;
    var ns = normalizeStr(entry.newStatus || entry.status);
    if (!ns) continue;
    out.push({
      stageNumber: toNumber(entry.stageNumber, out.length + 1) || (out.length + 1),
      source: normalizeStr(entry.source) || 'system',
      previousStatus: normalizeStr(entry.previousStatus),
      newStatus: ns,
      sourceStatusCode: normalizeStr(entry.sourceStatusCode),
      changedAt: normalizeStr(entry.changedAt || entry.createdAt),
      changedById: normalizeStr(entry.changedById || entry.employeeId) || 'system',
      changedByName: normalizeStr(entry.changedByName || entry.employeeName) || 'النظام',
      note: normalizeStr(entry.note)
    });
  }
  return out;
}

function appendStatusStageEntry_(existingHistory, entry) {
  var list = normalizeStatusHistory_(existingHistory);
  var e = (entry && typeof entry === 'object') ? entry : {};
  var nextStatus = normalizeStr(e.newStatus || e.status);
  if (!nextStatus) return list;

  var source = normalizeStr(e.source) || 'system';
  var last = list.length ? list[list.length - 1] : null;
  if (last && last.newStatus === nextStatus && source === 'api_pull' && normalizeStr(e.sourceStatusCode) === last.sourceStatusCode) {
    return list;
  }

  list.push({
    stageNumber: list.length + 1,
    source: source,
    previousStatus: normalizeStr(e.previousStatus !== undefined ? e.previousStatus : (last ? last.newStatus : '')),
    newStatus: nextStatus,
    sourceStatusCode: normalizeStr(e.sourceStatusCode),
    changedAt: normalizeStr(e.changedAt) || nowIso(),
    changedById: normalizeStr(e.changedById) || 'system',
    changedByName: normalizeStr(e.changedByName) || 'النظام',
    note: normalizeStr(e.note)
  });
  return list;
}

function shiftIsoDateDays_(isoDate, deltaDays) {
  var m = normalizeStr(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(deltaDays || 0)));
  return d.toISOString().substring(0, 10);
}

function resolvePullDateRange_(options) {
  var opts = (options && typeof options === 'object') ? options : {};
  var today = formatDateOnly(new Date());
  var preset = normalizeStr(opts.preset).toLowerCase() || 'all';
  var rawFrom = /^\d{4}-\d{2}-\d{2}$/.test(normalizeStr(opts.dateFrom)) ? normalizeStr(opts.dateFrom) : '';
  var rawTo = /^\d{4}-\d{2}-\d{2}$/.test(normalizeStr(opts.dateTo)) ? normalizeStr(opts.dateTo) : '';
  var dateFrom = rawFrom;
  var dateTo = rawTo;

  if (preset === 'today') {
    dateFrom = today;
    dateTo = today;
  } else if (preset === '3d') {
    dateFrom = shiftIsoDateDays_(today, -2);
    dateTo = today;
  } else if (preset === '7d') {
    dateFrom = shiftIsoDateDays_(today, -6);
    dateTo = today;
  } else if (preset === '30d') {
    dateFrom = shiftIsoDateDays_(today, -29);
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

function filterSourceReservationsByPullRange_(items, range) {
  var list = Array.isArray(items) ? items : [];
  var r = (range && typeof range === 'object') ? range : {};
  var dFrom = normalizeStr(r.dateFrom);
  var dTo = normalizeStr(r.dateTo);
  if (!dFrom && !dTo) return list.slice();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || typeof item !== 'object') continue;
    var candidateDate = formatDateOnly(
      item.reservationDate || item.createdAt || item.startDate || item.start_date || item.pickup_date
    );
    if (!candidateDate) continue;
    if (dFrom && candidateDate < dFrom) continue;
    if (dTo && candidateDate > dTo) continue;
    out.push(item);
  }
  return out;
}

function translateDeliveryType(type) {
  var key = normalizeStr(type).toLowerCase().replace(/\s+/g, '_');
  return RG_DELIVERY_MAP[key] || normalizeStr(type) || 'استلام من الفرع';
}

function translateExtensionType_(type) {
  var key = normalizeStr(type).toLowerCase().replace(/\s+/g, '_');
  return RG_EXTENSION_TYPE_MAP[key] || normalizeStr(type) || 'تمديد';
}

function computeDateDiffDays_(startIso, endIso) {
  var d1 = formatDateOnly(startIso);
  var d2 = formatDateOnly(endIso);
  if (!d1 || !d2) return 0;
  var t1 = Date.parse(d1 + 'T00:00:00Z');
  var t2 = Date.parse(d2 + 'T00:00:00Z');
  if (isNaN(t1) || isNaN(t2) || t2 <= t1) return 0;
  return Math.round((t2 - t1) / 86400000);
}

function isExtensionAcceptedAndPaid(ext) {
  if (!ext || typeof ext !== 'object') return false;
  if (ext.rejectedByUserId || normalizeStr(ext.rejectionReason)) return false;

  var st = normalizeStr(ext.reservationStatus || ext.status || ext.status_code || ext.state).toLowerCase().replace(/\s+/g, '_');
  if (st === 'cancelled' || st === 'canceled' || st === 'declined' || st === 'rejected' || st === 'hold' || st === 'created' || st === 'draft' || st === 'unpaid' || st === 'waiting_payment' || st === 'awaiting_payment' || st === 'expired' || st === 'pending') {
    return false;
  }

  var explicitPay = normalizeStr(ext.payment_status || ext.paymentStatus || ext.is_paid).toLowerCase();
  var accepted = (
    st === 'accepted' || st === 'approved' || st === 'confirmed' || st === 'active' ||
    st === 'completed' || st === 'paid' || st === 'wallet_paid' || st === 'paid_by_wallet' || st === 'paid_wallet' ||
    st === 'admin_approved' || st === 'extended' || st === 'automatically_extended' || st === 'started' ||
    st === 'in_progress' || st === 'finished' || st === 'closed' || st === 'ended' || st === 'finished_by_driver' || st === 'مقبول'
  );
  if (!accepted) return false;

  if (explicitPay || ext.paid !== undefined) {
    return explicitPay === 'paid' || explicitPay === 'completed' || explicitPay === 'wallet_paid' || explicitPay === 'paid_by_wallet' || explicitPay === 'paid_wallet' || explicitPay === 'true' || explicitPay === '1' || explicitPay === 'مدفوع' || ext.paid === true;
  }

  // Real Rental Gate ReservationExtendFilterResponseDTO uses reservationStatus + paymentDate/paymentResult
  var payResult = normalizeStr(ext.paymentResult).toLowerCase();
  if (payResult && (payResult.indexOf('fail') !== -1 || payResult.indexOf('reject') !== -1 || payResult.indexOf('declin') !== -1 || payResult === 'unpaid')) {
    return false;
  }
  return Boolean(
    ext.paymentDate ||
    st === 'paid' ||
    st === 'wallet_paid' ||
    st === 'paid_by_wallet' ||
    st === 'paid_wallet' ||
    st === 'admin_approved' ||
    st === 'extended' ||
    st === 'automatically_extended' ||
    st === 'finished' ||
    st === 'finished_by_driver' ||
    payResult === 'paid' ||
    payResult === 'captured' ||
    payResult === 'success' ||
    payResult === 'approved' ||
    payResult === 'completed'
  );
}

function summarizeReservationExtensions_(extensions, apiItem, fallbackEndDate, fallbackEndTime) {
  var list = Array.isArray(extensions) ? extensions : [];
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var sorted = list.slice().sort(function (a, b) {
    var ka = (a.startDate || a.endDate || '') + ' ' + (a.startTime || '');
    var kb = (b.startDate || b.endDate || '') + ' ' + (b.startTime || '');
    if (ka === kb) return String(a.extensionNumber || '').localeCompare(String(b.extensionNumber || ''));
    return ka < kb ? -1 : 1;
  });

  var amountSum = 0;
  var daysSum = 0;
  var lastExt = null;
  for (var i = 0; i < sorted.length; i++) {
    sorted[i].sequenceNumber = i + 1;
    amountSum += toNumber(sorted[i].amount, 0);
    daysSum += toNumber(sorted[i].extendDays, 0);
    if (sorted[i].endDate && (!lastExt || sorted[i].endDate >= lastExt.endDate)) {
      lastExt = sorted[i];
    }
  }

  if (sorted.length === 0 && (toBool(item.extended) || toNumber(item.extensionsTotal, 0) > 0 || toNumber(item.extensionsCount, 0) > 0)) {
    amountSum = toNumber(item.extensionsTotal, 0);
    daysSum = toNumber(item.extendedDays || item.extensionsDays, 0);
  }

  var count = sorted.length > 0
    ? sorted.length
    : (toBool(item.extended) ? Math.max(1, toNumber(item.extensionsCount, 1)) : 0);

  var apiActualEndRaw = item.actualEndDate || item.extendedUntilDate || '';
  var apiActualEndDate = formatDateOnly(apiActualEndRaw);
  var apiActualEndTime = extractTimeHM_(apiActualEndRaw);

  var extendedUntilDate = '';
  var extendedUntilTime = '';
  if (lastExt && lastExt.endDate) {
    extendedUntilDate = lastExt.endDate;
    extendedUntilTime = lastExt.endTime || apiActualEndTime || normalizeStr(fallbackEndTime);
  } else if (count > 0) {
    extendedUntilDate = apiActualEndDate || formatDateOnly(fallbackEndDate);
    extendedUntilTime = apiActualEndTime || normalizeStr(fallbackEndTime);
  }
  if (extendedUntilDate && apiActualEndDate && apiActualEndDate > extendedUntilDate) {
    extendedUntilDate = apiActualEndDate;
    extendedUntilTime = apiActualEndTime || extendedUntilTime;
  }

  return {
    extensions: sorted,
    extensionsCount: count,
    extendedDaysCount: daysSum,
    extensionsAmount: Math.round(amountSum * 100) / 100,
    extendedUntilDate: extendedUntilDate,
    extendedUntilTime: extendedUntilTime
  };
}

function computeTotalAmount(baseAmount, extensionsList) {
  var total = toNumber(baseAmount, 0);
  if (Array.isArray(extensionsList)) {
    for (var i = 0; i < extensionsList.length; i++) {
      total += toNumber(extensionsList[i].amount, 0);
    }
  }
  return Math.round(total * 100) / 100;
}

function escapeCsvCell(val) {
  var s = val === null || val === undefined ? '' : String(val);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function jsonResponse(success, message, data, error) {
  var payload = {
    success: Boolean(success),
    message: message || '',
    data: data !== undefined ? data : null,
    error: error || null
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
