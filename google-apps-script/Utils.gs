/**
 * RENTAL GATE CRM — Utilities & Domain Constants
 * Google Apps Script Backend
 */

var RG_SHEETS = {
  USERS: 'Users',
  EMPLOYEES: 'Employees',
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
  SYNC_LOG: 'SyncLog',
  ANNOUNCEMENTS: 'Announcements',
  DELEGATIONS: 'Delegations',
  RESERVATION_LOCKS: 'ReservationLocks'
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
  created: 'قيد الانتظار',
  confirmed: 'مؤكد',
  booked: 'تم الحجز',
  reserved: 'تم الحجز',
  active: 'نشط الآن',
  started: 'نشط الآن',
  in_progress: 'مؤكد',
  on_the_way: 'في الطريق',
  ready: 'جاهز للاستلام',
  ready_for_pickup: 'جاهز للاستلام',
  ready_to_pickup: 'جاهز للاستلام',
  hold: 'معلق',
  on_hold: 'معلق',
  onhold: 'معلق',
  suspended: 'معلق',
  suspend: 'معلق',
  paused: 'معلق',
  pause: 'معلق',
  frozen: 'معلق',
  hold_by_admin: 'معلق',
  admin_hold: 'معلق',
  waiting_approval: 'معلق',
  waiting_confirmation: 'معلق',
  pending_approval: 'معلق',
  pending_confirmation: 'معلق',
  under_review: 'معلق',
  delivered: 'تم التسليم',
  picked_up: 'نشط الآن',
  received: 'نشط الآن',
  on_rent: 'نشط الآن',
  rented: 'نشط الآن',
  car_received: 'نشط الآن',
  ongoing: 'نشط الآن',
  returned: 'تم الإرجاع',
  extended: 'تم التمديد',
  automatically_extended: 'تم التمديد تلقائيًا',
  completed: 'منتهي',
  finished: 'منتهي',
  closed: 'منتهي',
  ended: 'منتهي',
  finished_by_driver: 'تم التسليم من قبل السائق',
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
  pending_payment: 'بانتظار الدفع',
  paid: 'مدفوع',
  wallet_paid: 'مدفوع عن طريق المحفظة',
  paid_by_wallet: 'مدفوع عن طريق المحفظة',
  paid_wallet: 'مدفوع عن طريق المحفظة',
  admin_approved: 'مقبول',
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
  var key = normalizeStr(code).toLowerCase().replace(/[\s-]+/g, '_');
  return RG_STATUS_MAP[key] || normalizeStr(code) || 'غير محدد';
}

function extractSourceReservationId_(apiItem) {
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
  return normalizeStr(
    item.sourceReservationId ||
    item.reservationId ||
    item.reservation_id ||
    nested.reservationId ||
    nested.reservation_id ||
    nested.id ||
    item.id
  );
}

function extractReservationNumber_(apiItem) {
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
  return normalizeStr(
    item.reservationNumber ||
    item.reservation_number ||
    item.reservationNo ||
    item.reservation_no ||
    item.reservationCode ||
    item.reservation_code ||
    item.bookingNumber ||
    item.booking_number ||
    item.bookingCode ||
    item.booking_code ||
    item.contractNumber ||
    item.contract_number ||
    item.orderNumber ||
    item.order_number ||
    item.referenceNumber ||
    item.reference_number ||
    item.refNumber ||
    item.ref_number ||
    item.reference ||
    item.code ||
    item.serialNumber ||
    item.serial_number ||
    item.number ||
    nested.reservationNumber ||
    nested.reservation_number ||
    nested.reservationCode ||
    nested.code ||
    nested.reference ||
    extractSourceReservationId_(item)
  );
}

function extractReservationStatusCode_(apiItem, preferOriginalCode) {
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
  var raw = preferOriginalCode
    ? (item.originalStatusCode || item.reservationStatus || item.status || item.status_code || item.bookingStatus || item.contractStatus || item.statusEn || nested.reservationStatus || nested.status)
    : (item.reservationStatus || item.status || item.status_code || item.bookingStatus || item.contractStatus || item.statusEn || item.originalStatusCode || nested.reservationStatus || nested.status);
  return normalizeStr(raw).toLowerCase().replace(/[\s-]+/g, '_');
}

var RG_MANUAL_BLOCKED_STATUSES_ = [
  'مرفوض', 'مرفوضة', 'تم الرفض', 'rejected', 'declined', 'refused',
  'ملغي', 'ملغى', 'ملغاة', 'تم الإلغاء', 'تم الالغاء', 'cancelled', 'canceled'
];

function isManualBlockedWorkflowStatusGs_(status) {
  var clean = normalizeStr(status).toLowerCase();
  if (!clean) return false;
  return RG_MANUAL_BLOCKED_STATUSES_.indexOf(clean) !== -1;
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

var RG_MANUAL_WORKFLOW_STATUS_OPTIONS = RG_WORKFLOW_STATUS_OPTIONS.filter(function (st) {
  return !isManualBlockedWorkflowStatusGs_(st);
});

function isValidWorkflowStatus_(status) {
  var clean = normalizeStr(status);
  return Boolean(clean && RG_WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1);
}

function isValidManualWorkflowStatus_(status) {
  var clean = normalizeStr(status);
  return Boolean(clean && !isManualBlockedWorkflowStatusGs_(clean) && RG_MANUAL_WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1);
}

var RG_NEVER_EXCLUDE_STATUSES_ = {
  cancelled: true, canceled: true, declined: true, rejected: true, refused: true,
  'ملغي': true, 'ملغى': true, 'ملغاة': true, 'تم الإلغاء': true, 'تم الالغاء': true,
  'مرفوض': true, 'مرفوضة': true, 'تم الرفض': true
};

function sanitizeExcludedStatusesListGs_(rawList) {
  var arr = Array.isArray(rawList) ? rawList : [];
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var cleaned = normalizeStr(arr[i]).toLowerCase();
    if (!cleaned || seen[cleaned] || RG_NEVER_EXCLUDE_STATUSES_[cleaned]) continue;
    seen[cleaned] = true;
    out.push(cleaned);
  }
  return out;
}

function classifyReservationLifecycleGs_(resOrStatus) {
  if (!resOrStatus) return 'active';
  function classifyToken(raw) {
    var s = normalizeStr(raw).toLowerCase();
    if (!s) return '';
    if (s === 'rejected' || s === 'declined' || s === 'refused' ||
        s === 'مرفوض' || s === 'مرفوضة' || s === 'تم الرفض') {
      return 'rejected';
    }
    if (s === 'cancelled' || s === 'canceled' ||
        s === 'ملغي' || s === 'ملغى' || s === 'ملغاة' ||
        s === 'تم الإلغاء' || s === 'تم الالغاء') {
      return 'cancelled';
    }
    return 'explicit_active';
  }
  if (typeof resOrStatus === 'string') {
    var strCls = classifyToken(resOrStatus);
    return (strCls === 'rejected' || strCls === 'cancelled') ? strCls : 'active';
  }
  var extCandidates = [
    resOrStatus.originalStatusCode,
    resOrStatus.statusCode,
    resOrStatus.reservationStatus,
    resOrStatus.status,
    resOrStatus.originalStatusAr,
    resOrStatus.statusAr
  ];
  var sawExtActive = false;
  for (var i = 0; i < extCandidates.length; i++) {
    var cls = classifyToken(extCandidates[i]);
    if (cls === 'rejected' || cls === 'cancelled') return cls;
    if (cls === 'explicit_active') sawExtActive = true;
  }
  var intCls = classifyToken(resOrStatus.internalStatus);
  if (intCls === 'rejected' || intCls === 'cancelled') return intCls;
  if (sawExtActive || intCls === 'explicit_active') return 'active';
  if (normalizeStr(resOrStatus.rejectedAt)) return 'rejected';
  if (normalizeStr(resOrStatus.cancelledAt)) return 'cancelled';
  return 'active';
}

function extractCustomerNationalIdGs_(apiItem, existing) {
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var cust = (item.customer && typeof item.customer === 'object') ? item.customer : {};
  var client = (item.client && typeof item.client === 'object') ? item.client : {};
  var userObj = (item.user && typeof item.user === 'object') ? item.user : {};
  var driverObj = (item.driver && typeof item.driver === 'object') ? item.driver : {};
  var renterObj = (item.renter && typeof item.renter === 'object') ? item.renter : {};
  var clientInfoObj = (item.clientInfo && typeof item.clientInfo === 'object') ? item.clientInfo : {};
  var customerInfoObj = (item.customerInfo && typeof item.customerInfo === 'object') ? item.customerInfo : {};
  var driverInfoObj = (item.driverInfo && typeof item.driverInfo === 'object') ? item.driverInfo : {};
  var documentObj = (item.document && typeof item.document === 'object') ? item.document : {};
  var identityObj = (item.identity && typeof item.identity === 'object') ? item.identity : {};
  var idKeys = [
    'clientNationalId', 'client_national_id', 'customerNationalId', 'customer_national_id',
    'clientIdNumber', 'client_id_number', 'customerIdNumber', 'customer_id_number',
    'nationalId', 'national_id', 'nationalIdNumber', 'national_id_number',
    'identityNumber', 'identity_number', 'idNumber', 'id_number', 'idNo', 'id_no',
    'iqamaNumber', 'iqama_number', 'clientIqama', 'client_iqama',
    'residentId', 'resident_id', 'citizenId', 'citizen_id',
    'clientIdentity', 'clientIdentityNumber', 'clientIdNo', 'nid', 'ssn',
    'passportNumber', 'passport_number', 'number'
  ];
  var isInvalidIdValGs = function (valStr) {
    if (!valStr) return true;
    var low = valStr.toLowerCase();
    return valStr === '-' || valStr === '—' || low === 'null' || low === 'undefined' ||
      low === 'n/a' || low === 'na' || low === 'none' || valStr === 'غير متاح' ||
      valStr === 'غير محدد' || /^0+$/.test(valStr);
  };
  var sources = [
    item, cust, client, userObj, driverObj, renterObj,
    clientInfoObj, customerInfoObj, driverInfoObj, documentObj, identityObj
  ];
  for (var si = 0; si < sources.length; si++) {
    var srcObj = sources[si];
    if (!srcObj || typeof srcObj !== 'object') continue;
    for (var ki = 0; ki < idKeys.length; ki++) {
      if (ki === idKeys.length - 1 && si === 0) continue; // skip root item.number
      var raw = srcObj[idKeys[ki]];
      if (raw === null || raw === undefined) continue;
      var rawCand = String(raw).trim();
      if (typeof convertEasternDigitsGs_ === 'function') rawCand = convertEasternDigitsGs_(rawCand).trim();
      if (isInvalidIdValGs(rawCand)) continue;
      return rawCand;
    }
  }
  var prev = existing && existing.customerIdNumber ? String(existing.customerIdNumber).trim() : '';
  if (typeof convertEasternDigitsGs_ === 'function' && prev) prev = convertEasternDigitsGs_(prev).trim();
  if (!isInvalidIdValGs(prev)) {
    var apiPhoneRaw = normalizeStr(
      item.clientMobile || item.customerPhone || item.customer_phone || cust.phone || cust.mobile || client.phone || client.mobile || clientInfoObj.phone || clientInfoObj.mobile
    );
    var prevPhoneRaw = existing && existing.customerPhone ? normalizeStr(existing.customerPhone) : '';
    if (typeof convertEasternDigitsGs_ === 'function') {
      apiPhoneRaw = convertEasternDigitsGs_(apiPhoneRaw);
      prevPhoneRaw = convertEasternDigitsGs_(prevPhoneRaw);
    }
    var apiPhone = apiPhoneRaw.replace(/\D+/g, '');
    var prevPhone = prevPhoneRaw.replace(/\D+/g, '');
    if (apiPhone && prevPhone && apiPhone !== prevPhone) return '';
    return prev;
  }
  return '';
}

function resolveSourceWorkflowStatus_(apiItem) {
  var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
  var statusCode = extractReservationStatusCode_(item, true);
  if (statusCode) {
    var translated = translateOriginalStatus(statusCode);
    if (translated && translated !== 'غير محدد') return translated;
  }
  var explicitAr = normalizeStr(item.originalStatusAr || item.statusAr);
  if (explicitAr && explicitAr !== 'غير محدد') return explicitAr;
  return statusCode || 'قيد الانتظار';
}

function shouldAutoReconcileSyncedStatus_(existing, sourceStatusAr) {
  if (!existing || typeof existing !== 'object') return false;
  var nextSrc = normalizeStr(sourceStatusAr);
  if (!nextSrc || nextSrc === 'غير محدد') return false;
  var prevInternal = normalizeStr(existing.internalStatus);
  if (!prevInternal) return true;
  if (prevInternal === nextSrc) return false;

  var incomingLifecycle = classifyReservationLifecycleGs_({
    internalStatus: nextSrc,
    originalStatusAr: nextSrc
  });
  var existingLifecycle = classifyReservationLifecycleGs_(existing);
  if (incomingLifecycle !== existingLifecycle) return true;

  var history = normalizeStatusHistory_(existing.statusHistory);
  for (var i = 0; i < history.length; i++) {
    var src = normalizeStr(history[i].source).toLowerCase();
    if (src && src !== 'api_pull' && src !== 'gas_sync' && src !== 'system') {
      return false;
    }
  }

  var lastTxt = normalizeStr(existing.lastUpdateText);
  var isAutoSyncText = !lastTxt ||
    lastTxt.indexOf('تم السحب من Rental Gate') === 0 ||
    lastTxt.indexOf('تم الاستيراد من Rental Gate') === 0 ||
    lastTxt.indexOf('تحديث الحالة من Rental Gate') === 0 ||
    lastTxt.indexOf('بانتظار') === 0;
  if (!isAutoSyncText) return false;

  var prevOrigAr = normalizeStr(existing.originalStatusAr);
  var prevOrigCode = normalizeStr(existing.originalStatusCode);
  var prevWasUntouchedMirror =
    !prevOrigAr ||
    prevInternal === prevOrigAr ||
    (prevOrigCode && prevInternal.toLowerCase() === prevOrigCode.toLowerCase());
  return Boolean(prevWasUntouchedMirror);
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
  var preset = normalizeStr(opts.preset || opts.datePreset).toLowerCase() || 'all';
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

function extractMentionedEmployees_(text, employees, excludeEmployeeId) {
  var raw = normalizeStr(text);
  if (!raw || raw.indexOf('@') === -1) return [];
  var list = Array.isArray(employees) ? employees : [];
  var exId = normalizeStr(excludeEmployeeId);
  var candidates = [];
  for (var i = 0; i < list.length; i++) {
    var emp = list[i];
    if (!emp || typeof emp !== 'object') continue;
    if (normalizeStr(emp.status).toLowerCase() === 'disabled') continue;
    var id = normalizeStr(emp.id);
    var name = normalizeStr(emp.name);
    var username = normalizeStr(emp.username);
    if (!id || (!name && !username)) continue;
    if (exId && id === exId) continue;
    candidates.push({ id: id, name: name, username: username, role: normalizeStr(emp.role) });
  }
  candidates.sort(function (a, b) {
    var la = (a.name || '').length;
    var lb = (b.name || '').length;
    if (lb !== la) return lb - la;
    return (b.username || '').length - (a.username || '').length;
  });

  function isPrefixBoundary(ch) {
    return !ch || /[\s,،.(:;\[{"'«\-\n\r]/.test(ch);
  }
  function isSuffixBoundary(ch) {
    return !ch || /[\s,،.!?;:)\]'"»\-@#\n\r]/.test(ch);
  }

  var found = [];
  var seen = {};
  var idx = 0;
  while (idx < raw.length) {
    if (raw.charAt(idx) === '@' && isPrefixBoundary(idx === 0 ? '' : raw.charAt(idx - 1))) {
      var after = raw.slice(idx + 1);
      var afterLower = after.toLowerCase();
      var matched = null;
      var matchedLen = 0;
      for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
        var c = candidates[cIdx];
        if (c.name) {
          var nmLower = c.name.toLowerCase();
          if (afterLower.indexOf(nmLower) === 0 && isSuffixBoundary(raw.charAt(idx + 1 + c.name.length))) {
            matched = c;
            matchedLen = 1 + c.name.length;
            break;
          }
          var uName = c.name.replace(/\s+/g, '_');
          if (uName !== c.name && afterLower.indexOf(uName.toLowerCase()) === 0 && isSuffixBoundary(raw.charAt(idx + 1 + uName.length))) {
            matched = c;
            matchedLen = 1 + uName.length;
            break;
          }
        }
      }
      if (!matched) {
        for (var uIdx = 0; uIdx < candidates.length; uIdx++) {
          var cu = candidates[uIdx];
          if (cu.username && afterLower.indexOf(cu.username.toLowerCase()) === 0 && isSuffixBoundary(raw.charAt(idx + 1 + cu.username.length))) {
            matched = cu;
            matchedLen = 1 + cu.username.length;
            break;
          }
        }
      }
      if (matched) {
        if (!seen[matched.id]) {
          seen[matched.id] = true;
          found.push(matched);
        }
        idx += matchedLen;
        continue;
      }
    }
    idx += 1;
  }
  return found;
}

function dispatchMentionNotifications_(texts, sender, entityType, entityId, label) {
  var parts = [];
  var list = Array.isArray(texts) ? texts : [];
  for (var i = 0; i < list.length; i++) {
    var clean = normalizeStr(list[i]);
    if (clean) parts.push(clean);
  }
  var combined = parts.join('\n');
  if (!combined || combined.indexOf('@') === -1) return [];

  var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
  var senderId = (sender && (sender.id || sender.employeeId)) || '';
  var senderName = (sender && sender.name) || 'موظف';
  var mentioned = extractMentionedEmployees_(combined, employees, senderId);
  if (!mentioned.length) return [];

  var snippet = combined.replace(/\s+/g, ' ').trim().slice(0, 120);
  var titlePrefix = entityType === 'Problem'
    ? ('إشارة لك في المشكلة ' + (label || '')).trim()
    : ('إشارة لك في الحجز ' + (label || '')).trim();
  var batch = [];
  for (var m = 0; m < mentioned.length; m++) {
    batch.push({
      recipientEmployeeId: mentioned[m].id,
      recipientRole: mentioned[m].role || '',
      type: 'mention',
      title: titlePrefix + ' (@' + senderName + ')',
      message: senderName + ' أشار إليك: "' + snippet + '"',
      entityType: entityType,
      entityId: entityId
    });
  }
  if (batch.length > 0) createNotificationsBatch_(batch);
  return mentioned;
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
