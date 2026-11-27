/**
 * RENTAL GATE CRM — Pure Domain Core (Shared by Browser Frontend & Node Unit Tests)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RGCrmCore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var ROLES = {
    DEVELOPER: 'developer',
    GENERAL_MANAGER: 'general_manager',
    SUPERVISOR: 'supervisor',
    AGENT: 'agent'
  };

  var ROLE_LABELS = {
    ar: {
      developer: 'المبرمج',
      general_manager: 'المدير العام',
      supervisor: 'المشرف',
      agent: 'موظف خدمة العملاء'
    },
    en: {
      developer: 'Developer',
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
    cancelled_by_customer: 'ملغي',
    canceled_by_customer: 'ملغي',
    cancelled_by_client: 'ملغي',
    canceled_by_client: 'ملغي',
    cancelled_by_user: 'ملغي',
    canceled_by_user: 'ملغي',
    cancelled_by_admin: 'ملغي',
    canceled_by_admin: 'ملغي',
    cancelled_by_provider: 'ملغي',
    canceled_by_provider: 'ملغي',
    cancelled_by_company: 'ملغي',
    canceled_by_company: 'ملغي',
    customer_cancelled: 'ملغي',
    customer_canceled: 'ملغي',
    user_cancelled: 'ملغي',
    user_canceled: 'ملغي',
    client_cancelled: 'ملغي',
    client_canceled: 'ملغي',
    admin_cancelled: 'ملغي',
    admin_canceled: 'ملغي',
    provider_cancelled: 'ملغي',
    provider_canceled: 'ملغي',
    company_cancelled: 'ملغي',
    company_canceled: 'ملغي',
    system_cancelled: 'ملغي',
    system_canceled: 'ملغي',
    auto_cancelled: 'ملغي',
    auto_canceled: 'ملغي',
    declined: 'مرفوض',
    rejected: 'مرفوض',
    refused: 'مرفوض',
    rejected_by_admin: 'مرفوض',
    rejected_by_company: 'مرفوض',
    rejected_by_provider: 'مرفوض',
    rejected_by_customer: 'مرفوض',
    rejected_by_client: 'مرفوض',
    rejected_by_user: 'مرفوض',
    provider_rejected: 'مرفوض',
    admin_rejected: 'مرفوض',
    company_rejected: 'مرفوض',
    customer_rejected: 'مرفوض',
    client_rejected: 'مرفوض',
    user_rejected: 'مرفوض',
    auto_rejected: 'مرفوض',
    system_rejected: 'مرفوض',
    declined_by_admin: 'مرفوض',
    declined_by_company: 'مرفوض',
    declined_by_provider: 'مرفوض',
    refused_by_admin: 'مرفوض',
    refused_by_company: 'مرفوض',
    refused_by_provider: 'مرفوض',
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

  var MANUAL_BLOCKED_STATUS_TOKENS = [
    'مرفوض', 'مرفوضة', 'تم الرفض', 'تم الرفض من الشركة', 'تم الرفض من المزود', 'مرفوض من الموقع', 'مرفوض من الشركة', 'مرفوض من المزود', 'مرفوض من الادارة', 'مرفوض من الإدارة', 'مرفوض تلقائيا', 'مرفوض تلقائياً',
    'rejected', 'declined', 'refused', 'rejected_by_admin', 'rejected_by_company', 'rejected_by_provider', 'rejected_by_customer', 'rejected_by_client', 'rejected_by_user', 'provider_rejected', 'admin_rejected', 'company_rejected', 'customer_rejected', 'client_rejected', 'user_rejected', 'auto_rejected', 'system_rejected', 'declined_by_admin', 'declined_by_company', 'declined_by_provider', 'refused_by_admin', 'refused_by_company', 'refused_by_provider',
    'تم الإلغاء', 'تم الالغاء', 'تم الإلغاء من العميل', 'تم الالغاء من العميل', 'ملغي', 'ملغى', 'ملغاة', 'ملغي من العميل', 'ملغى من العميل', 'ملغي من الشركة', 'ملغى من الشركة', 'ملغي من الادارة', 'ملغي من الإدارة', 'ملغى من الادارة', 'ملغى من الإدارة', 'ملغي تلقائيا', 'ملغي تلقائياً',
    'cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer', 'cancelled_by_client', 'canceled_by_client', 'cancelled_by_user', 'canceled_by_user', 'cancelled_by_admin', 'canceled_by_admin', 'cancelled_by_provider', 'canceled_by_provider', 'cancelled_by_company', 'canceled_by_company', 'customer_cancelled', 'customer_canceled', 'user_cancelled', 'user_canceled', 'client_cancelled', 'client_canceled', 'admin_cancelled', 'admin_canceled', 'provider_cancelled', 'provider_canceled', 'company_cancelled', 'company_canceled', 'system_cancelled', 'system_canceled', 'auto_cancelled', 'auto_canceled'
  ];

  function isManualBlockedWorkflowStatus(status) {
    var clean = normalizeSearchText(status);
    if (!clean) return false;
    for (var i = 0; i < MANUAL_BLOCKED_STATUS_TOKENS.length; i++) {
      if (clean === normalizeSearchText(MANUAL_BLOCKED_STATUS_TOKENS[i])) return true;
    }
    return false;
  }

  var MANUAL_WORKFLOW_STATUS_OPTIONS = WORKFLOW_STATUS_OPTIONS.filter(function (st) {
    return !isManualBlockedWorkflowStatus(st);
  });

  var DELIVERY_TRANSLATIONS = {
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

  var EXTENSION_TYPE_TRANSLATIONS = {
    client: 'تمديد بواسطة العميل',
    customer: 'تمديد بواسطة العميل',
    user: 'تمديد بواسطة العميل',
    automatic: 'تمديد تلقائي',
    auto: 'تمديد تلقائي',
    system: 'تمديد تلقائي',
    admin: 'تمديد إداري',
    manual: 'تمديد إداري'
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

  function normalizeSearchText(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
      .replace(/\u0649/g, '\u064A')
      .replace(/\u0629/g, '\u0647')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function tokenizeSearchQuery(query) {
    var norm = normalizeSearchText(query);
    if (!norm) return [];
    return norm.split(' ').filter(Boolean);
  }

  function matchesSearchFields(fields, query) {
    var tokens = tokenizeSearchQuery(query);
    if (tokens.length === 0) return true;
    var list = Array.isArray(fields) ? fields : [fields];
    var normFields = [];
    for (var i = 0; i < list.length; i++) {
      var nf = normalizeSearchText(list[i]);
      if (nf) normFields.push(nf);
    }
    if (normFields.length === 0) return false;
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      var hit = false;
      for (var f = 0; f < normFields.length; f++) {
        if (normFields[f].indexOf(tok) !== -1) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  }

  function normalizeNationalId(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
      .replace(/[\s\-_]+/g, '')
      .trim()
      .toLowerCase();
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

  var TIME_FORMATS = ['24h', '12h'];
  var SIDEBAR_POSITIONS = ['side', 'top', 'bottom'];
  var TIMEZONE_DISPLAY_MODES = ['both', 'sa', 'eg'];
  var RESERVATIONS_DISPLAY_MODES = ['table', 'calendar'];
  var CALENDAR_GRANULARITIES = ['month', 'week', 'day'];

  function normalizeTimeFormat(val) {
    return String(val || '').trim().toLowerCase() === '12h' ? '12h' : '24h';
  }

  function normalizeSidebarPosition(val) {
    var s = String(val || '').trim().toLowerCase();
    return (s === 'top' || s === 'bottom') ? s : 'side';
  }

  function normalizeTimezoneMode(val) {
    var s = String(val || '').trim().toLowerCase();
    if (s === 'sa' || s === 'ksa' || s === 'saudi') return 'sa';
    if (s === 'eg' || s === 'egypt' || s === 'cairo') return 'eg';
    return 'both';
  }

  function normalizeReservationsDisplayMode(val) {
    var s = String(val || '').trim().toLowerCase();
    return s === 'calendar' ? 'calendar' : 'table';
  }

  function normalizeCalendarGranularity(val) {
    var s = String(val || '').trim().toLowerCase();
    if (s === 'day') return 'day';
    if (s === 'month') return 'month';
    return 'week';
  }

  function extractTimeOnly(val) {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      var shifted = new Date(val.getTime() + 3 * 3600000);
      return shifted.toISOString().substring(11, 16);
    }
    var s = String(val).trim();
    if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var hmOnly = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (hmOnly) {
      var hh = Math.min(23, Math.max(0, parseInt(hmOnly[1], 10)));
      var mm = Math.min(59, Math.max(0, parseInt(hmOnly[2], 10)));
      return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }
    var dt = formatDisplayDateTime(s);
    return dt && dt.length >= 16 ? dt.substring(11, 16) : '';
  }

  function formatTimePreference(val, timeFormat, lang) {
    var hm = extractTimeOnly(val);
    if (!hm) return '';
    if (normalizeTimeFormat(timeFormat) !== '12h') return hm;
    var parts = hm.split(':');
    var h = parseInt(parts[0], 10);
    var mStr = parts[1] || '00';
    if (isNaN(h)) return hm;
    var isPm = h >= 12;
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    var suffix = (lang === 'en') ? (isPm ? 'PM' : 'AM') : (isPm ? 'م' : 'ص');
    return h12 + ':' + mStr + ' ' + suffix;
  }

  function formatDateTimePreference(val, timeFormat, lang) {
    var dt = formatDisplayDateTime(val);
    if (!dt) return '';
    if (normalizeTimeFormat(timeFormat) !== '12h') return dt;
    var m = dt.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
    if (!m) return dt;
    return m[1] + ' ' + formatTimePreference(m[2], '12h', lang);
  }

  function getRiyadhTodayDateStr(nowMs) {
    var ms = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    return new Date(ms + 3 * 3600000).toISOString().substring(0, 10);
  }

  function convertKsaDateTimeToEgypt(dateStr, timeStr, nowMs) {
    var dClean = formatDisplayDate(dateStr);
    var tClean = extractTimeOnly(timeStr);
    if (!tClean) {
      return {
        hasTime: false,
        saDate: dClean,
        saTime: '',
        egDate: dClean,
        egTime: '',
        dateShifted: false
      };
    }

    var refDate = /^\d{4}-\d{2}-\d{2}$/.test(dClean) ? dClean : getRiyadhTodayDateStr(nowMs);
    var partsD = refDate.split('-');
    var partsT = tClean.split(':');
    var yr = parseInt(partsD[0], 10);
    var mo = parseInt(partsD[1], 10);
    var dy = parseInt(partsD[2], 10);
    var hh = parseInt(partsT[0], 10);
    var mm = parseInt(partsT[1], 10);
    var utcMs = Date.UTC(yr, mo - 1, dy, hh - 3, mm, 0);

    var egDate = refDate;
    var egTime = tClean;
    var resolved = false;

    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
        var fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Cairo',
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        if (typeof fmt.formatToParts === 'function') {
          var fParts = fmt.formatToParts(new Date(utcMs));
          var map = {};
          for (var i = 0; i < fParts.length; i++) {
            map[fParts[i].type] = fParts[i].value;
          }
          if (map.year && map.month && map.day && map.hour !== undefined && map.minute !== undefined) {
            var egH = map.hour === '24' ? '00' : String(map.hour);
            if (egH.length < 2) egH = '0' + egH;
            var egM = String(map.minute);
            if (egM.length < 2) egM = '0' + egM;
            var egMo = String(map.month);
            if (egMo.length < 2) egMo = '0' + egMo;
            var egDy = String(map.day);
            if (egDy.length < 2) egDy = '0' + egDy;
            egDate = map.year + '-' + egMo + '-' + egDy;
            egTime = egH + ':' + egM;
            resolved = true;
          }
        }
      }
    } catch (_e) {}

    if (!resolved) {
      var fallbackCairo = new Date(utcMs + 2 * 3600000);
      egDate = fallbackCairo.toISOString().substring(0, 10);
      egTime = fallbackCairo.toISOString().substring(11, 16);
    }

    var outEgDate = dClean ? egDate : '';
    return {
      hasTime: true,
      saDate: dClean,
      saTime: tClean,
      egDate: outEgDate,
      egTime: egTime,
      dateShifted: Boolean(dClean && outEgDate && outEgDate !== dClean)
    };
  }

  function buildBookingTimezoneDisplay(dateStr, timeStr, options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var lang = opts.lang === 'en' ? 'en' : 'ar';
    var tf = normalizeTimeFormat(opts.timeFormat);
    var tzMode = normalizeTimezoneMode(opts.timezoneMode);
    var compact = Boolean(opts.compact);
    var timeOnly = Boolean(opts.timeOnly);
    var conv = convertKsaDateTimeToEgypt(dateStr, timeStr, opts.nowMs);

    var saLabel = lang === 'en'
      ? (compact ? 'Saudi (Orig.)' : 'Original Saudi Time')
      : (compact ? 'السعودي (الأصلي)' : 'التوقيت الأصلي السعودي');
    var egLabel = lang === 'en'
      ? (compact ? 'Egypt' : 'Egypt Time')
      : (compact ? 'المصري' : 'التوقيت المصري');

    if (!conv.hasTime) {
      var dateFallbackEntry = conv.saDate ? [{
        zone: 'sa',
        date: conv.saDate,
        time: '',
        rawTime: '',
        dateShifted: false,
        valueText: conv.saDate,
        label: saLabel
      }] : [];
      return {
        mode: tzMode,
        hasTime: false,
        saDate: conv.saDate,
        saTime: '',
        egDate: conv.egDate,
        egTime: '',
        dateShifted: false,
        entries: dateFallbackEntry
      };
    }

    var saTimeDisp = formatTimePreference(conv.saTime, tf, lang);
    var egTimeDisp = formatTimePreference(conv.egTime, tf, lang);

    var saValueText = timeOnly
      ? saTimeDisp
      : (conv.saDate ? (conv.saDate + ' · ' + saTimeDisp) : saTimeDisp);
    var egValueText = timeOnly
      ? (conv.dateShifted && conv.egDate ? (egTimeDisp + ' (' + conv.egDate + ')') : egTimeDisp)
      : (conv.egDate
          ? ((compact && !conv.dateShifted) ? egTimeDisp : (conv.egDate + ' · ' + egTimeDisp))
          : egTimeDisp);

    var saEntry = {
      zone: 'sa',
      date: conv.saDate,
      time: saTimeDisp,
      rawTime: conv.saTime,
      dateShifted: false,
      valueText: saValueText,
      label: saLabel
    };
    var egEntry = {
      zone: 'eg',
      date: conv.egDate,
      time: egTimeDisp,
      rawTime: conv.egTime,
      dateShifted: conv.dateShifted,
      valueText: egValueText,
      label: egLabel
    };

    var entries = [];
    if (tzMode === 'sa') {
      entries = [saEntry];
    } else if (tzMode === 'eg') {
      entries = [egEntry];
    } else {
      entries = [saEntry, egEntry];
    }

    return {
      mode: tzMode,
      hasTime: true,
      saDate: conv.saDate,
      saTime: saTimeDisp,
      egDate: conv.egDate,
      egTime: egTimeDisp,
      dateShifted: conv.dateShifted,
      saEntry: saEntry,
      egEntry: egEntry,
      entries: entries
    };
  }

  function translateOriginalStatus(code) {
    var key = normalizeStr(code).toLowerCase().replace(/[\s-]+/g, '_');
    return STATUS_TRANSLATIONS[key] || normalizeStr(code) || 'غير محدد';
  }

  function extractSourceReservationId(apiItem) {
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

  function extractCustomerNationalId(apiItem, existing) {
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
    var nestedObjects = [
      cust, client, userObj, driverObj, renterObj,
      clientInfoObj, customerInfoObj, driverInfoObj, documentObj, identityObj
    ];
    var candidates = [
      item.clientNationalId,
      item.client_national_id,
      item.customerNationalId,
      item.customer_national_id,
      item.clientIdNumber,
      item.client_id_number,
      item.customerIdNumber,
      item.customer_id_number,
      item.nationalId,
      item.national_id,
      item.nationalIdNumber,
      item.national_id_number,
      item.identityNumber,
      item.identity_number,
      item.idNumber,
      item.id_number,
      item.idNo,
      item.id_no,
      item.iqamaNumber,
      item.iqama_number,
      item.clientIqama,
      item.client_iqama,
      item.residentId,
      item.resident_id,
      item.citizenId,
      item.citizen_id,
      item.clientIdentity,
      item.clientIdentityNumber,
      item.clientIdNo,
      item.nid,
      item.ssn,
      item.passportNumber,
      item.passport_number
    ];
    for (var n = 0; n < nestedObjects.length; n++) {
      var no = nestedObjects[n];
      candidates.push(
        no.nationalId,
        no.national_id,
        no.nationalIdNumber,
        no.national_id_number,
        no.idNumber,
        no.id_number,
        no.idNo,
        no.id_no,
        no.identityNumber,
        no.identity_number,
        no.iqamaNumber,
        no.iqama_number,
        no.clientNationalId,
        no.client_national_id,
        no.clientIdNumber,
        no.client_id_number,
        no.residentId,
        no.resident_id,
        no.citizenId,
        no.citizen_id,
        no.nid,
        no.ssn,
        no.passportNumber,
        no.passport_number,
        no.number
      );
    }
    var isInvalidIdValue = function (valStr) {
      if (!valStr) return true;
      var low = valStr.toLowerCase();
      if (
        valStr === '-' ||
        valStr === '—' ||
        low === 'null' ||
        low === 'undefined' ||
        low === 'n/a' ||
        low === 'na' ||
        low === 'none' ||
        valStr === 'غير متاح' ||
        valStr === 'غير محدد' ||
        /^0+$/.test(valStr)
      ) {
        return true;
      }
      return false;
    };
    for (var i = 0; i < candidates.length; i++) {
      var raw = candidates[i];
      if (raw === null || raw === undefined) continue;
      var s = convertEasternDigitsToAscii(String(raw)).trim();
      if (isInvalidIdValue(s)) continue;
      return s;
    }
    var prev = existing && existing.customerIdNumber ? convertEasternDigitsToAscii(String(existing.customerIdNumber)).trim() : '';
    if (!isInvalidIdValue(prev)) {
      // Only carry forward existing customerIdNumber if it belongs to the same customer/booking
      var apiPhone = convertEasternDigitsToAscii(normalizeStr(
        item.clientMobile || item.customerPhone || item.customer_phone || cust.phone || cust.mobile || client.phone || client.mobile || clientInfoObj.phone || clientInfoObj.mobile
      )).replace(/\D+/g, '');
      var prevPhone = existing && existing.customerPhone
        ? convertEasternDigitsToAscii(normalizeStr(existing.customerPhone)).replace(/\D+/g, '')
        : '';
      if (apiPhone && prevPhone && apiPhone !== prevPhone) {
        return '';
      }
      return prev;
    }
    return '';
  }

  function isProtectedRejectedOrCancelledItem(item) {
    if (!item || typeof item !== 'object') return false;
    var lc = classifyReservationLifecycle(item);
    return lc === 'rejected' || lc === 'cancelled';
  }

  function extractExplicitReferenceNumber(apiItem, existing, excludeValues) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
    var excluded = {};
    if (Array.isArray(excludeValues)) {
      for (var e = 0; e < excludeValues.length; e++) {
        var ev = normalizeStr(excludeValues[e]);
        if (ev) excluded[ev] = true;
      }
    }
    var candidates = [
      item.referenceNumber,
      item.reference_number,
      item.refNumber,
      item.ref_number,
      item.sourceReference,
      item.externalReference,
      item.orderRef,
      item.reference,
      nested.referenceNumber,
      nested.reference_number,
      nested.refNumber,
      nested.ref_number,
      nested.reference
    ];
    for (var i = 0; i < candidates.length; i++) {
      var val = normalizeStr(candidates[i]);
      if (!val || excluded[val]) continue;
      return val;
    }
    if (existing && typeof existing === 'object') {
      var exVal = normalizeStr(existing.referenceNumber);
      if (exVal && !excluded[exVal]) return exVal;
    }
    return '';
  }

  function extractReservationNumber(apiItem) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
    if (isProtectedRejectedOrCancelledItem(item)) {
      var srcId = extractSourceReservationId(item);
      var explicitRef = extractExplicitReferenceNumber(item, null);
      var explicitBooking = normalizeStr(
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
        item.code ||
        item.serialNumber ||
        item.serial_number ||
        item.number ||
        nested.reservationNumber ||
        nested.reservation_number ||
        nested.reservationCode ||
        nested.code
      );
      if (explicitBooking && (!explicitRef || explicitBooking !== explicitRef || !srcId)) {
        return explicitBooking;
      }
      return normalizeStr(srcId || explicitBooking);
    }
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
      extractSourceReservationId(item)
    );
  }

  function extractStatusTokenValue(raw) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'object') {
      raw = raw.code || raw.statusCode || raw.status_code || raw.reservationStatus ||
        raw.value || raw.key || raw.slug || raw.name || raw.en || raw.status || raw.label || raw.ar || '';
    }
    return normalizeStr(raw).toLowerCase().replace(/[\s-]+/g, '_');
  }

  function extractReservationStatusCode(apiItem, preferOriginalCode) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
    var candidates = preferOriginalCode
      ? [
          item.originalStatusCode, item.reservationStatus, item.status, item.status_code,
          item.bookingStatus, item.booking_status, item.contractStatus, item.contract_status,
          item.statusEn, item.status_en, nested.reservationStatus, nested.status, nested.status_code
        ]
      : [
          item.reservationStatus, item.status, item.status_code, item.bookingStatus, item.booking_status,
          item.contractStatus, item.contract_status, item.statusEn, item.status_en, item.originalStatusCode,
          nested.reservationStatus, nested.status, nested.status_code
        ];
    for (var i = 0; i < candidates.length; i++) {
      var tok = extractStatusTokenValue(candidates[i]);
      if (tok) return tok;
    }
    return '';
  }

  function sanitizeReasonText(raw) {
    if (raw === null || raw === undefined) return '';
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var fromArr = sanitizeReasonText(raw[i]);
        if (fromArr) return fromArr;
      }
      return '';
    }
    if (typeof raw === 'object') {
      var objFields = [
        raw.reasonAr, raw.reason_ar, raw.reasonEn, raw.reason_en,
        raw.rejectionReason, raw.rejection_reason, raw.cancellationReason, raw.cancellation_reason,
        raw.reason, raw.text, raw.message, raw.description, raw.desc,
        raw.note, raw.notes, raw.comment, raw.ar, raw.en, raw.label, raw.title, raw.name, raw.value
      ];
      for (var j = 0; j < objFields.length; j++) {
        var fromObj = sanitizeReasonText(objFields[j]);
        if (fromObj) return fromObj;
      }
      return '';
    }
    var s = normalizeStr(raw).replace(/\s+/g, ' ');
    if (!s) return '';
    var low = s.toLowerCase();
    if (
      s === '-' || s === '—' || s === '–' || /^[-–—]+$/.test(s) ||
      low === 'n/a' || low === 'na' || low === 'null' || low === 'undefined' || low === 'none' ||
      low === 'not available' || low === 'no reason' ||
      s === 'غير متاح' || s === 'غير محدد' || s === 'لا يوجد' || s === 'لايوجد' ||
      s === 'بدون سبب' || s === 'غير مسجل' || s === 'غير مذكور'
    ) {
      return '';
    }
    return s;
  }

  function isSameBookingContext(apiItem, existing) {
    if (!existing || typeof existing !== 'object') return false;
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var incSrcId = extractSourceReservationId(item);
    var extSrcId = normalizeStr(existing.sourceReservationId);
    if (incSrcId && extSrcId && incSrcId !== extSrcId) return false;
    var incNum = extractReservationNumber(item).replace(/^#+/, '').trim().toLowerCase();
    var extNum = normalizeStr(existing.reservationNumber).replace(/^#+/, '').trim().toLowerCase();
    if (incNum && extNum && incNum !== extNum) return false;
    return Boolean((incSrcId && incSrcId === extSrcId) || (incNum && incNum === extNum) || (!incSrcId && !incNum));
  }

  function extractReasonFromHistoryEntries(item, targetKind) {
    var arrays = [
      item.statusHistory, item.status_history, item.history, item.logs,
      item.statusLogs, item.status_logs, item.timeline, item.actions, item.events
    ];
    for (var a = 0; a < arrays.length; a++) {
      var list = arrays[a];
      if (!Array.isArray(list) || !list.length) continue;
      for (var i = list.length - 1; i >= 0; i--) {
        var entry = list[i];
        if (!entry || typeof entry !== 'object') continue;
        var st = extractStatusTokenValue(
          entry.newStatus || entry.status || entry.sourceStatusCode || entry.statusCode || entry.action || entry.type || entry.event
        );
        var entryKind = st ? classifyReservationLifecycle(st) : '';
        if (entryKind === targetKind) {
          var reasonFromEntry = sanitizeReasonText(
            targetKind === 'rejected'
              ? (entry.rejectionReason || entry.rejection_reason || entry.rejectReason || entry.reason || entry.note || entry.comment || entry.description)
              : (entry.cancellationReason || entry.cancellation_reason || entry.cancelReason || entry.reason || entry.note || entry.comment || entry.description)
          );
          if (reasonFromEntry) return reasonFromEntry;
        }
      }
    }
    return '';
  }

  function extractRejectionReason(apiItem, existing) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
    var directCandidates = [
      item.rejectionReason, item.rejection_reason,
      item.rejectReason, item.reject_reason,
      item.refusalReason, item.refusal_reason,
      item.declineReason, item.decline_reason,
      item.rejectionReasonAr, item.rejection_reason_ar,
      item.rejectionReasonEn, item.rejection_reason_en,
      item.providerRejectionReason, item.provider_rejection_reason,
      item.companyRejectionReason, item.company_rejection_reason,
      item.adminRejectionReason, item.admin_rejection_reason,
      item.rejectionNote, item.rejection_note,
      item.rejectNote, item.reject_note,
      item.rejectionComment, item.rejection_comment,
      item.rejectComment, item.reject_comment,
      nested.rejectionReason, nested.rejection_reason, nested.rejectReason, nested.reject_reason
    ];
    for (var i = 0; i < directCandidates.length; i++) {
      var hit = sanitizeReasonText(directCandidates[i]);
      if (hit) return hit;
    }
    var objContainers = [
      item.rejection, item.rejectionInfo, item.rejection_info, item.rejectionDetails, item.rejection_details,
      item.rejectInfo, item.reject_info, item.rejectDetails, item.reject_details, item.refusal, item.decline,
      item.statusDetails, item.status_details, item.statusInfo, item.status_info, item.lastAction, item.last_action,
      item.action, item.audit, nested.rejection, nested.statusDetails
    ];
    for (var j = 0; j < objContainers.length; j++) {
      var objHit = sanitizeReasonText(objContainers[j]);
      if (objHit) return objHit;
    }
    var historyHit = extractReasonFromHistoryEntries(item, 'rejected');
    if (historyHit) return historyHit;
    var generalCandidates = [
      item.statusReason, item.status_reason, item.actionReason, item.action_reason,
      item.reasonAr, item.reason_ar, item.reasonEn, item.reason_en, item.reason,
      item.statusNote, item.status_note, item.adminNote, item.admin_note,
      item.companyNote, item.company_note, item.providerNote, item.provider_note,
      item.noteAr, item.noteEn, item.comment, item.notes, item.note,
      nested.reason, nested.statusReason, nested.note
    ];
    for (var g = 0; g < generalCandidates.length; g++) {
      var genHit = sanitizeReasonText(generalCandidates[g]);
      if (genHit) return genHit;
    }
    var itemStatus = extractReservationStatusCode(item, false);
    if (matchesStatusList(itemStatus, REJECTED_STATUS_VALUES) || matchesStatusList(item.originalStatusAr || item.statusAr, REJECTED_STATUS_VALUES)) {
      var sharedCancelCandidates = [
        item.cancelReason, item.cancel_reason, item.cancellationReason, item.cancellation_reason,
        nested.cancelReason, nested.cancel_reason, nested.cancellationReason, nested.cancellation_reason
      ];
      for (var sc = 0; sc < sharedCancelCandidates.length; sc++) {
        var scHit = sanitizeReasonText(sharedCancelCandidates[sc]);
        if (scHit) return scHit;
      }
    }
    if (existing && isSameBookingContext(item, existing)) {
      var prev = sanitizeReasonText(existing.rejectionReason);
      if (prev) return prev;
    }
    return '';
  }

  function extractCancellationReason(apiItem, existing) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var nested = (item.reservation && typeof item.reservation === 'object') ? item.reservation : {};
    var directCandidates = [
      item.cancellationReason, item.cancellation_reason,
      item.cancellationReasonArabic, item.cancellationReasonEnglish, item.cancellationNotes,
      item.cancelReason, item.cancel_reason,
      item.canceledReason, item.canceled_reason,
      item.cancelledReason, item.cancelled_reason,
      item.cancellationReasonAr, item.cancellation_reason_ar,
      item.cancellationReasonEn, item.cancellation_reason_en,
      item.clientCancelReason, item.client_cancel_reason,
      item.customerCancelReason, item.customer_cancel_reason,
      item.userCancelReason, item.user_cancel_reason,
      item.adminCancelReason, item.admin_cancel_reason,
      item.cancellationNote, item.cancellation_note,
      item.cancelNote, item.cancel_note,
      item.cancellationComment, item.cancellation_comment,
      item.cancelComment, item.cancel_comment,
      nested.cancellationReason, nested.cancellation_reason, nested.cancelReason, nested.cancel_reason
    ];
    for (var i = 0; i < directCandidates.length; i++) {
      var hit = sanitizeReasonText(directCandidates[i]);
      if (hit) return hit;
    }
    var objContainers = [
      item.cancellation, item.cancellationInfo, item.cancellation_info, item.cancellationDetails, item.cancellation_details,
      item.cancelInfo, item.cancel_info, item.cancelDetails, item.cancel_details,
      item.statusDetails, item.status_details, item.statusInfo, item.status_info, item.lastAction, item.last_action,
      item.action, item.audit, nested.cancellation, nested.statusDetails
    ];
    for (var j = 0; j < objContainers.length; j++) {
      var objHit = sanitizeReasonText(objContainers[j]);
      if (objHit) return objHit;
    }
    var historyHit = extractReasonFromHistoryEntries(item, 'cancelled');
    if (historyHit) return historyHit;
    var generalCandidates = [
      item.statusReason, item.status_reason, item.actionReason, item.action_reason,
      item.reasonAr, item.reason_ar, item.reasonEn, item.reason_en, item.reason,
      item.statusNote, item.status_note, item.adminNote, item.admin_note,
      item.clientNote, item.client_note, item.customerNote, item.customer_note,
      item.noteAr, item.noteEn, item.comment, item.notes, item.note,
      nested.reason, nested.statusReason, nested.note
    ];
    for (var g = 0; g < generalCandidates.length; g++) {
      var genHit = sanitizeReasonText(generalCandidates[g]);
      if (genHit) return genHit;
    }
    if (existing && isSameBookingContext(item, existing)) {
      var prev = sanitizeReasonText(existing.cancellationReason);
      if (prev) return prev;
    }
    return '';
  }

  function resolveSourceWorkflowStatus(apiItem) {
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var statusCode = extractReservationStatusCode(item, true);
    if (statusCode) {
      var translated = translateOriginalStatus(statusCode);
      if (translated && translated !== 'غير محدد') return translated;
    }
    var explicitAr = normalizeStr(item.originalStatusAr || item.statusAr || item.status_ar);
    if (explicitAr && explicitAr !== 'غير محدد') return explicitAr;
    return statusCode || 'قيد الانتظار';
  }

  function shouldAutoReconcileSyncedStatus(existing, sourceStatusAr) {
    if (!existing || typeof existing !== 'object') return false;
    var nextSrc = normalizeStr(sourceStatusAr);
    if (!nextSrc || nextSrc === 'غير محدد') return false;
    var prevInternal = normalizeStr(existing.internalStatus);
    if (!prevInternal) return true;
    if (prevInternal === nextSrc) return false;
    var existingLc = getReservationLifecycleKind(existing);
    var nextLc = getReservationLifecycleKind(nextSrc);
    var prevInternalLc = getReservationLifecycleKind(prevInternal);
    if (existingLc !== nextLc) return true;
    if (prevInternalLc !== nextLc && nextLc === 'active') return true;
    if (existingLc !== 'active') return false;

    var history = normalizeStatusHistory(existing.statusHistory);
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
      lastTxt.indexOf('تصحيح تلقائي') === 0 ||
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

  function isValidWorkflowStatus(status) {
    var clean = normalizeStr(status);
    if (!clean) return false;
    return WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1;
  }

  function getWorkflowStatusOptions(currentStatus) {
    var clean = normalizeStr(currentStatus);
    if (!clean || isManualBlockedWorkflowStatus(clean) || MANUAL_WORKFLOW_STATUS_OPTIONS.indexOf(clean) !== -1) {
      return MANUAL_WORKFLOW_STATUS_OPTIONS.slice();
    }
    return [clean].concat(MANUAL_WORKFLOW_STATUS_OPTIONS);
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
      case 'reject_action':
        return 'رفض الحجز';
      case 'cancel_action':
        return 'إلغاء الحجز';
      case 'restore_action':
        return 'استعادة الحجز';
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
    var preset = normalizeStr(opts.preset || opts.datePreset).toLowerCase() || 'all';
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

  function translateExtensionType(type) {
    var key = normalizeStr(type).toLowerCase().replace(/\s+/g, '_');
    return EXTENSION_TYPE_TRANSLATIONS[key] || normalizeStr(type) || 'تمديد';
  }

  function isExtensionAcceptedAndPaid(ext) {
    if (!ext || typeof ext !== 'object') return false;
    if (ext.rejectedByUserId || normalizeStr(ext.rejectionReason)) return false;

    var st = normalizeStr(ext.reservationStatus || ext.status || ext.status_code || ext.state).toLowerCase().replace(/\s+/g, '_');
    if (['cancelled', 'canceled', 'declined', 'rejected', 'hold', 'created', 'draft', 'unpaid', 'waiting_payment', 'awaiting_payment', 'expired', 'pending'].indexOf(st) !== -1) {
      return false;
    }

    var acceptedStatuses = [
      'accepted', 'approved', 'confirmed', 'active', 'completed', 'paid', 'wallet_paid',
      'paid_by_wallet', 'paid_wallet', 'admin_approved', 'extended', 'automatically_extended',
      'started', 'in_progress', 'finished', 'closed', 'ended', 'finished_by_driver', 'مقبول'
    ];
    if (acceptedStatuses.indexOf(st) === -1) return false;

    var explicitPay = normalizeStr(ext.payment_status || ext.paymentStatus || ext.is_paid).toLowerCase();
    if (explicitPay || ext.paid !== undefined) {
      return ['paid', 'completed', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'true', '1', 'مدفوع'].indexOf(explicitPay) !== -1 || ext.paid === true;
    }

    var payResult = normalizeStr(ext.paymentResult).toLowerCase();
    if (payResult && (payResult.indexOf('fail') !== -1 || payResult.indexOf('reject') !== -1 || payResult.indexOf('declin') !== -1 || payResult === 'unpaid')) {
      return false;
    }
    return Boolean(
      ext.paymentDate ||
      ['paid', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'admin_approved', 'extended', 'automatically_extended', 'finished', 'finished_by_driver'].indexOf(st) !== -1 ||
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

  function computeDateDiffDays(startIso, endIso) {
    var d1 = formatDisplayDate(startIso);
    var d2 = formatDisplayDate(endIso);
    if (!d1 || !d2) return 0;
    var t1 = Date.parse(d1 + 'T00:00:00Z');
    var t2 = Date.parse(d2 + 'T00:00:00Z');
    if (isNaN(t1) || isNaN(t2) || t2 <= t1) return 0;
    return Math.round((t2 - t1) / 86400000);
  }

  function summarizeReservationExtensions(extensions, apiItem, fallbackEndDate, fallbackEndTime) {
    var list = Array.isArray(extensions) ? extensions : [];
    var item = (apiItem && typeof apiItem === 'object') ? apiItem : {};
    var normalized = list.filter(function (ex) {
      return ex && typeof ex === 'object';
    }).map(function (ex, idx) {
      var rawStart = ex.extendDate || ex.startDate || ex.start_date || ex.from_date || ex.createdAt || '';
      var startDate = formatDisplayDate(rawStart);
      var startTime = normalizeStr(ex.startTime) || extractTimeOnly(rawStart);
      var days = toNum(ex.extendDays !== undefined ? ex.extendDays : (ex.days !== undefined ? ex.days : ex.extend_days), 0);
      var rawEnd = ex.newEndDate || ex.actualEndDate || ex.endDate || ex.end_date || ex.to_date || '';
      var endDate = formatDisplayDate(rawEnd);
      var endTime = normalizeStr(ex.endTime) || extractTimeOnly(rawEnd) || startTime;
      if (!endDate && startDate && days > 0) {
        endDate = shiftIsoDateDays(startDate, days);
      }
      if (days <= 0 && startDate && endDate) {
        days = computeDateDiffDays(startDate, endDate);
      }
      var amt = Math.round(toNum(ex.amount !== undefined ? ex.amount : (ex.total !== undefined ? ex.total : ex.price), 0) * 100) / 100;
      var subAmt = Math.round(toNum(ex.subTotal !== undefined ? ex.subTotal : ex.subtotal, 0) * 100) / 100;
      var vatAmt = Math.round(toNum(ex.vatAmount !== undefined ? ex.vatAmount : ex.vat, 0) * 100) / 100;
      var extTypeRaw = normalizeStr(ex.extensionType || ex.extension_type || ex.type);
      var stCode = normalizeStr(ex.statusCode || ex.reservationStatus || ex.status || 'paid');
      var payStatus = normalizeStr(ex.paymentStatus || ex.payment_status || ex.paymentResult || (ex.paymentDate ? 'paid' : ''));
      return Object.assign({}, ex, {
        sequenceNumber: idx + 1,
        extensionNumber: normalizeStr(ex.extensionNumber || ex.extendId || ex.id || ex.extension_number || ex.code || ('EXT-' + (idx + 1))),
        extensionType: extTypeRaw,
        extensionTypeAr: normalizeStr(ex.extensionTypeAr) || translateExtensionType(extTypeRaw),
        statusCode: stCode,
        statusAr: normalizeStr(ex.statusAr) || translateOriginalStatus(stCode),
        paymentStatus: payStatus,
        paymentDate: normalizeStr(ex.paymentDate),
        paymentMethod: normalizeStr(ex.paymentMethod || ex.paymentType),
        extendDays: Math.max(0, days),
        startDate: startDate,
        startTime: startTime,
        endDate: endDate,
        endTime: endTime,
        subTotal: subAmt,
        vatAmount: vatAmt,
        amount: amt
      });
    }).sort(function (a, b) {
      var ka = (a.startDate || a.endDate || '') + ' ' + (a.startTime || '');
      var kb = (b.startDate || b.endDate || '') + ' ' + (b.startTime || '');
      if (ka === kb) return String(a.extensionNumber || '').localeCompare(String(b.extensionNumber || ''));
      return ka < kb ? -1 : 1;
    }).map(function (ex, idx) {
      return Object.assign({}, ex, { sequenceNumber: idx + 1 });
    });

    var amountSum = 0;
    var daysSum = 0;
    var lastExt = null;
    for (var i = 0; i < normalized.length; i++) {
      amountSum += toNum(normalized[i].amount, 0);
      daysSum += toNum(normalized[i].extendDays, 0);
      if (normalized[i].endDate && (!lastExt || normalized[i].endDate >= lastExt.endDate)) {
        lastExt = normalized[i];
      }
    }

    if (normalized.length === 0 && (item.extended || toNum(item.extensionsTotal, 0) > 0 || toNum(item.extensionsCount, 0) > 0)) {
      amountSum = toNum(item.extensionsTotal, 0);
      daysSum = toNum(item.extendedDays || item.extensionsDays, 0);
    }

    var count = normalized.length > 0
      ? normalized.length
      : (item.extended ? Math.max(1, toNum(item.extensionsCount, 1)) : 0);

    var apiActualEndRaw = item.actualEndDate || item.extendedUntilDate || '';
    var apiActualEndDate = formatDisplayDate(apiActualEndRaw);
    var apiActualEndTime = extractTimeOnly(apiActualEndRaw);

    var extendedUntilDate = '';
    var extendedUntilTime = '';
    if (lastExt && lastExt.endDate) {
      extendedUntilDate = lastExt.endDate;
      extendedUntilTime = lastExt.endTime || apiActualEndTime || normalizeStr(fallbackEndTime);
    } else if (count > 0) {
      extendedUntilDate = apiActualEndDate || formatDisplayDate(fallbackEndDate);
      extendedUntilTime = apiActualEndTime || normalizeStr(fallbackEndTime);
    }

    if (extendedUntilDate && apiActualEndDate && apiActualEndDate > extendedUntilDate) {
      extendedUntilDate = apiActualEndDate;
      extendedUntilTime = apiActualEndTime || extendedUntilTime;
    }

    return {
      extensions: normalized,
      extensionsCount: count,
      extendedDaysCount: daysSum,
      extensionsAmount: Math.round(amountSum * 100) / 100,
      extendedUntilDate: extendedUntilDate,
      extendedUntilTime: extendedUntilTime
    };
  }

  function mergeSyncedReservation(existing, apiItem, acceptedExtensions, actor) {
    var resApiId = extractSourceReservationId(apiItem);
    var resNumber = extractReservationNumber(apiItem) || resApiId;
    var statusCode = extractReservationStatusCode(apiItem, false);

    var rawStart = apiItem.startDate || apiItem.start_date || apiItem.pickup_date;
    var rawOrigEnd = apiItem.endDate || apiItem.end_date || apiItem.return_date || apiItem.actualEndDate;
    var rawActualEnd = apiItem.actualEndDate || rawOrigEnd;

    var startDate = formatDisplayDate(rawStart);
    var startTime = normalizeStr(apiItem.startTime) || extractTimeOnly(rawStart);
    var originalEndDate = formatDisplayDate(rawOrigEnd);
    var originalEndTime = normalizeStr(apiItem.originalEndTime || apiItem.endTime) || extractTimeOnly(rawOrigEnd);

    var exts = Array.isArray(acceptedExtensions) ? acceptedExtensions : [];
    var extSummary = summarizeReservationExtensions(exts, apiItem, rawActualEnd, extractTimeOnly(rawActualEnd) || originalEndTime);

    var effectiveEndDate = extSummary.extendedUntilDate || formatDisplayDate(rawActualEnd) || originalEndDate;
    var effectiveEndTime = extSummary.extendedUntilTime || extractTimeOnly(rawActualEnd) || originalEndTime;

    var baseDays = toNum(apiItem.reservationDays || apiItem.days_count || apiItem.days, 0);
    if (baseDays <= 0 && startDate && originalEndDate) {
      baseDays = Math.max(1, computeDateDiffDays(startDate, originalEndDate));
    }
    if (baseDays <= 0) baseDays = 1;

    var extendedDaysCount = extSummary.extendedDaysCount;
    if (extendedDaysCount <= 0 && extSummary.extensionsCount > 0 && originalEndDate && effectiveEndDate && effectiveEndDate > originalEndDate) {
      extendedDaysCount = computeDateDiffDays(originalEndDate, effectiveEndDate);
    }
    var totalDaysCount = baseDays + extendedDaysCount;

    var baseAmount = toNum(apiItem.total !== undefined ? apiItem.total : (apiItem.total_price || apiItem.amount || apiItem.base_amount), 0);
    var totalAmount = exts.length > 0
      ? computeTotalAmount(baseAmount, extSummary.extensions)
      : Math.round((baseAmount + extSummary.extensionsAmount) * 100) / 100;
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

      var incomingLifecycle = getReservationLifecycleKind({
        internalStatus: sourceStatusAr,
        originalStatusCode: statusCode,
        originalStatusAr: sourceStatusAr
      });
      var existingLifecycle = getReservationLifecycleKind(existing);
      var sourceChanged = Boolean(
        (statusCode && (
          (prevSourceCode && statusCode !== prevSourceCode) ||
          (!prevSourceCode && prevSourceAr && sourceStatusAr !== prevSourceAr)
        )) ||
        (incomingLifecycle !== existingLifecycle) ||
        (!statusCode && prevSourceAr && sourceStatusAr && sourceStatusAr !== prevSourceAr)
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
      } else if (shouldAutoReconcileSyncedStatus(existing, sourceStatusAr)) {
        nextInternalStatus = sourceStatusAr;
        nextLastUpdateText = 'تم السحب من Rental Gate بالحالة: ' + sourceStatusAr;
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
          note: 'تصحيح تلقائي للحالة وفق موقع Rental Gate: ' + sourceStatusAr
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

    var receiveBranch = normalizeStr(apiItem.receiveBranchArName || apiItem.receiveBranchEnName || apiItem.branch_name || (apiItem.branch && apiItem.branch.name) || '');
    var deliverBranch = normalizeStr(apiItem.deliverBranchArName || apiItem.deliverBranchEnName || apiItem.returnBranchName || receiveBranch);
    var sourceCreatedRaw = apiItem.reservationDate || apiItem.createdAt || apiItem.created_at || '';
    var rawSeq = apiItem.sourceOrder !== undefined ? apiItem.sourceOrder : (apiItem.__sourceOrder !== undefined ? apiItem.__sourceOrder : apiItem.source_order);
    var parsedSeq = (rawSeq !== undefined && rawSeq !== null && rawSeq !== '') ? Number(rawSeq) : NaN;
    var existingSeq = (existing && existing.sourceOrder !== undefined && existing.sourceOrder !== null && existing.sourceOrder !== '') ? Number(existing.sourceOrder) : NaN;
    var resolvedSourceOrder = (isFinite(parsedSeq) && parsedSeq > 0)
      ? Math.floor(parsedSeq)
      : ((isFinite(existingSeq) && existingSeq > 0) ? Math.floor(existingSeq) : null);

    var resolvedCompanyNumber = normalizeStr((existing && existing.companyNumber) || apiItem.companyNumber || apiItem.company_number || apiItem.companyCode || apiItem.companyId || '');
    var rawLifecycleProbe = {
      originalStatusCode: statusCode,
      originalStatusAr: sourceStatusAr,
      internalStatus: nextInternalStatus
    };
    var hasExplicitExternalActive = isExplicitActiveStatusToken(statusCode) || isExplicitActiveStatusToken(sourceStatusAr);
    var resolvedIsSourceCancelled = hasExplicitExternalActive
      ? false
      : (typeof apiItem.isSourceCancelled === 'boolean'
          ? apiItem.isSourceCancelled
          : (classifyReservationLifecycle(rawLifecycleProbe) === 'cancelled'
              ? true
              : (existing && !sourceChanged && typeof existing.isSourceCancelled === 'boolean' ? existing.isSourceCancelled : null)));
    var resolvedIsSourceRejected = (hasExplicitExternalActive || resolvedIsSourceCancelled === true)
      ? false
      : (typeof apiItem.isSourceRejected === 'boolean'
          ? apiItem.isSourceRejected
          : (classifyReservationLifecycle(rawLifecycleProbe) === 'rejected'
              ? true
              : (existing && !sourceChanged && typeof existing.isSourceRejected === 'boolean' ? existing.isSourceRejected : null)));
    var finalLifecycle = classifyReservationLifecycle({
      originalStatusCode: statusCode,
      originalStatusAr: sourceStatusAr,
      internalStatus: nextInternalStatus,
      isSourceRejected: resolvedIsSourceRejected,
      isSourceCancelled: resolvedIsSourceCancelled
    });
    if (finalLifecycle === 'active') {
      resolvedIsSourceRejected = false;
      resolvedIsSourceCancelled = false;
    } else if (finalLifecycle === 'cancelled') {
      resolvedIsSourceCancelled = true;
      resolvedIsSourceRejected = false;
    } else if (finalLifecycle === 'rejected') {
      resolvedIsSourceRejected = true;
      resolvedIsSourceCancelled = false;
    }
    var incomingRejected = finalLifecycle === 'rejected';
    var incomingCancelled = finalLifecycle === 'cancelled';

    var newCompanyRaw = apiItem.newCompanyName || apiItem.new_company_name || apiItem.targetCompanyName || apiItem.target_company_name || apiItem.transferCompanyName || apiItem.transfer_company_name || apiItem.alternativeCompanyName || apiItem.alternative_company_name || (apiItem.newCompany && (apiItem.newCompany.arName || apiItem.newCompany.enName || apiItem.newCompany.name)) || (apiItem.transferCompany && (apiItem.transferCompany.arName || apiItem.transferCompany.enName || apiItem.transferCompany.name));
    var resolvedNewCompanyName = incomingRejected
      ? (sanitizeReasonText(newCompanyRaw) || (existing && isSameBookingContext(apiItem, existing) ? sanitizeReasonText(existing.newCompanyName) : '') || '')
      : '';
    var resolvedRejectionReason = incomingRejected
      ? extractRejectionReason(apiItem, existing)
      : '';
    var resolvedCarStatusAtRequest = incomingRejected
      ? (sanitizeReasonText(apiItem.carStatusAtRequest || apiItem.car_status_at_request || apiItem.reservationStatusAtRequest) || (existing && isSameBookingContext(apiItem, existing) ? sanitizeReasonText(existing.carStatusAtRequest) : '') || '')
      : '';
    var incomingRefundNum = apiItem.refundAmount !== undefined ? apiItem.refundAmount : (apiItem.refund_amount !== undefined ? apiItem.refund_amount : (apiItem.clientRefundAmount !== undefined ? apiItem.clientRefundAmount : undefined));
    var resolvedRefundAmount = (incomingRejected || incomingCancelled)
      ? ((incomingRefundNum !== undefined && incomingRefundNum !== null && incomingRefundNum !== '' && toNum(incomingRefundNum, 0) > 0)
        ? toNum(incomingRefundNum, 0)
        : ((existing && isSameBookingContext(apiItem, existing) && existing.refundAmount !== undefined && existing.refundAmount !== null && existing.refundAmount !== '')
          ? toNum(existing.refundAmount, 0)
          : toNum(incomingRefundNum, 0)))
      : 0;
    var resolvedRejectedById = incomingRejected
      ? normalizeStr(apiItem.rejectedById || apiItem.rejected_by_id || apiItem.confirmedById || apiItem.confirmed_by_id || apiItem.confirmedByUserId || apiItem.rejectedByUserId || apiItem.actionById || apiItem.action_by_id || (existing && existing.rejectedById) || actorId)
      : '';
    var resolvedRejectedByName = incomingRejected
      ? normalizeStr(apiItem.rejectedByName || apiItem.rejected_by_name || apiItem.rejectedBy || apiItem.confirmedByName || apiItem.confirmed_by_name || apiItem.confirmedByUserName || apiItem.rejectedByUserName || apiItem.confirmedBy || apiItem.actionByName || apiItem.action_by_name || apiItem.actionBy || apiItem.adminName || (existing && existing.rejectedByName) || actorName)
      : '';
    var resolvedRejectedAt = incomingRejected
      ? normalizeStr(apiItem.rejectedAt || apiItem.rejected_at || apiItem.confirmedAt || apiItem.actionAt || (existing && existing.rejectedAt) || now)
      : '';

    var resolvedCancellationReason = incomingCancelled
      ? extractCancellationReason(apiItem, existing)
      : '';
    var resolvedCancelledById = incomingCancelled
      ? normalizeStr(apiItem.cancelledById || apiItem.cancelled_by_id || apiItem.canceled_by_id || apiItem.actionById || apiItem.action_by_id || (existing && existing.cancelledById) || actorId)
      : '';
    var resolvedCancelledByName = incomingCancelled
      ? normalizeStr(apiItem.cancelledByName || apiItem.cancelled_by_name || apiItem.canceledByName || apiItem.canceled_by_name || apiItem.cancelledBy || apiItem.actionByName || apiItem.action_by_name || apiItem.actionBy || (existing && existing.cancelledByName) || actorName)
      : '';
    var resolvedCancelledAt = incomingCancelled
      ? normalizeStr(apiItem.cancelledAt || apiItem.cancelled_at || apiItem.canceledAt || apiItem.canceled_at || apiItem.actionAt || (existing && existing.cancelledAt) || now)
      : '';

    var resolvedReferenceNumber = (incomingRejected || incomingCancelled)
      ? extractExplicitReferenceNumber(apiItem, existing, [resNumber, resApiId])
      : normalizeStr(
          apiItem.referenceNumber ||
          apiItem.reference_number ||
          apiItem.refNumber ||
          apiItem.ref_number ||
          apiItem.sourceReference ||
          apiItem.externalReference ||
          apiItem.orderRef ||
          apiItem.reference ||
          (existing && existing.referenceNumber) ||
          resApiId ||
          ''
        );

    var rawPaidCandidate = apiItem.paidAmount !== undefined
      ? apiItem.paidAmount
      : (apiItem.paid_amount !== undefined
        ? apiItem.paid_amount
        : (apiItem.amountPaid !== undefined ? apiItem.amountPaid : apiItem.amount_paid));
    var resolvedPaymentStatus = normalizeStr(apiItem.paymentStatus || apiItem.paymentResult || (existing && existing.paymentStatus) || '');
    var paymentStatusLower = resolvedPaymentStatus.toLowerCase();
    var resolvedPaidAmount = (rawPaidCandidate !== undefined && rawPaidCandidate !== null && rawPaidCandidate !== '')
      ? Math.max(0, Math.round(toNum(rawPaidCandidate, 0) * 100) / 100)
      : ((existing && toNum(existing.paidAmount, 0) > 0)
        ? Math.round(toNum(existing.paidAmount, 0) * 100) / 100
        : (['paid', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'refunded', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مسترد'].indexOf(paymentStatusLower) !== -1
          ? totalAmount
          : 0));

    var resolvedDeliveryFailureReason =
      sanitizeReasonText(
        apiItem.deliveryFailureReason ||
        apiItem.delivery_failure_reason ||
        apiItem.failedDeliveryReason ||
        apiItem.failed_delivery_reason ||
        apiItem.deliverFailReason ||
        apiItem.failReason
      ) ||
      (existing && isSameBookingContext(apiItem, existing) ? sanitizeReasonText(existing.deliveryFailureReason) : '') ||
      '';
    var resolvedDriverNotes =
      sanitizeReasonText(
        apiItem.driverNotes ||
        apiItem.driver_notes ||
        apiItem.driverNote ||
        apiItem.driver_note ||
        apiItem.deliveryNotes ||
        apiItem.delivery_notes ||
        apiItem.driverComment
      ) ||
      (existing && isSameBookingContext(apiItem, existing) ? sanitizeReasonText(existing.driverNotes) : '') ||
      '';

    var safeResIdToken = (resNumber || resApiId).replace(/[^A-Za-z0-9_-]/g, '') || resApiId.replace(/[^A-Za-z0-9_-]/g, '') || 'ROW';

    return {
      id: existing ? existing.id : ('RES_' + safeResIdToken),
      sourceReservationId: resApiId || resNumber,
      reservationNumber: resNumber,
      referenceNumber: resolvedReferenceNumber,
      sourceOrder: resolvedSourceOrder,
      sourceCreatedAt: formatDisplayDateTime(sourceCreatedRaw) || normalizeStr(sourceCreatedRaw),
      customerName: normalizeStr(apiItem.clientName || apiItem.customer_name || (apiItem.customer && apiItem.customer.name) || 'عميل'),
      customerPhone: normalizeStr(apiItem.clientMobile || apiItem.customer_phone || (apiItem.customer && (apiItem.customer.phone || apiItem.customer.mobile)) || ''),
      customerEmail: normalizeStr(apiItem.clientEmail || apiItem.customer_email || (apiItem.customer && apiItem.customer.email) || (existing && existing.customerEmail) || ''),
      customerIdNumber: extractCustomerNationalId(apiItem, existing),
      companyName: normalizeStr(apiItem.companyArName || apiItem.companyEnName || apiItem.company_name || (apiItem.company && apiItem.company.name) || ''),
      companyNumber: resolvedCompanyNumber,
      newCompanyName: resolvedNewCompanyName,
      branchName: receiveBranch,
      deliverBranchName: deliverBranch,
      carName: normalizeStr(apiItem.carNameAr || apiItem.carNameEn || apiItem.car_name || (apiItem.car && apiItem.car.name) || ''),
      plateNumber: normalizeStr(apiItem.plate_number || apiItem.plateNumber || (apiItem.car && apiItem.car.plate_number) || ''),
      carCategory: normalizeStr(apiItem.carCategoryAr || apiItem.carTypeAr || apiItem.carCategory || (apiItem.car && apiItem.car.category) || ''),
      startDate: startDate,
      startTime: startTime,
      originalEndDate: originalEndDate,
      originalEndTime: originalEndTime,
      endDate: effectiveEndDate,
      endTime: effectiveEndTime,
      extendedUntilDate: extSummary.extendedUntilDate,
      extendedUntilTime: extSummary.extendedUntilTime,
      daysCount: baseDays,
      extendedDaysCount: extendedDaysCount,
      totalDaysCount: totalDaysCount,
      originalStatusCode: statusCode,
      originalStatusAr: sourceStatusAr,
      pickupTypeAr: translateDeliveryType(apiItem.receiveType || apiItem.pickup_type || apiItem.delivery_type),
      returnTypeAr: translateDeliveryType(apiItem.deliverType || apiItem.return_type || apiItem.dropoff_type),
      paymentMethod: normalizeStr(apiItem.paymentType || apiItem.paymentMethod || ''),
      paymentStatus: resolvedPaymentStatus,
      dailyPrice: toNum(apiItem.dailyPrice || apiItem.dayPrice || apiItem.pricePerDay, 0),
      discountAmount: toNum(apiItem.discount || apiItem.discountAmount, 0),
      vatAmount: toNum(apiItem.vat || apiItem.vatAmount || apiItem.tax, 0),
      baseAmount: Math.round(baseAmount * 100) / 100,
      paidAmount: resolvedPaidAmount,
      extensionsCount: extSummary.extensionsCount,
      extensionsAmount: extSummary.extensionsAmount,
      totalAmount: totalAmount,
      hasExtensions: extSummary.extensionsCount > 0 || Boolean(apiItem.extended),
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
      rejectionReason: resolvedRejectionReason,
      carStatusAtRequest: resolvedCarStatusAtRequest,
      refundAmount: resolvedRefundAmount,
      rejectedById: resolvedRejectedById,
      rejectedByName: resolvedRejectedByName,
      rejectedAt: resolvedRejectedAt,
      cancellationReason: resolvedCancellationReason,
      cancelledById: resolvedCancelledById,
      cancelledByName: resolvedCancelledByName,
      cancelledAt: resolvedCancelledAt,
      deliveryFailureReason: resolvedDeliveryFailureReason,
      driverNotes: resolvedDriverNotes,
      isSourceCancelled: resolvedIsSourceCancelled,
      isSourceRejected: resolvedIsSourceRejected,
      rccStatus: normalizeStr(apiItem.rccStatus || (existing && existing.rccStatus) || ''),
      rccReason: normalizeStr(apiItem.rccReason || (existing && existing.rccReason) || ''),
      cancelledFromDecline: Boolean(apiItem.cancelledFromDecline !== undefined ? apiItem.cancelledFromDecline : (existing && existing.cancelledFromDecline)),
      cancelledFromHold: Boolean(apiItem.cancelledFromHold !== undefined ? apiItem.cancelledFromHold : (existing && existing.cancelledFromHold)),
      penaltyAmount: toNum(apiItem.penaltyAmount !== undefined ? apiItem.penaltyAmount : (existing && existing.penaltyAmount), 0),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function prevStatusHistoryMissing(arr) {
    return !Array.isArray(arr) || arr.length === 0;
  }

  var CUSTOMER_STATUS_LIST = [
    'جديد',
    'نشط',
    'متكرر',
    'بحاجة لمتابعة',
    'لديه مشكلة',
    'غير نشط',
    'محظور'
  ];

  var CUSTOMER_RESERVATION_STATUS_OPTIONS = [
    { value: 'نشط الآن', labelAr: 'نشط الآن', labelEn: 'Active Now', color: '#10b981' },
    { value: 'جاهز للاستلام', labelAr: 'جاهز للاستلام', labelEn: 'Ready for Pickup', color: '#3b82f6' },
    { value: 'بانتظار المتابعة', labelAr: 'بانتظار المتابعة', labelEn: 'Awaiting Follow-Up', color: '#f59e0b' },
    { value: 'جديد / بانتظار المراجعة', labelAr: 'جديد / بانتظار المراجعة', labelEn: 'New / Pending Review', color: '#8b5cf6' },
    { value: 'متأخر في السداد', labelAr: 'متأخر في السداد', labelEn: 'Overdue / Unpaid', color: '#f97316' },
    { value: 'منتهي', labelAr: 'منتهي / مكتمل', labelEn: 'Completed / Ended', color: '#64748b' },
    { value: 'ملغي', labelAr: 'ملغي', labelEn: 'Cancelled', color: '#ef4444' },
    { value: 'مرفوض', labelAr: 'مرفوض', labelEn: 'Rejected', color: '#dc2626' }
  ];

  function classifyReservationStatusBucket(resObj) {
    var r = (resObj && typeof resObj === 'object') ? resObj : {};
    if (isRejectedStatus(r)) return 'مرفوض';
    if (isCancelledStatus(r)) return 'ملغي';
    var lc = classifyReservationLifecycle(r);
    var st = normalizeStr(r.internalStatus || r.originalStatusAr || r.originalStatusCode);
    var stLow = st.toLowerCase();
    if (lc === 'completed' || isReservationClosedStatus(r) || /(completed|finished|finished_by_driver|ended|closed|returned|منتهي|مكتمل|مغلق)/i.test(stLow)) {
      return 'منتهي';
    }
    if (/متأخر|overdue|unpaid/i.test(stLow)) return 'متأخر في السداد';
    if (/جاهز للاستلام|ready_for_pickup|ready/i.test(stLow)) return 'جاهز للاستلام';
    if (/بانتظار المتابعة|awaiting_followup|need_followup|متابعة/i.test(stLow)) return 'بانتظار المتابعة';
    if (/جديد|قيد الانتظار|pending|created|waiting_review|waiting/i.test(stLow)) return 'جديد / بانتظار المراجعة';
    if (lc === 'active' || isExplicitActiveStatusToken(stLow) || /نشط|started|active|approved|confirmed|in_progress|extended/i.test(stLow)) {
      return 'نشط الآن';
    }
    return st || 'نشط الآن';
  }

  function doesReservationMatchStatusFilter(resObj, filterStatus) {
    var target = normalizeStr(filterStatus);
    if (!target) return true;
    var bucket = classifyReservationStatusBucket(resObj);
    if (bucket === target) return true;
    var r = (resObj && typeof resObj === 'object') ? resObj : {};
    var intSt = normalizeStr(r.internalStatus);
    var origAr = normalizeStr(r.originalStatusAr);
    var origCode = normalizeStr(r.originalStatusCode);
    if (intSt === target || origAr === target || origCode === target) return true;
    if (target === 'نشط' || target === 'نشط الآن') {
      return bucket === 'نشط الآن' || (!isInactiveReservation(r) && !isReservationClosedStatus(r));
    }
    if (target === 'مكتمل' || target === 'منتهي') {
      return bucket === 'منتهي';
    }
    return false;
  }

  var KNOWN_COUNTRY_DIAL_CODES = [
    '966', '971', '965', '973', '974', '968', '962', '961', '963', '964', '967',
    '970', '212', '213', '216', '218', '249', '90', '20', '44', '33', '49', '39', '34', '91', '92', '63', '62', '60', '1'
  ];

  function extractPhoneCountryCode(rawPhone) {
    var raw = convertEasternDigitsToAscii(normalizeStr(rawPhone));
    if (!raw) {
      return { rawPhone: '', countryCode: '+966', localPhone: '', normalizedPhone: '', displayPhone: '' };
    }
    var trimmed = raw.trim();
    var hasPlus = trimmed.charAt(0) === '+';
    var digits = trimmed.replace(/\D+/g, '');
    if (!digits) {
      return { rawPhone: raw, countryCode: '+966', localPhone: '', normalizedPhone: '', displayPhone: raw };
    }
    var hadIntlZero = !hasPlus && digits.indexOf('00') === 0 && digits.length > 5;
    if (hadIntlZero) {
      digits = digits.slice(2);
    }
    var countryCode = '+966';
    var localPhone = digits;
    var normalizedPhone = digits;

    if (hasPlus || hadIntlZero || digits.length >= 11) {
      var matchedPrefix = '';
      for (var i = 0; i < KNOWN_COUNTRY_DIAL_CODES.length; i++) {
        var code = KNOWN_COUNTRY_DIAL_CODES[i];
        if (digits.indexOf(code) === 0 && digits.length > code.length + 5) {
          matchedPrefix = code;
          break;
        }
      }
      if (!matchedPrefix && (hasPlus || hadIntlZero) && digits.length >= 9) {
        matchedPrefix = digits.slice(0, digits.length > 12 ? 3 : 2);
      }
      if (matchedPrefix) {
        countryCode = '+' + matchedPrefix;
        localPhone = digits.slice(matchedPrefix.length).replace(/^0+/, '') || digits.slice(matchedPrefix.length);
        normalizedPhone = matchedPrefix + localPhone;
      }
    }
    if (countryCode === '+966') {
      if (digits.indexOf('966') === 0 && digits.length >= 12) {
        localPhone = digits.slice(3).replace(/^0+/, '');
        normalizedPhone = '966' + localPhone;
      } else if (digits.length === 10 && digits.charAt(0) === '0') {
        localPhone = digits.slice(1);
        normalizedPhone = '966' + localPhone;
      } else if (digits.length === 9 && digits.charAt(0) === '5') {
        localPhone = digits;
        normalizedPhone = '966' + digits;
      }
    }

    return {
      rawPhone: raw,
      countryCode: countryCode,
      localPhone: localPhone,
      normalizedPhone: normalizedPhone,
      displayPhone: (countryCode === '+966' && localPhone.length === 9 && localPhone.charAt(0) === '5')
        ? ('0' + localPhone)
        : (digits ? ('+' + normalizedPhone) : raw)
    };
  }

  function detectCustomerIdType(rawId) {
    var clean = normalizeNationalId(rawId);
    if (!clean) return '';
    if (/^1\d{9}$/.test(clean)) return 'هوية وطنية';
    if (/^2\d{9}$/.test(clean)) return 'إقامة';
    if (clean.length >= 5) return 'جواز سفر';
    return 'هوية';
  }

  function buildCustomerCanonicalKey(phone, idNumber, fullName) {
    var rawPhone = phone;
    var rawId = idNumber;
    var rawName = fullName;
    var rawEmail = '';
    var rawResNum = '';
    if (phone && typeof phone === 'object') {
      rawPhone = phone.phone || phone.customerPhone || '';
      rawId = phone.idNumber || phone.customerIdNumber || '';
      rawName = phone.fullName || phone.name || phone.customerName || '';
      rawEmail = phone.email || phone.customerEmail || '';
      rawResNum = phone.reservationNumber || '';
    }
    var pInfo = extractPhoneCountryCode(rawPhone);
    if (pInfo.normalizedPhone && pInfo.normalizedPhone.length >= 7) {
      return 'PH_' + pInfo.normalizedPhone;
    }
    var rawCleanPhone = convertEasternDigitsToAscii(normalizeStr(rawPhone)).replace(/[\s\-()]/g, '');
    if (rawCleanPhone && rawCleanPhone.length >= 5) {
      return 'PH_' + rawCleanPhone;
    }
    var normId = normalizeNationalId(rawId);
    if (normId && normId.length >= 4) {
      return 'ID_' + normId;
    }
    var cleanEmail = normalizeStr(rawEmail).toLowerCase();
    if (cleanEmail && cleanEmail.indexOf('@') !== -1) {
      return 'EM_' + cleanEmail;
    }
    var cleanName = normalizeSearchText(rawName).replace(/\s+/g, ' ').trim();
    if (cleanName) {
      return 'NM_' + cleanName.toLowerCase();
    }
    var cleanRes = normalizeStr(rawResNum);
    if (cleanRes) {
      return 'RS_' + cleanRes;
    }
    return '';
  }

  function computeCustomerLifecycleStatus(stats) {
    var s = stats && typeof stats === 'object' ? stats : {};
    if (s.statusOverride && CUSTOMER_STATUS_LIST.indexOf(s.manualStatus) !== -1) {
      return s.manualStatus;
    }
    if (toNum(s.openProblemsCount, 0) > 0 || toNum(s.inProgressComplaintsCount, 0) > 0) {
      return 'لديه مشكلة';
    }
    if (toNum(s.activeBookingsCount, 0) > 0 && toNum(s.unfollowedActiveCount, 0) > 0) {
      return 'بحاجة لمتابعة';
    }
    if (toNum(s.activeBookingsCount, 0) > 0) {
      return 'نشط';
    }
    if (toNum(s.totalBookings, 0) > 1) {
      return 'متكرر';
    }
    if (toNum(s.isNewRecent, 0) > 0 || (toNum(s.totalBookings, 0) === 1 && toNum(s.pastBookingsCount, 0) === 0)) {
      return 'جديد';
    }
    return toNum(s.totalBookings, 0) === 0 ? 'جديد' : 'غير نشط';
  }

  function redactCustomerSensitiveFields(custObj, roleOrUser) {
    if (!custObj || typeof custObj !== 'object') return custObj;
    if (canUserViewCustomerId(roleOrUser)) return custObj;
    return Object.assign({}, custObj, {
      idNumber: '',
      customerIdNumber: '',
      idType: ''
    });
  }

  function buildCustomersAggregateFromData(input) {
    var opts = input && typeof input === 'object' ? input : {};
    var storedCustomers = Array.isArray(opts.customers) ? opts.customers : [];
    var reservations = Array.isArray(opts.reservations) ? opts.reservations : [];
    var extensions = Array.isArray(opts.extensions) ? opts.extensions : [];
    var followUps = Array.isArray(opts.followUps) ? opts.followUps : [];
    var problems = Array.isArray(opts.problems) ? opts.problems : [];
    var customerNotes = Array.isArray(opts.customerNotes) ? opts.customerNotes : [];
    var nowMs = isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    var recentCutoffMs = nowMs - (7 * 24 * 60 * 60 * 1000);

    var byKey = {};
    var byId = {};
    var order = [];

    function ensureBucket(key, seed) {
      if (!key) return null;
      if (!byKey[key]) {
        var sd = seed || {};
        var phoneInfo = extractPhoneCountryCode(sd.phone || sd.customerPhone || '');
        var idNum = normalizeStr(sd.idNumber || sd.customerIdNumber || '');
        var bucket = {
          id: normalizeStr(sd.id) || ('CUST_' + key),
          customerKey: key,
          fullName: normalizeStr(sd.fullName || sd.customerName) || 'عميل',
          customerName: normalizeStr(sd.fullName || sd.customerName) || 'عميل',
          phone: normalizeStr(sd.phone || sd.customerPhone || phoneInfo.displayPhone),
          customerPhone: normalizeStr(sd.phone || sd.customerPhone || phoneInfo.displayPhone),
          countryCode: normalizeStr(sd.countryCode) || phoneInfo.countryCode || '+966',
          normalizedPhone: normalizeStr(sd.normalizedPhone) || phoneInfo.normalizedPhone,
          email: normalizeStr(sd.email || sd.customerEmail),
          customerEmail: normalizeStr(sd.email || sd.customerEmail),
          idNumber: idNum,
          customerIdNumber: idNum,
          idType: normalizeStr(sd.idType) || detectCustomerIdType(idNum),
          manualStatus: normalizeStr(sd.status || 'جديد') || 'جديد',
          statusOverride: Boolean(sd.statusOverride),
          notes: normalizeStr(sd.notes),
          tags: Array.isArray(sd.tags) ? sd.tags.slice() : [],
          source: normalizeStr(sd.source) || 'sync',
          lastContactAt: normalizeStr(sd.lastContactAt),
          createdAt: normalizeStr(sd.createdAt) || new Date(nowMs).toISOString(),
          updatedAt: normalizeStr(sd.updatedAt) || new Date(nowMs).toISOString(),
          totalBookings: 0,
          activeBookingsCount: 0,
          pastBookingsCount: 0,
          extensionsCount: 0,
          extensionsDays: 0,
          openProblemsCount: 0,
          inProgressComplaintsCount: 0,
          totalProblemsCount: 0,
          followUpsCount: 0,
          notesCount: 0,
          unfollowedActiveCount: 0,
          totalSpent: 0,
          paidAmount: 0,
          lastBookingDate: '',
          lastBookingNumber: '',
          latestReservationId: '',
          lastReservationStatus: normalizeStr(sd.lastReservationStatus),
          _lastBookingIso: '',
          lastActivityAt: normalizeStr(sd.updatedAt || sd.createdAt),
          companies: [],
          reservationIds: []
        };
        byKey[key] = bucket;
        byId[bucket.id] = bucket;
        order.push(key);
      }
      return byKey[key];
    }

    for (var ci = 0; ci < storedCustomers.length; ci++) {
      var sc = storedCustomers[ci];
      if (!sc || typeof sc !== 'object') continue;
      var scKey = normalizeStr(sc.customerKey) || buildCustomerCanonicalKey(sc.phone, sc.idNumber, sc.fullName);
      var b0 = ensureBucket(scKey, sc);
      if (b0 && sc.id) byId[sc.id] = b0;
    }

    var fuByResId = {};
    var fuLatestByResId = {};
    for (var fi = 0; fi < followUps.length; fi++) {
      var fu = followUps[fi];
      if (!fu || !fu.reservationId) continue;
      fuByResId[fu.reservationId] = (fuByResId[fu.reservationId] || 0) + 1;
      var fStamp = normalizeStr(fu.createdAt || (fu.followUpDate ? (fu.followUpDate + 'T' + (fu.followUpTime || '00:00:00')) : ''));
      if (!fuLatestByResId[fu.reservationId] || fStamp > fuLatestByResId[fu.reservationId]) {
        fuLatestByResId[fu.reservationId] = fStamp;
      }
    }

    var extCountByResId = {};
    var extDaysByResId = {};
    for (var ei = 0; ei < extensions.length; ei++) {
      var ex = extensions[ei];
      if (!ex) continue;
      var exKey = normalizeStr(ex.reservationId || ex.reservationNumber);
      if (!exKey) continue;
      extCountByResId[exKey] = (extCountByResId[exKey] || 0) + 1;
      extDaysByResId[exKey] = (extDaysByResId[exKey] || 0) + toNum(ex.extendDays, 0);
    }

    var resIdToCust = {};
    var resNumToCust = {};

    for (var ri = 0; ri < reservations.length; ri++) {
      var r = reservations[ri];
      if (!r || typeof r !== 'object') continue;
      var cBucket = (r.customerId && byId[r.customerId]) ? byId[r.customerId] : null;
      if (!cBucket) {
        var cKey = buildCustomerCanonicalKey(r.customerPhone, r.customerIdNumber, r.customerName);
        cBucket = ensureBucket(cKey, {
          fullName: r.customerName,
          phone: r.customerPhone,
          email: r.customerEmail,
          idNumber: r.customerIdNumber,
          createdAt: r.sourceCreatedAt || r.createdAt,
          updatedAt: r.lastUpdatedAt || r.updatedAt || r.createdAt
        });
      }
      if (!cBucket) continue;
      if (r.id) resIdToCust[r.id] = cBucket;
      if (r.reservationNumber) resNumToCust[r.reservationNumber] = cBucket;

      if (r.customerName && (cBucket.fullName === 'عميل' || !cBucket.fullName)) {
        cBucket.fullName = normalizeStr(r.customerName);
        cBucket.customerName = cBucket.fullName;
      }
      if (r.customerPhone && !cBucket.phone) {
        var pi2 = extractPhoneCountryCode(r.customerPhone);
        cBucket.phone = normalizeStr(r.customerPhone);
        cBucket.customerPhone = cBucket.phone;
        cBucket.countryCode = pi2.countryCode;
        cBucket.normalizedPhone = pi2.normalizedPhone;
      }
      if (r.customerEmail && !cBucket.email) {
        cBucket.email = normalizeStr(r.customerEmail);
        cBucket.customerEmail = cBucket.email;
      }
      if (r.customerIdNumber && !cBucket.idNumber) {
        cBucket.idNumber = normalizeStr(r.customerIdNumber);
        cBucket.customerIdNumber = cBucket.idNumber;
        cBucket.idType = detectCustomerIdType(cBucket.idNumber);
      }

      cBucket.totalBookings += 1;
      if (r.id && cBucket.reservationIds.indexOf(r.id) === -1) cBucket.reservationIds.push(r.id);
      if (r.companyName && cBucket.companies.indexOf(r.companyName) === -1) cBucket.companies.push(r.companyName);
      cBucket.totalSpent = Math.round((cBucket.totalSpent + toNum(r.totalAmount, 0)) * 100) / 100;
      cBucket.paidAmount = Math.round((cBucket.paidAmount + toNum(r.paidAmount, 0)) * 100) / 100;

      var isClosedOrInactive = isReservationClosedStatus(r) || isInactiveReservation(r);
      if (isClosedOrInactive) {
        cBucket.pastBookingsCount += 1;
      } else {
        cBucket.activeBookingsCount += 1;
      }

      var rExtCnt = Math.max(toNum(r.extensionsCount, 0), toNum(extCountByResId[r.id] || extCountByResId[r.reservationNumber], 0));
      var rExtDays = Math.max(toNum(r.extendedDaysCount, 0), toNum(extDaysByResId[r.id] || extDaysByResId[r.reservationNumber], 0));
      cBucket.extensionsCount += rExtCnt;
      cBucket.extensionsDays += rExtDays;

      var rFuCount = toNum(fuByResId[r.id], 0) + (r.isFollowed && !fuByResId[r.id] ? 1 : 0);
      cBucket.followUpsCount += rFuCount;
      if (!isClosedOrInactive && rFuCount === 0) {
        cBucket.unfollowedActiveCount += 1;
      }
      var rFuStamp = fuLatestByResId[r.id] || '';
      if (rFuStamp && (!cBucket.lastContactAt || rFuStamp > cBucket.lastContactAt)) {
        cBucket.lastContactAt = rFuStamp;
      }

      var bookDate = normalizeStr(r.startDate || r.sourceCreatedAt || r.createdAt);
      if (bookDate && (!cBucket._lastBookingIso || bookDate > cBucket._lastBookingIso)) {
        cBucket._lastBookingIso = bookDate;
        cBucket.lastBookingDate = formatDisplayDate(bookDate) || bookDate.slice(0, 10);
        cBucket.lastBookingNumber = normalizeStr(r.reservationNumber);
        cBucket.latestReservationId = normalizeStr(r.id);
        cBucket.lastReservationStatus = normalizeStr(r.internalStatus || r.originalStatusAr);
      }

      var rStamp = normalizeStr(r.lastUpdatedAt || r.updatedAt || r.createdAt || r.startDate);
      if (rStamp && (!cBucket.lastActivityAt || rStamp > cBucket.lastActivityAt)) {
        cBucket.lastActivityAt = rStamp;
      }
      var rCreated = normalizeStr(r.createdAt || r.sourceCreatedAt);
      if (rCreated && (!cBucket.createdAt || rCreated < cBucket.createdAt)) {
        cBucket.createdAt = rCreated;
      }
    }

    for (var pi = 0; pi < problems.length; pi++) {
      var pr = problems[pi];
      if (!pr || typeof pr !== 'object') continue;
      var pCust = (pr.customerId && byId[pr.customerId]) ||
        (pr.reservationId && resIdToCust[pr.reservationId]) ||
        (pr.reservationNumber && resNumToCust[pr.reservationNumber]) ||
        null;
      if (!pCust && pr.customerName) {
        var nmKey = buildCustomerCanonicalKey('', '', pr.customerName);
        if (nmKey && byKey[nmKey]) pCust = byKey[nmKey];
      }
      if (!pCust) continue;
      pCust.totalProblemsCount += 1;
      var isOpenPr = !isProblemClosedStatus(pr.status);
      if (isOpenPr) {
        pCust.openProblemsCount += 1;
        if (normalizeStr(pr.status) === 'قيد المعالجة' || normalizeStr(pr.ticketType) === 'شكوى') {
          pCust.inProgressComplaintsCount += 1;
        }
      }
      var pStamp = normalizeStr(pr.updatedAt || pr.createdAt);
      if (pStamp && (!pCust.lastActivityAt || pStamp > pCust.lastActivityAt)) {
        pCust.lastActivityAt = pStamp;
      }
    }

    for (var ni = 0; ni < customerNotes.length; ni++) {
      var nt = customerNotes[ni];
      if (!nt || typeof nt !== 'object' || nt.deletedAt) continue;
      var nCust = (nt.customerId && byId[nt.customerId]) || null;
      if (!nCust) continue;
      nCust.notesCount += 1;
      var nStamp = normalizeStr(nt.createdAt || nt.updatedAt);
      if (nStamp && (!nCust.lastContactAt || nStamp > nCust.lastContactAt)) {
        nCust.lastContactAt = nStamp;
      }
      if (nStamp && (!nCust.lastActivityAt || nStamp > nCust.lastActivityAt)) {
        nCust.lastActivityAt = nStamp;
      }
    }

    var kpis = {
      totalCustomers: 0,
      newCustomers: 0,
      activeBookingCustomers: 0,
      pastBookingCustomers: 0,
      openProblemCustomers: 0,
      inProgressComplaintCustomers: 0,
      extensionCustomers: 0,
      unfollowedCustomers: 0,
      repeatCustomers: 0,
      recentUpdatedCustomers: 0
    };

    var rows = order.map(function (k) {
      var c = byKey[k];
      var createdMs = Date.parse(c.createdAt || '');
      var updatedMs = Date.parse(c.lastActivityAt || c.updatedAt || '');
      var isNewRec = (!isNaN(createdMs) && createdMs >= recentCutoffMs) || (c.totalBookings <= 1 && c.pastBookingsCount === 0);
      var isRecentUpd = (!isNaN(updatedMs) && updatedMs >= recentCutoffMs) || (!isNaN(createdMs) && createdMs >= recentCutoffMs);
      var status = computeCustomerLifecycleStatus({
        statusOverride: c.statusOverride,
        manualStatus: c.manualStatus,
        openProblemsCount: c.openProblemsCount,
        inProgressComplaintsCount: c.inProgressComplaintsCount,
        activeBookingsCount: c.activeBookingsCount,
        unfollowedActiveCount: c.unfollowedActiveCount,
        totalBookings: c.totalBookings,
        pastBookingsCount: c.pastBookingsCount,
        isNewRecent: isNewRec ? 1 : 0
      });
      var hasUnfollowed = (c.unfollowedActiveCount > 0) || (c.totalBookings > 0 && c.followUpsCount === 0 && c.notesCount === 0);

      kpis.totalCustomers += 1;
      if (isNewRec || status === 'جديد') kpis.newCustomers += 1;
      if (c.activeBookingsCount > 0) kpis.activeBookingCustomers += 1;
      if (c.pastBookingsCount > 0) kpis.pastBookingCustomers += 1;
      if (c.openProblemsCount > 0) kpis.openProblemCustomers += 1;
      if (c.inProgressComplaintsCount > 0) kpis.inProgressComplaintCustomers += 1;
      if (c.extensionsCount > 0) kpis.extensionCustomers += 1;
      if (hasUnfollowed) kpis.unfollowedCustomers += 1;
      if (c.totalBookings > 1) kpis.repeatCustomers += 1;
      if (isRecentUpd) kpis.recentUpdatedCustomers += 1;

      var cleanCopy = Object.assign({}, c, {
        status: status,
        isNew: isNewRec,
        isRecent: isRecentUpd,
        unfollowed: hasUnfollowed,
        isRepeat: c.totalBookings > 1
      });
      delete cleanCopy._lastBookingIso;
      return cleanCopy;
    });

    rows.sort(function (a, b) {
      return String(b.lastActivityAt || b.updatedAt || '').localeCompare(String(a.lastActivityAt || a.updatedAt || ''));
    });

    return { items: rows, kpis: kpis };
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
      var hadExisting = Object.prototype.hasOwnProperty.call(map, item.id);
      if (!hadExisting) {
        order.push(item.id);
      }
      var merged = Object.assign({}, map[item.id] || {}, item);
      var rawIncSeq = item.sourceOrder !== undefined ? item.sourceOrder : item.source_order;
      var incSeq = (rawIncSeq !== undefined && rawIncSeq !== null && rawIncSeq !== '') ? Number(rawIncSeq) : NaN;
      var rawPrevSeq = hadExisting ? map[item.id].sourceOrder : undefined;
      var prevSeq = (rawPrevSeq !== undefined && rawPrevSeq !== null && rawPrevSeq !== '') ? Number(rawPrevSeq) : NaN;
      if (isFinite(incSeq) && incSeq > 0) {
        merged.sourceOrder = Math.floor(incSeq);
      } else if (isFinite(prevSeq) && prevSeq > 0) {
        merged.sourceOrder = Math.floor(prevSeq);
      }
      map[item.id] = merged;
    }
    var result = order.map(function (id, idx) {
      return { rec: map[id], idx: idx };
    });
    var hasSourceOrder = result.some(function (entry) {
      var seq = Number(entry.rec && entry.rec.sourceOrder);
      return isFinite(seq) && seq > 0;
    });
    if (hasSourceOrder) {
      result.sort(function (a, b) {
        var sa = Number(a.rec && a.rec.sourceOrder);
        var sb = Number(b.rec && b.rec.sourceOrder);
        var validA = isFinite(sa) && sa > 0;
        var validB = isFinite(sb) && sb > 0;
        if (validA && validB) return sa !== sb ? (sa - sb) : (a.idx - b.idx);
        if (validA && !validB) return -1;
        if (!validA && validB) return 1;
        return a.idx - b.idx;
      });
    }
    return result.map(function (entry) { return entry.rec; });
  }

  var DASHBOARD_PERMISSION_KEYS = [
    'dash_view_hero_kpis',
    'dash_view_strip_kpis',
    'dash_view_daily_chart',
    'dash_view_recent_activity',
    'dash_view_charts_grid',
    'dash_view_radar',
    'dash_view_heatmap',
    'dash_view_leaderboard',
    'dash_view_bottom_bento',
    'dash_view_handover'
  ];

  var SECTION_VIEW_PERMISSION_KEYS = [
    'view_customers',
    'view_reservations',
    'view_my_followups',
    'view_team_followups',
    'view_problems',
    'view_reports',
    'view_employees',
    'view_activity',
    'view_settings'
  ];

  var SUBSECTION_VIEW_PERMISSION_KEYS = [
    'sub_view_today_tab',
    'sub_view_radar_tab',
    'sub_view_myfu_mentions',
    'sub_view_myfu_history',
    'sub_view_prb_rates',
    'sub_view_rep_charts',
    'sub_view_emp_delegations',
    'sub_view_emp_presets'
  ];

  var EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS = [
    'sub_view_rejected_tab',
    'sub_view_cancelled_tab',
    'sub_view_cust_dashboard',
    'sub_view_cust_complaints',
    'sub_view_cust_timeline'
  ];

  var ACTION_BUTTON_PERMISSION_KEYS = [
    'act_export_excel',
    'act_export_pdf',
    'act_pull_reservations',
    'act_import_excel',
    'act_bulk_reassign',
    'act_handover_pdf',
    'act_res_columns',
    'act_claim_reservation',
    'act_close_delete_ticket',
    'act_report_problem',
    'act_delete_employee',
    'act_customer_id_lookup',
    'act_edit_customer',
    'act_add_customer_note'
  ];

  var ROUTE_PERMISSION_MAP = {
    dashboard: 'view_dashboard',
    customers: 'view_customers',
    reservations: 'view_reservations',
    'my-followups': 'view_my_followups',
    'team-followups': 'view_team_followups',
    problems: 'view_problems',
    reports: 'view_reports',
    employees: 'view_employees',
    activity: 'view_activity',
    settings: 'view_settings'
  };

  var ALL_FULL_ACCESS_PERMS = [
    'view_dashboard', 'dash_perms_configured', 'perms_sections_configured', 'perms_subsections_configured', 'perms_actions_configured'
  ].concat(DASHBOARD_PERMISSION_KEYS).concat(SECTION_VIEW_PERMISSION_KEYS).concat(SUBSECTION_VIEW_PERMISSION_KEYS).concat(EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS).concat(ACTION_BUTTON_PERMISSION_KEYS).concat([
    'view_all_reservations', 'view_customer_id', 'pull_reservations', 'assign_employees', 'add_followup',
    'claim_reservation', 'unclaim_reservation', 'quick_update_status',
    'edit_any_followup', 'edit_reservation_details', 'edit_ticket_details', 'pin_reservation_note',
    'edit_customer_details', 'view_customer_notes', 'view_all_customer_notes', 'add_customer_note',
    'edit_customer_note', 'delete_customer_note', 'change_customer_note_status', 'assign_customer_note',
    'manage_customer_note_statuses', 'manage_customer_notes_settings', 'manage_customer_notes_buttons',
    'view_customer_note_history', 'export_customer_notes',
    'create_problem', 'update_problem', 'delete_reservations', 'view_employees', 'manage_employees',
    'view_all_logs', 'sync_data', 'manage_api_connection', 'manage_settings',
    'manage_role_ui_defaults', 'customize_ui', 'manage_announcements', 'manage_developer_tools', 'export_reports'
  ]);

  var ROLE_PERMISSION_MATRIX = {
    developer: ALL_FULL_ACCESS_PERMS.slice(),
    general_manager: ALL_FULL_ACCESS_PERMS.filter(function (k) { return k !== 'manage_developer_tools'; }),
    supervisor: [
      'view_dashboard', 'dash_perms_configured', 'perms_sections_configured', 'perms_subsections_configured', 'perms_actions_configured'
    ].concat(DASHBOARD_PERMISSION_KEYS).concat(SECTION_VIEW_PERMISSION_KEYS).concat(SUBSECTION_VIEW_PERMISSION_KEYS).concat(EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS).concat(ACTION_BUTTON_PERMISSION_KEYS).concat([
      'view_all_reservations', 'view_customer_id', 'pull_reservations', 'assign_employees', 'add_followup',
      'claim_reservation', 'unclaim_reservation', 'quick_update_status',
      'edit_any_followup', 'edit_reservation_details', 'edit_ticket_details', 'pin_reservation_note',
      'edit_customer_details', 'view_customer_notes', 'view_all_customer_notes', 'add_customer_note',
      'edit_customer_note', 'change_customer_note_status', 'assign_customer_note',
      'view_customer_note_history', 'export_customer_notes',
      'create_problem', 'update_problem', 'view_employees', 'view_all_logs',
      'sync_data', 'export_reports'
    ]),
    agent: [
      'view_dashboard', 'dash_perms_configured', 'perms_subsections_configured', 'perms_actions_configured'
    ].concat(DASHBOARD_PERMISSION_KEYS).concat(ACTION_BUTTON_PERMISSION_KEYS.filter(function (ak) {
      return ak !== 'act_customer_id_lookup' && ak !== 'act_edit_customer';
    })).concat([
      'view_customers', 'view_reservations', 'view_my_followups', 'view_team_followups', 'view_problems', 'view_reports', 'view_activity',
      'sub_view_today_tab', 'sub_view_radar_tab', 'sub_view_rejected_tab', 'sub_view_cancelled_tab', 'sub_view_myfu_mentions', 'sub_view_myfu_history',
      'sub_view_prb_rates', 'sub_view_rep_charts', 'sub_view_cust_dashboard', 'sub_view_cust_complaints', 'sub_view_cust_timeline',
      'pull_reservations', 'add_followup', 'add_customer_note', 'claim_reservation', 'unclaim_reservation',
      'quick_update_status', 'create_problem', 'update_problem', 'export_reports'
    ])
  };

  var PERMISSIONS_CATALOG = [
    { key: 'view_dashboard', label: 'عرض قسم: لوحة التحكم والإحصائيات', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_customers', label: 'عرض قسم: إدارة العملاء وملفاتهم', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_reservations', label: 'عرض قسم: الحجوزات', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_my_followups', label: 'عرض قسم: متابعاتي', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_team_followups', label: 'عرض قسم: متابعات الفريق', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_problems', label: 'عرض قسم: المشكلات والتذاكر', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_reports', label: 'عرض قسم: التقارير والإحصائيات', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_employees', label: 'عرض قسم: الموظفين وملفات عملائهم', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_activity', label: 'عرض قسم: سجل النشاطات', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'view_settings', label: 'عرض قسم: الإعدادات', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_today_tab', label: 'عرض تبويب: التسليم والاستلام اليوم', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_radar_tab', label: 'عرض تبويب: رادار انتهاء الحجوزات (24 ساعة)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_rejected_tab', label: 'عرض تبويب: الحجوزات المرفوضة (داخل الحجوزات)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_cancelled_tab', label: 'عرض تبويب: الحجوزات الملغاة (داخل الحجوزات)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_myfu_mentions', label: 'عرض تبويب: إشارات @Mention في متابعاتي', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_myfu_history', label: 'عرض قسم: سجل متابعاتي السابقة', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_prb_rates', label: 'عرض مؤشر: نسبة المشكلات لكل 100 حجز', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_rep_charts', label: 'عرض الرسوم البيانية ومصفوفة الذروة في التقارير', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_emp_delegations', label: 'عرض قسم: تفويض الصلاحيات المؤقت (الإنابة)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_emp_presets', label: 'عرض قسم: الصلاحيات الجاهزة (القوالب الوظيفية)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_cust_dashboard', label: 'عرض لوحة مؤشرات العملاء (Dashboard)', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_cust_complaints', label: 'عرض تبويب المشاكل والشكاوى في ملف العميل', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'sub_view_cust_timeline', label: 'عرض السجل الزمني الموحد للعميل', group: 'إظهار وإخفاء الأقسام والصفحات' },
    { key: 'act_export_excel', label: 'زر تصدير Excel في الجداول والتقارير', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_export_pdf', label: 'زر تصدير ومعاينة PDF', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_pull_reservations', label: 'زر وشريط سحب الحجوزات', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_import_excel', label: 'زر استيراد من Excel', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_bulk_reassign', label: 'زر التحويل والتوزيع الجماعي للحجوزات', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_handover_pdf', label: 'زر تسليم الوردية (PDF)', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_res_columns', label: 'زر إظهار / إخفاء أعمدة الجدول', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_claim_reservation', label: 'أزرار استلام وإلغاء استلام الحجز', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_close_delete_ticket', label: 'أزرار إغلاق / حذف التذاكر والمشكلات', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_report_problem', label: 'زر تحويل الحجز إلى مشكلة', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_delete_employee', label: 'أزرار حذف وإيقاف الموظفين', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_customer_id_lookup', label: 'زر الاستعلام عن العميل برقم الهوية', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_edit_customer', label: 'زر تعديل بيانات وحالة العميل', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'act_add_customer_note', label: 'زر إضافة ملاحظة وسجل تواصل في ملف العميل', group: 'أزرار وإجراءات الجداول والتصدير' },
    { key: 'dash_view_hero_kpis', label: 'بطاقات المؤشرات الرئيسية (Hero KPIs)', group: 'لوحة التحكم' },
    { key: 'dash_view_strip_kpis', label: 'شريط مؤشرات الحالات التفصيلية (KPI Strip)', group: 'لوحة التحكم' },
    { key: 'dash_view_daily_chart', label: 'رسم المتابعات اليومية', group: 'لوحة التحكم' },
    { key: 'dash_view_recent_activity', label: 'بطاقة أحدث النشاطات', group: 'لوحة التحكم' },
    { key: 'dash_view_charts_grid', label: 'شبكة الرسوم البيانية التحليلية (6 مخططات)', group: 'لوحة التحكم' },
    { key: 'dash_view_radar', label: 'رادار انتهاء الحجوزات (24 ساعة)', group: 'لوحة التحكم' },
    { key: 'dash_view_heatmap', label: 'مصفوفة ساعات الذروة (تخطيط الورديات)', group: 'لوحة التحكم' },
    { key: 'dash_view_leaderboard', label: 'لوحة صدارة الموظفين (Leaderboard)', group: 'لوحة التحكم' },
    { key: 'dash_view_bottom_bento', label: 'أحدث الحجوزات والمشكلات المفتوحة والإجراءات السريعة', group: 'لوحة التحكم' },
    { key: 'dash_view_handover', label: 'زر تسليم الوردية (PDF) داخل لوحة التحكم', group: 'لوحة التحكم' },
    { key: 'view_all_reservations', label: 'استعراض جميع الحجوزات', group: 'الحجوزات' },
    { key: 'view_customer_id', label: 'عرض رقم هوية العميل والبحث بالهوية', group: 'الحجوزات' },
    { key: 'pull_reservations', label: 'سحب واستيراد وتحديث الحجوزات من قائمة الحجوزات', group: 'الحجوزات' },
    { key: 'claim_reservation', label: 'استلام الحجوزات ذاتيًا', group: 'الحجوزات' },
    { key: 'unclaim_reservation', label: 'إلغاء استلام الحجز', group: 'الحجوزات' },
    { key: 'quick_update_status', label: 'التحديث السريع لحالة الحجز', group: 'الحجوزات' },
    { key: 'edit_customer_details', label: 'إنشاء وتعديل بيانات العميل', group: 'إدارة العملاء' },
    { key: 'view_customer_notes', label: 'عرض قسم ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'view_all_customer_notes', label: 'عرض ملاحظات جميع الموظفين', group: 'ملاحظات العملاء' },
    { key: 'add_customer_note', label: 'إضافة ملاحظة جديدة للعميل', group: 'ملاحظات العملاء' },
    { key: 'edit_customer_note', label: 'تعديل ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'delete_customer_note', label: 'حذف ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'change_customer_note_status', label: 'تغيير حالة ملاحظة العميل', group: 'ملاحظات العملاء' },
    { key: 'assign_customer_note', label: 'إسناد متابعة الملاحظة لموظف', group: 'ملاحظات العملاء' },
    { key: 'manage_customer_note_statuses', label: 'إدارة حالات ملاحظات العملاء (إضافة/تعديل/حذف)', group: 'ملاحظات العملاء' },
    { key: 'manage_customer_notes_settings', label: 'إدارة إعدادات قسم ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'manage_customer_notes_buttons', label: 'التحكم في أزرار وقواعد ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'view_customer_note_history', label: 'عرض سجل تعديلات ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'export_customer_notes', label: 'تصدير وطباعة ملاحظات العملاء', group: 'ملاحظات العملاء' },
    { key: 'add_followup', label: 'إضافة متابعات وملاحظات', group: 'المتابعات' },
    { key: 'edit_any_followup', label: 'تعديل متابعات وتحديثات الفريق', group: 'المتابعات' },
    { key: 'assign_employees', label: 'إسناد وإزالة الموظفين عن الحجوزات', group: 'الإشراف' },
    { key: 'edit_reservation_details', label: 'تعديل تفاصيل الحجوزات والأسعار', group: 'الإشراف' },
    { key: 'pin_reservation_note', label: 'تثبيت وتعديل الملاحظات المثبتة أعلى الحجز', group: 'الإشراف' },
    { key: 'create_problem', label: 'تحويل الحجز إلى مشكلة / تذكرة', group: 'المشكلات' },
    { key: 'update_problem', label: 'تحديث حالة التذاكر والمشكلات', group: 'المشكلات' },
    { key: 'edit_ticket_details', label: 'تعديل بيانات ووصف التذاكر', group: 'الإشراف' },
    { key: 'view_all_logs', label: 'الاطلاع على سجل نشاطات الفريق', group: 'التقارير والرقابة' },
    { key: 'export_reports', label: 'تصدير تقارير Excel وPDF', group: 'التقارير والرقابة' },
    { key: 'sync_data', label: 'الوصول إلى Rental Gate API والمزامنة', group: 'الإدارة والربط (API)' },
    { key: 'manage_api_connection', label: 'إدارة مفاتيح وربط API (RG_TOKEN / GAS)', group: 'الإدارة والربط (API)' },
    { key: 'manage_employees', label: 'إدارة حسابات الموظفين وصلاحياتهم', group: 'الإدارة والربط (API)' },
    { key: 'manage_settings', label: 'تعديل إعدادات النظام والتحديث التلقائي', group: 'الإدارة والربط (API)' },
    { key: 'manage_role_ui_defaults', label: 'التحكم المركزي بإعدادات وأعمدة واجهة الأدوار والوظائف', group: 'الإدارة والربط (API)' },
    { key: 'customize_ui', label: 'تخصيص وإظهار/إخفاء الأقسام للموظفين والأدوار', group: 'الإدارة والربط (API)' },
    { key: 'manage_announcements', label: 'إدارة تعميمات وإعلانات الوردية', group: 'الإدارة والربط (API)' },
    { key: 'delete_reservations', label: 'حذف الحجوزات الجماعي والنسخ الاحتياطي', group: 'الإدارة والربط (API)' },
    { key: 'manage_developer_tools', label: 'الصلاحيات البرمجية الكاملة وفحص الخادم وكاش الموقع ومراقبة سلامة البيانات', group: 'الإدارة والربط (API)' }
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
      permissions: ROLE_PERMISSION_MATRIX.agent.concat([
        'view_all_reservations', 'view_customer_id', 'act_customer_id_lookup',
        'edit_customer_details', 'act_edit_customer',
        'view_employees', 'edit_any_followup'
      ])
    },
    {
      id: 'qa_reports',
      label: 'مسؤول جودة وتقارير (قراءة وتصدير)',
      jobTitle: 'أخصائي جودة وتقارير',
      role: ROLES.AGENT,
      permissions: [
        'view_dashboard', 'dash_perms_configured', 'perms_subsections_configured',
        'dash_view_hero_kpis', 'dash_view_strip_kpis', 'dash_view_daily_chart',
        'dash_view_recent_activity', 'dash_view_charts_grid', 'dash_view_radar',
        'dash_view_heatmap', 'dash_view_leaderboard', 'dash_view_bottom_bento',
        'view_customers', 'view_reservations', 'view_reports', 'view_activity',
        'sub_view_today_tab', 'sub_view_radar_tab', 'sub_view_rejected_tab', 'sub_view_cancelled_tab',
        'sub_view_prb_rates', 'sub_view_rep_charts', 'sub_view_cust_dashboard', 'sub_view_cust_complaints', 'sub_view_cust_timeline',
        'view_all_reservations', 'view_employees', 'view_all_logs', 'export_reports'
      ]
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
    },
    {
      id: 'developer_admin',
      label: 'المبرمج (مسؤول الموقع والإعدادات الكاملة)',
      jobTitle: 'مبرمج ومسؤول الموقع',
      role: ROLES.DEVELOPER,
      permissions: ROLE_PERMISSION_MATRIX.developer.slice()
    }
  ];

  function isPrivilegedRole(roleOrUser) {
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    return role === ROLES.DEVELOPER || role === ROLES.GENERAL_MANAGER;
  }

  function resolveEffectivePermissions(roleOrUser, optionalPerms) {
    if (!roleOrUser) return [];
    if (typeof roleOrUser === 'string') {
      if (!Array.isArray(optionalPerms)) {
        return (ROLE_PERMISSION_MATRIX[roleOrUser] || []).slice();
      }
      roleOrUser = { role: roleOrUser, permissions: optionalPerms };
    }
    var role = roleOrUser.role || ROLES.AGENT;
    var rawPerms = Array.isArray(roleOrUser.permissions) ? roleOrUser.permissions : [];
    if (rawPerms.indexOf('all') !== -1) {
      return (ROLE_PERMISSION_MATRIX[role === ROLES.DEVELOPER ? ROLES.DEVELOPER : ROLES.GENERAL_MANAGER]).slice();
    }
    var isLegacyRoleOnly = rawPerms.length === 0 || (
      rawPerms.length === 1 &&
      [ROLES.DEVELOPER, ROLES.AGENT, ROLES.SUPERVISOR, ROLES.GENERAL_MANAGER].indexOf(rawPerms[0]) !== -1
    );
    if (isLegacyRoleOnly) {
      return (ROLE_PERMISSION_MATRIX[role] || []).slice();
    }
    return rawPerms.slice();
  }

  function canAccessApi(roleOrUser) {
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    return role === ROLES.DEVELOPER || role === ROLES.GENERAL_MANAGER || role === ROLES.SUPERVISOR;
  }

  function canUserPerform(roleOrUser, action) {
    if (!roleOrUser || !action) return false;
    if (
      action === 'reject_reservation' ||
      action === 'cancel_reservation' ||
      action === 'act_reject_reservation' ||
      action === 'act_cancel_reservation'
    ) {
      return false;
    }
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    if (role === ROLES.DEVELOPER) return true;
    if (action === 'sync_data' || action === 'manage_api_connection') {
      if (!canAccessApi(roleOrUser)) return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    return allowed.indexOf(action) !== -1;
  }

  var UI_ROUTE_HIDE_KEYS = {
    customers: 'hideNavCustomers',
    'team-followups': 'hideNavTeamFollowups',
    problems: 'hideNavProblems',
    reports: 'hideNavReports',
    employees: 'hideNavEmployees',
    activity: 'hideNavActivity'
  };

  var UI_SUBSECTION_HIDE_KEYS = {
    sub_view_today_tab: 'hideResTodayTab',
    sub_view_radar_tab: 'hideResRadarTab',
    sub_view_rejected_tab: 'hideResRejectedTab',
    sub_view_cancelled_tab: 'hideResCancelledTab',
    sub_view_myfu_mentions: 'hideMyfuMentionsTab',
    sub_view_myfu_history: 'hideMyfuHistoryCard',
    sub_view_prb_rates: 'hideProblemsRateIndicator',
    sub_view_rep_charts: 'hideReportsCharts',
    sub_view_emp_delegations: 'hideEmployeesDelegations',
    sub_view_emp_presets: 'hideRolePresetsSection',
    sub_view_cust_dashboard: 'hideCustDashboard',
    sub_view_cust_complaints: 'hideCustComplaintsTab',
    sub_view_cust_timeline: 'hideCustTimelineTab'
  };

  var UI_DASHBOARD_HIDE_KEYS = {
    dash_view_hero_kpis: 'hideDashHeroKpis',
    dash_view_strip_kpis: 'hideDashStripKpis',
    dash_view_daily_chart: 'hideDashDailyChart',
    dash_view_recent_activity: 'hideDashRecentActivity',
    dash_view_charts_grid: 'hideDashChartsGrid',
    dash_view_radar: 'hideDashboardRadar',
    dash_view_heatmap: 'hideDashboardHeatmap',
    dash_view_leaderboard: 'hideDashLeaderboard',
    dash_view_bottom_bento: 'hideDashBottomBento',
    dash_view_handover: 'hideShiftHandoverBtn'
  };

  var UI_ACTION_HIDE_KEYS = {
    act_export_excel: 'hideResExportExcel',
    act_export_pdf: 'hideDrawerPdfBtn',
    act_pull_reservations: 'hideResPullBtn',
    act_import_excel: 'hideResImportExcel',
    act_bulk_reassign: 'hideResBulkReassign',
    act_handover_pdf: 'hideShiftHandoverBtn',
    act_res_columns: 'hideResColsToggle',
    act_claim_reservation: ['hideResClaimBtns', 'hideDrawerClaimBtns'],
    act_close_delete_ticket: 'hideProblemsCloseDeleteBtn',
    act_report_problem: 'hideDrawerReportProblemBtn',
    act_customer_id_lookup: 'hideResCustomerIdLookupBtn',
    act_delete_employee: 'hideEmployeesRowActions',
    act_edit_customer: 'hideCustEditBtn',
    act_add_customer_note: 'hideCustAddNoteBtn'
  };

  function isUiOptionHiddenForUser(roleOrUser, hideKey, uiContext) {
    if (!roleOrUser || !hideKey) return false;
    var key = normalizeStr(hideKey);
    if (!key) return false;
    var role = typeof roleOrUser === 'string' ? normalizeStr(roleOrUser) : normalizeStr(roleOrUser.role);
    if (role === ROLES.DEVELOPER) return false;
    var userObj = (roleOrUser && typeof roleOrUser === 'object') ? roleOrUser : { role: role, uiOverrides: {} };
    var aliasKey = UI_FLAG_ALIASES[key] || '';
    var empOv = normalizeUiOverrides(userObj.uiOverrides);

    if (Object.prototype.hasOwnProperty.call(empOv.flags, key) && typeof empOv.flags[key] === 'boolean') {
      return empOv.flags[key];
    }
    if (aliasKey && Object.prototype.hasOwnProperty.call(empOv.flags, aliasKey) && typeof empOv.flags[aliasKey] === 'boolean') {
      return empOv.flags[aliasKey];
    }
    if (empOv.hiddenKeys.indexOf(key) !== -1 || (aliasKey && empOv.hiddenKeys.indexOf(aliasKey) !== -1)) {
      return true;
    }
    if (empOv.shownKeys.indexOf(key) !== -1 || (aliasKey && empOv.shownKeys.indexOf(aliasKey) !== -1)) {
      return false;
    }

    var globalHost = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
    var activeUiCtx = (uiContext && typeof uiContext === 'object')
      ? uiContext
      : ((globalHost && globalHost.RGApp && typeof globalHost.RGApp.getActiveUiContext === 'function')
          ? globalHost.RGApp.getActiveUiContext()
          : null);

    if (activeUiCtx && typeof activeUiCtx === 'object') {
      var resolved = resolveRoleUiDefaultsForUser(userObj, activeUiCtx.roleUiDefaults, activeUiCtx.uiSimplification);
      var eff = (resolved && resolved.uiSimplification) || {};
      if (typeof eff[key] === 'boolean') return eff[key];
      if (aliasKey && typeof eff[aliasKey] === 'boolean') return eff[aliasKey];
    }

    if (userObj._effectiveUi && typeof userObj._effectiveUi === 'object') {
      if (typeof userObj._effectiveUi[key] === 'boolean') return userObj._effectiveUi[key];
      if (aliasKey && typeof userObj._effectiveUi[aliasKey] === 'boolean') return userObj._effectiveUi[aliasKey];
    }
    return false;
  }

  function canUserViewDashboardSection(roleOrUser, permKey, uiContext) {
    if (!roleOrUser || !permKey) return false;
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    var uiHideKey = UI_DASHBOARD_HIDE_KEYS[permKey];
    if (role !== ROLES.DEVELOPER && uiHideKey && isUiOptionHiddenForUser(roleOrUser, uiHideKey, uiContext)) {
      return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    if (role !== ROLES.DEVELOPER && allowed.indexOf('view_dashboard') === -1) return false;
    var hasGranularConfig = allowed.indexOf('dash_perms_configured') !== -1 ||
      DASHBOARD_PERMISSION_KEYS.some(function (k) { return allowed.indexOf(k) !== -1; });
    if (hasGranularConfig) {
      return allowed.indexOf(permKey) !== -1;
    }
    return true;
  }

  function canUserViewRoute(roleOrUser, routeId, uiContext) {
    if (!roleOrUser || !routeId) return false;
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    if (role === ROLES.DEVELOPER) return NAV_ROUTE_IDS.indexOf(routeId) !== -1;
    var uiHideKey = UI_ROUTE_HIDE_KEYS[routeId];
    if (uiHideKey && isUiOptionHiddenForUser(roleOrUser, uiHideKey, uiContext)) {
      return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    var hasSectionConfig = allowed.indexOf('perms_sections_configured') !== -1 ||
      SECTION_VIEW_PERMISSION_KEYS.some(function (k) { return allowed.indexOf(k) !== -1; });

    if (routeId === 'dashboard') {
      return allowed.indexOf('view_dashboard') !== -1;
    }
    if (routeId === 'employees') {
      if (hasSectionConfig || allowed.indexOf('view_employees') !== -1) {
        return allowed.indexOf('view_employees') !== -1;
      }
      return role === ROLES.GENERAL_MANAGER;
    }
    if (routeId === 'settings') {
      if (hasSectionConfig) return allowed.indexOf('view_settings') !== -1;
      return true;
    }
    var permKey = ROUTE_PERMISSION_MAP[routeId];
    if (!permKey) return false;
    if (hasSectionConfig) {
      return allowed.indexOf(permKey) !== -1;
    }
    return true;
  }

  var SUBSECTION_KEY_ALIASES = {
    today_tab: 'sub_view_today_tab',
    radar_tab: 'sub_view_radar_tab',
    rejected_tab: 'sub_view_rejected_tab',
    cancelled_tab: 'sub_view_cancelled_tab',
    myfu_mentions: 'sub_view_myfu_mentions',
    myfu_history: 'sub_view_myfu_history',
    prb_rates: 'sub_view_prb_rates',
    rep_charts: 'sub_view_rep_charts',
    emp_delegations: 'sub_view_emp_delegations',
    emp_presets: 'sub_view_emp_presets',
    cust_dashboard: 'sub_view_cust_dashboard',
    cust_complaints: 'sub_view_cust_complaints',
    cust_timeline: 'sub_view_cust_timeline'
  };

  function canUserViewSubSection(roleOrUser, subKey, uiContext) {
    if (!roleOrUser || !subKey) return false;
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    if (role === ROLES.DEVELOPER) return true;
    var canonKey = SUBSECTION_KEY_ALIASES[subKey] || subKey;
    var uiHideKey = UI_SUBSECTION_HIDE_KEYS[canonKey];
    if (uiHideKey && isUiOptionHiddenForUser(roleOrUser, uiHideKey, uiContext)) {
      return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    var allSubKeys = SUBSECTION_VIEW_PERMISSION_KEYS.concat(EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS);
    var hasSubConfig = allowed.indexOf('perms_subsections_configured') !== -1 ||
      allSubKeys.some(function (k) { return allowed.indexOf(k) !== -1; });
    if (hasSubConfig) {
      return allowed.indexOf(canonKey) !== -1 || allowed.indexOf(subKey) !== -1;
    }
    return true;
  }

  function canUserUseActionButton(roleOrUser, actionKey, uiContext) {
    if (!roleOrUser || !actionKey) return false;
    var role = typeof roleOrUser === 'string' ? roleOrUser : (roleOrUser && roleOrUser.role);
    if (role === ROLES.DEVELOPER) return true;
    var uiHideSpec = UI_ACTION_HIDE_KEYS[actionKey];
    if (Array.isArray(uiHideSpec)) {
      var allHidden = uiHideSpec.length > 0 && uiHideSpec.every(function (hk) {
        return isUiOptionHiddenForUser(roleOrUser, hk, uiContext);
      });
      if (allHidden) return false;
    } else if (uiHideSpec && isUiOptionHiddenForUser(roleOrUser, uiHideSpec, uiContext)) {
      return false;
    }
    var allowed = resolveEffectivePermissions(roleOrUser);
    var hasActionsConfig = allowed.indexOf('perms_actions_configured') !== -1 ||
      ACTION_BUTTON_PERMISSION_KEYS.some(function (k) { return allowed.indexOf(k) !== -1; });
    if (hasActionsConfig) {
      return allowed.indexOf(actionKey) !== -1;
    }
    return true;
  }

  function canUserViewCustomerId(roleOrUser) {
    return canUserPerform(roleOrUser, 'view_customer_id');
  }

  var EMPLOYEE_SECTION_GROUPS = [
    {
      id: 'main_sections',
      labelAr: 'الأقسام والصفحات الرئيسية',
      labelEn: 'Main Pages & Sections',
      sentinelKey: 'perms_sections_configured',
      items: [
        { key: 'view_dashboard', routeId: 'dashboard', labelAr: 'لوحة التحكم والإحصائيات', labelEn: 'Dashboard & KPIs' },
        { key: 'view_customers', routeId: 'customers', labelAr: 'إدارة العملاء وملفاتهم', labelEn: 'Customers Management' },
        { key: 'view_reservations', routeId: 'reservations', labelAr: 'الحجوزات', labelEn: 'Reservations' },
        { key: 'view_my_followups', routeId: 'my-followups', labelAr: 'متابعاتي', labelEn: 'My Follow-Ups' },
        { key: 'view_team_followups', routeId: 'team-followups', labelAr: 'متابعات الفريق', labelEn: 'Team Follow-Ups' },
        { key: 'view_problems', routeId: 'problems', labelAr: 'المشكلات والتذاكر', labelEn: 'Problems & Tickets' },
        { key: 'view_reports', routeId: 'reports', labelAr: 'التقارير والإحصائيات', labelEn: 'Reports & Analytics' },
        { key: 'view_employees', routeId: 'employees', labelAr: 'الموظفون وملفات العملاء', labelEn: 'Employees & Profiles' },
        { key: 'view_activity', routeId: 'activity', labelAr: 'سجل النشاطات', labelEn: 'Activity Log' },
        { key: 'view_settings', routeId: 'settings', labelAr: 'الإعدادات', labelEn: 'Settings' }
      ]
    },
    {
      id: 'sub_sections',
      labelAr: 'التبويبات والأقسام الفرعية',
      labelEn: 'Tabs & Sub-Sections',
      sentinelKey: 'perms_subsections_configured',
      items: [
        { key: 'sub_view_cust_dashboard', labelAr: 'لوحة مؤشرات العملاء (Dashboard)', labelEn: 'Customers Dashboard KPIs' },
        { key: 'sub_view_cust_complaints', labelAr: 'تبويب المشاكل والشكاوى في ملف العميل', labelEn: 'Customer Profile Complaints Tab' },
        { key: 'sub_view_cust_timeline', labelAr: 'السجل الزمني الموحد في ملف العميل', labelEn: 'Customer Profile Activity Timeline' },
        { key: 'sub_view_today_tab', labelAr: 'تبويب التسليم والاستلام اليوم', labelEn: 'Today Pickups & Returns Tab' },
        { key: 'sub_view_radar_tab', labelAr: 'تبويب رادار انتهاء الحجوزات (24 ساعة)', labelEn: '24h Expiry Radar Tab' },
        { key: 'sub_view_rejected_tab', labelAr: 'تبويب الحجوزات المرفوضة', labelEn: 'Rejected Reservations Tab' },
        { key: 'sub_view_cancelled_tab', labelAr: 'تبويب الحجوزات الملغاة', labelEn: 'Cancelled Reservations Tab' },
        { key: 'sub_view_myfu_mentions', labelAr: 'تبويب إشارات @Mention في متابعاتي', labelEn: '@Mentions Tab' },
        { key: 'sub_view_myfu_history', labelAr: 'قسم سجل متابعاتي السابقة', labelEn: 'My Follow-Ups History' },
        { key: 'sub_view_prb_rates', labelAr: 'مؤشر نسبة المشكلات لكل 100 حجز', labelEn: 'Problems Per 100 Bookings' },
        { key: 'sub_view_rep_charts', labelAr: 'الرسوم البيانية ومصفوفة الذروة بالتقارير', labelEn: 'Reports Charts & Heatmap' },
        { key: 'sub_view_emp_delegations', labelAr: 'قسم تفويض الصلاحيات المؤقت (الإنابة)', labelEn: 'Temporary Delegations Section' },
        { key: 'sub_view_emp_presets', labelAr: 'قسم الصلاحيات الجاهزة (القوالب الوظيفية)', labelEn: 'Role Presets Section' }
      ]
    },
    {
      id: 'dashboard_cards',
      labelAr: 'بطاقات وإحصائيات لوحة التحكم',
      labelEn: 'Dashboard Widgets & Stats',
      sentinelKey: 'dash_perms_configured',
      items: [
        { key: 'dash_view_hero_kpis', labelAr: 'بطاقات المؤشرات الرئيسية (Hero KPIs)', labelEn: 'Hero KPIs' },
        { key: 'dash_view_strip_kpis', labelAr: 'شريط مؤشرات الحالات التفصيلية', labelEn: 'Status Strip KPIs' },
        { key: 'dash_view_daily_chart', labelAr: 'رسم المتابعات اليومية', labelEn: 'Daily Follow-Ups Chart' },
        { key: 'dash_view_recent_activity', labelAr: 'بطاقة أحدث النشاطات', labelEn: 'Recent Activity Feed' },
        { key: 'dash_view_charts_grid', labelAr: 'شبكة الرسوم البيانية التحليلية', labelEn: 'Analytical Charts Grid' },
        { key: 'dash_view_radar', labelAr: 'رادار انتهاء الحجوزات (24 ساعة)', labelEn: '24h Expiry Radar Card' },
        { key: 'dash_view_heatmap', labelAr: 'مصفوفة ساعات الذروة (تخطيط الورديات)', labelEn: 'Peak Hours Heatmap' },
        { key: 'dash_view_leaderboard', labelAr: 'لوحة الصدارة وأداء الفريق', labelEn: 'Team Leaderboard' },
        { key: 'dash_view_bottom_bento', labelAr: 'أحدث الحجوزات والمشكلات والإجراءات السريعة', labelEn: 'Bottom Bento Feeds' },
        { key: 'dash_view_handover', labelAr: 'زر تسليم الوردية (PDF)', labelEn: 'Shift Handover Button' }
      ]
    },
    {
      id: 'table_actions',
      labelAr: 'أزرار وإجراءات الجداول والتصدير',
      labelEn: 'Table & Toolbar Action Buttons',
      sentinelKey: 'perms_actions_configured',
      items: [
        { key: 'act_export_excel', labelAr: 'زر تصدير Excel', labelEn: 'Export Excel Button' },
        { key: 'act_export_pdf', labelAr: 'أزرار تصدير ومعاينة PDF', labelEn: 'Export / Preview PDF Buttons' },
        { key: 'act_pull_reservations', labelAr: 'زر وشريط سحب الحجوزات', labelEn: 'Pull Reservations Button' },
        { key: 'act_import_excel', labelAr: 'زر استيراد من Excel', labelEn: 'Import Excel Button' },
        { key: 'act_bulk_reassign', label: 'التحويل والتوزيع الجماعي للحجوزات', labelAr: 'التحويل والتوزيع الجماعي للحجوزات', labelEn: 'Bulk Reassign Actions' },
        { key: 'act_handover_pdf', labelAr: 'زر تسليم الوردية (PDF)', labelEn: 'Shift Handover (PDF) Button' },
        { key: 'act_res_columns', labelAr: 'زر إظهار / إخفاء الأعمدة', labelEn: 'Table Columns Button' },
        { key: 'act_claim_reservation', labelAr: 'أزرار استلام / إلغاء استلام الحجز', labelEn: 'Claim / Unclaim Booking Buttons' },
        { key: 'act_close_delete_ticket', labelAr: 'أزرار إغلاق / حذف التذاكر والمشكلات', labelEn: 'Close / Delete Ticket Buttons' },
        { key: 'act_report_problem', labelAr: 'زر تحويل الحجز إلى مشكلة', labelEn: 'Report Problem Button' },
        { key: 'act_customer_id_lookup', labelAr: 'زر الاستعلام عن العميل برقم الهوية', labelEn: 'National ID Lookup Button' },
        { key: 'act_edit_customer', labelAr: 'زر تعديل بيانات العميل', labelEn: 'Edit Customer Button' },
        { key: 'act_add_customer_note', labelAr: 'زر إضافة ملاحظة وسجل تواصل للعميل', labelEn: 'Add Customer Note Button' },
        { key: 'act_delete_employee', labelAr: 'أزرار حذف وإيقاف الموظفين', labelEn: 'Delete / Toggle Employee Buttons' }
      ]
    }
  ];

  function ensureSectionPermissionSentinels(role, currentPerms) {
    var base = resolveEffectivePermissions(role || ROLES.AGENT, currentPerms);
    var map = {};
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var k = normalizeStr(base[i]);
      if (k && !map[k]) {
        map[k] = true;
        out.push(k);
      }
    }
    var hadActionsConfig = Boolean(map['perms_actions_configured']) ||
      ACTION_BUTTON_PERMISSION_KEYS.some(function (ak) { return Boolean(map[ak]); });
    if (!hadActionsConfig) {
      for (var akIdx = 0; akIdx < ACTION_BUTTON_PERMISSION_KEYS.length; akIdx++) {
        var actKey = ACTION_BUTTON_PERMISSION_KEYS[akIdx];
        if (!map[actKey]) {
          map[actKey] = true;
          out.push(actKey);
        }
      }
    }
    var sentinels = ['perms_sections_configured', 'perms_subsections_configured', 'dash_perms_configured', 'perms_actions_configured'];
    for (var s = 0; s < sentinels.length; s++) {
      if (!map[sentinels[s]]) {
        map[sentinels[s]] = true;
        out.push(sentinels[s]);
      }
    }
    return out;
  }

  function applyEmployeeSectionToggle(role, currentPerms, permKey, visible) {
    var key = normalizeStr(permKey);
    var base = ensureSectionPermissionSentinels(role, currentPerms);
    if (!key) return base;
    var exists = base.indexOf(key) !== -1;
    if (visible && !exists) {
      return base.concat([key]);
    }
    if (!visible && exists) {
      return base.filter(function (k) { return k !== key; });
    }
    return base;
  }

  function setEmployeeSectionGroupVisibility(role, currentPerms, groupKeys, visible) {
    var keys = Array.isArray(groupKeys) ? groupKeys.map(normalizeStr).filter(Boolean) : [];
    var base = ensureSectionPermissionSentinels(role, currentPerms);
    var keySet = {};
    for (var i = 0; i < keys.length; i++) keySet[keys[i]] = true;
    var filtered = base.filter(function (k) { return !keySet[k]; });
    if (!visible) return filtered;
    var seen = {};
    var out = [];
    for (var a = 0; a < filtered.length; a++) {
      if (!seen[filtered[a]]) { seen[filtered[a]] = true; out.push(filtered[a]); }
    }
    for (var b = 0; b < keys.length; b++) {
      if (!seen[keys[b]]) { seen[keys[b]] = true; out.push(keys[b]); }
    }
    return out;
  }

  function getEmployeeSectionVisibilitySummary(roleOrUser, optionalPermsOrUiContext) {
    var uiCtx = (optionalPermsOrUiContext && typeof optionalPermsOrUiContext === 'object' && !Array.isArray(optionalPermsOrUiContext))
      ? optionalPermsOrUiContext
      : null;
    var userObj = typeof roleOrUser === 'string'
      ? { role: roleOrUser, permissions: Array.isArray(optionalPermsOrUiContext) ? optionalPermsOrUiContext : [] }
      : (roleOrUser || { role: ROLES.AGENT, permissions: [] });
    var visibleMainCount = 0;
    var totalMainCount = EMPLOYEE_SECTION_GROUPS[0].items.length;
    var visibleSubCount = 0;
    var totalSubCount = EMPLOYEE_SECTION_GROUPS[1].items.length;
    var visibleDashCount = 0;
    var totalDashCount = EMPLOYEE_SECTION_GROUPS[2].items.length;
    var visibleActionCount = 0;
    var totalActionCount = EMPLOYEE_SECTION_GROUPS[3].items.length;
    var hiddenKeys = [];

    for (var m = 0; m < EMPLOYEE_SECTION_GROUPS[0].items.length; m++) {
      var mItem = EMPLOYEE_SECTION_GROUPS[0].items[m];
      if (canUserViewRoute(userObj, mItem.routeId, uiCtx)) visibleMainCount++;
      else hiddenKeys.push(mItem.key);
    }
    for (var s = 0; s < EMPLOYEE_SECTION_GROUPS[1].items.length; s++) {
      var sItem = EMPLOYEE_SECTION_GROUPS[1].items[s];
      if (canUserViewSubSection(userObj, sItem.key, uiCtx)) visibleSubCount++;
      else hiddenKeys.push(sItem.key);
    }
    for (var d = 0; d < EMPLOYEE_SECTION_GROUPS[2].items.length; d++) {
      var dItem = EMPLOYEE_SECTION_GROUPS[2].items[d];
      if (canUserViewDashboardSection(userObj, dItem.key, uiCtx)) visibleDashCount++;
      else hiddenKeys.push(dItem.key);
    }
    for (var a = 0; a < EMPLOYEE_SECTION_GROUPS[3].items.length; a++) {
      var aItem = EMPLOYEE_SECTION_GROUPS[3].items[a];
      if (canUserUseActionButton(userObj, aItem.key, uiCtx)) visibleActionCount++;
      else hiddenKeys.push(aItem.key);
    }

    return {
      visibleMainCount: visibleMainCount,
      totalMainCount: totalMainCount,
      visibleSubCount: visibleSubCount,
      totalSubCount: totalSubCount,
      visibleDashCount: visibleDashCount,
      totalDashCount: totalDashCount,
      visibleActionCount: visibleActionCount,
      totalActionCount: totalActionCount,
      totalVisible: visibleMainCount + visibleSubCount + visibleDashCount + visibleActionCount,
      totalAvailable: totalMainCount + totalSubCount + totalDashCount + totalActionCount,
      hiddenCount: hiddenKeys.length,
      hiddenKeys: hiddenKeys
    };
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
      var role = [ROLES.DEVELOPER, ROLES.GENERAL_MANAGER, ROLES.SUPERVISOR, ROLES.AGENT].indexOf(p.role) !== -1 ? p.role : ROLES.AGENT;
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
    var role = [ROLES.DEVELOPER, ROLES.GENERAL_MANAGER, ROLES.SUPERVISOR, ROLES.AGENT].indexOf(input.role) !== -1 ? input.role : ROLES.AGENT;
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
    var search = normalizeStr(f.search);
    var reservationNumberQuery = normalizeStr(f.reservationNumber).replace(/^#+/, '').trim();
    var companyNumberQuery = normalizeStr(f.companyNumber);
    var oldCompanyQuery = normalizeStr(f.oldCompanyName);
    var newCompanyQuery = normalizeStr(f.newCompanyName);
    var rejectionReasonQuery = normalizeStr(f.rejectionReason);
    var cancellationReasonQuery = normalizeStr(f.cancellationReason);
    var confirmedByQuery = normalizeStr(f.confirmedByEmployee);
    var lifecycle = normalizeStr(f.lifecycle).toLowerCase();
    var canViewCid = Boolean(userContext && userContext.user && canUserViewCustomerId(userContext.user));

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
      if (!r || typeof r !== 'object') continue;
      var assignedIds = Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [];

      if (userContext && userContext.role === ROLES.AGENT && !allowAgentViewAll && !(userContext.user && canUserPerform(userContext.user, 'view_all_reservations'))) {
        if (assignedIds.indexOf(userContext.employeeId) === -1) continue;
      }

      if (lifecycle === 'active') {
        if (isInactiveReservation(r)) continue;
      } else if (lifecycle === 'rejected') {
        if (!isInRejectedTab(r)) continue;
      } else if (lifecycle === 'cancelled') {
        if (!isCancelledStatus(r)) continue;
      } else if (lifecycle === 'inactive') {
        if (!isInactiveReservation(r) && !isInRejectedTab(r)) continue;
      }

      if (reservationNumberQuery && !matchesSearchFields([
        r.reservationNumber,
        r.sourceReservationId,
        r.referenceNumber
      ], reservationNumberQuery)) {
        continue;
      }

      if (companyNumberQuery && !matchesSearchFields([r.companyNumber], companyNumberQuery)) {
        continue;
      }
      if (oldCompanyQuery && !matchesSearchFields([r.companyName], oldCompanyQuery)) {
        continue;
      }
      if (newCompanyQuery && !matchesSearchFields([r.newCompanyName], newCompanyQuery)) {
        continue;
      }
      if (rejectionReasonQuery && !matchesSearchFields([r.rejectionReason], rejectionReasonQuery)) {
        continue;
      }
      if (cancellationReasonQuery && !matchesSearchFields([r.cancellationReason], cancellationReasonQuery)) {
        continue;
      }
      if (confirmedByQuery) {
        var actorHits = matchesSearchFields([
          r.rejectedByName, r.rejectedById, r.cancelledByName, r.cancelledById,
          r.lastUpdatedByName, r.lastUpdatedById
        ].concat(Array.isArray(r.assignedEmployeeNames) ? r.assignedEmployeeNames : []), confirmedByQuery) ||
          assignedIds.indexOf(confirmedByQuery) !== -1 ||
          r.rejectedById === confirmedByQuery ||
          r.cancelledById === confirmedByQuery;
        if (!actorHits) continue;
      }

      if (search) {
        var searchHay = [
          r.reservationNumber,
          r.referenceNumber,
          r.sourceReservationId,
          r.customerName,
          r.customerPhone,
          r.carName,
          r.plateNumber,
          r.companyName,
          r.companyNumber,
          r.newCompanyName,
          r.rejectionReason,
          r.cancellationReason,
          r.deliveryFailureReason,
          r.driverNotes,
          r.branchName
        ];
        if (canViewCid) searchHay.push(r.customerIdNumber);
        if (!matchesSearchFields(searchHay, search)) {
          continue;
        }
      }

      if (f.company && r.companyName !== f.company) continue;
      if (f.branch && r.branchName !== f.branch) continue;
      if (f.status && r.internalStatus !== f.status && r.originalStatusAr !== f.status) continue;
      if (f.priority && r.priority !== f.priority) continue;
      if (f.employeeId && assignedIds.indexOf(f.employeeId) === -1 && r.rejectedById !== f.employeeId && r.cancelledById !== f.employeeId) continue;
      var fDateFrom = normalizeStr(f.dateFrom).substring(0, 10);
      var fDateTo = normalizeStr(f.dateTo).substring(0, 10);
      if (lifecycle === 'rejected' || lifecycle === 'cancelled' || lifecycle === 'inactive') {
        var actionDateVal = normalizeStr(
          (lifecycle === 'rejected' ? r.rejectedAt : (lifecycle === 'cancelled' ? r.cancelledAt : (r.rejectedAt || r.cancelledAt))) ||
          r.lastUpdatedAt || r.startDate
        ).substring(0, 10);
        if (fDateFrom && actionDateVal < fDateFrom) continue;
        if (fDateTo && actionDateVal > fDateTo) continue;
      } else if (fDateFrom && fDateTo) {
        var rStartBoth = normalizeStr(r.startDate).substring(0, 10);
        if (rStartBoth < fDateFrom || rStartBoth > fDateTo) continue;
      } else if (fDateFrom) {
        if (normalizeStr(r.startDate).substring(0, 10) < fDateFrom) continue;
      } else if (fDateTo) {
        var effEndDay = resolveReservationEffectiveEnd(r).date;
        if (!effEndDay || effEndDay !== fDateTo) continue;
      }
      if (f.timeFrom || f.timeTo) {
        var tField = normalizeStr(f.timeField || 'both').toLowerCase();
        var sTime = normalizeStr(r.startTime) || extractTimeOnly(r.startDate);
        var eTime = normalizeStr(r.extendedUntilTime || r.endTime) || extractTimeOnly(r.extendedUntilDate || r.endDate);
        var sMatch = isTimeInRange(sTime, f.timeFrom, f.timeTo);
        var eMatch = isTimeInRange(eTime, f.timeFrom, f.timeTo);
        if (tField === 'start' && !sMatch) continue;
        else if (tField === 'end' && !eMatch) continue;
        else if (tField !== 'start' && tField !== 'end' && !sMatch && !eMatch) continue;
      }
      var hasFuList = Array.isArray(followUps) && followUps.length > 0;
      var resolvedFollowed = hasFuList ? Boolean(followedSet[r.id]) : Boolean(followedSet[r.id] || r.isFollowed);
      if (f.unfollowedOnly && resolvedFollowed) continue;
      if ((f.hasProblemsOnly || f.hasProblem) && !r.hasProblem) continue;
      if (f.overdueUnpaidOnly) {
        var ovInfo = isReservationOverdueUnpaid(
          r,
          (f.extensionsByResId && f.extensionsByResId[r.id]) || r.extensions,
          f.nowMs
        );
        if (!ovInfo.isOverdueUnpaid) continue;
      }

      var itemOut = Object.assign({}, r, { isFollowed: resolvedFollowed });
      if (userContext && userContext.user && !canViewCid) {
        itemOut.customerIdNumber = '';
      }
      out.push(itemOut);
    }

    var rawSortBy = normalizeStr(f.sortBy);
    if (!rawSortBy || rawSortBy === 'sourceOrder') {
      var hasSourceOrder = out.some(function (item) {
        var seq = Number(item && item.sourceOrder);
        return isFinite(seq) && seq > 0;
      });
      if (hasSourceOrder) {
        var seqDir = (rawSortBy === 'sourceOrder' && normalizeStr(f.sortDir).toLowerCase() === 'desc') ? -1 : 1;
        out = out.map(function (item, idx) {
          return { item: item, idx: idx };
        }).sort(function (a, b) {
          var sa = Number(a.item && a.item.sourceOrder);
          var sb = Number(b.item && b.item.sourceOrder);
          var validA = isFinite(sa) && sa > 0;
          var validB = isFinite(sb) && sb > 0;
          if (validA && validB) return sa !== sb ? ((sa - sb) * seqDir) : (a.idx - b.idx);
          if (validA && !validB) return -1;
          if (!validA && validB) return 1;
          return a.idx - b.idx;
        }).map(function (entry) { return entry.item; });
      }
      return out;
    }

    var sortBy = rawSortBy;
    var sortDir = normalizeStr(f.sortDir).toLowerCase() === 'asc' ? 1 : -1;
    out.sort(function (a, b) {
      var va = a[sortBy];
      var vb = b[sortBy];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
      return String(va || '').localeCompare(String(vb || '')) * sortDir;
    });

    return out;
  }

  function buildReservationQueryPayload(resState) {
    var s = (resState && typeof resState === 'object') ? resState : {};
    var pageNum = Number(s.page || 1);
    var pageSizeNum = Number(s.pageSize || 20);
    var resolvedSortBy = normalizeStr(s.sortBy) || 'sourceOrder';
    var resolvedSortDir = resolvedSortBy === 'sourceOrder'
      ? (normalizeStr(s.sortDir).toLowerCase() === 'desc' ? 'desc' : 'asc')
      : (normalizeStr(s.sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc');
    var payloadOut = {
      search: normalizeStr(s.search),
      reservationNumber: normalizeStr(s.reservationNumber),
      company: normalizeStr(s.company),
      branch: normalizeStr(s.branch),
      status: normalizeStr(s.status),
      employeeId: normalizeStr(s.employeeId),
      priority: normalizeStr(s.priority),
      dateFrom: normalizeStr(s.dateFrom),
      dateTo: normalizeStr(s.dateTo),
      timeField: normalizeStr(s.timeField || 'both') || 'both',
      timeFrom: normalizeStr(s.timeFrom),
      timeTo: normalizeStr(s.timeTo),
      unfollowedOnly: Boolean(s.unfollowedOnly),
      hasProblemsOnly: Boolean(s.hasProblemsOnly || s.hasProblem),
      overdueUnpaidOnly: Boolean(s.overdueUnpaidOnly),
      sortBy: resolvedSortBy,
      sortDir: resolvedSortDir,
      page: isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1,
      pageSize: isFinite(pageSizeNum) && pageSizeNum >= 1 ? Math.floor(pageSizeNum) : 20
    };
    var lifecycle = normalizeStr(s.lifecycle).toLowerCase();
    if (lifecycle) payloadOut.lifecycle = lifecycle;
    if (normalizeStr(s.companyNumber)) payloadOut.companyNumber = normalizeStr(s.companyNumber);
    if (normalizeStr(s.oldCompanyName)) payloadOut.oldCompanyName = normalizeStr(s.oldCompanyName);
    if (normalizeStr(s.newCompanyName)) payloadOut.newCompanyName = normalizeStr(s.newCompanyName);
    if (normalizeStr(s.rejectionReason)) payloadOut.rejectionReason = normalizeStr(s.rejectionReason);
    if (normalizeStr(s.cancellationReason)) payloadOut.cancellationReason = normalizeStr(s.cancellationReason);
    if (normalizeStr(s.confirmedByEmployee)) payloadOut.confirmedByEmployee = normalizeStr(s.confirmedByEmployee);
    return payloadOut;
  }

  function hasActiveReservationFilters(payload) {
    var f = (payload && typeof payload === 'object') ? payload : {};
    return Boolean(
      normalizeStr(f.search) ||
      normalizeStr(f.reservationNumber) ||
      normalizeStr(f.company) ||
      normalizeStr(f.branch) ||
      normalizeStr(f.status) ||
      normalizeStr(f.employeeId) ||
      normalizeStr(f.priority) ||
      normalizeStr(f.dateFrom) ||
      normalizeStr(f.dateTo) ||
      normalizeStr(f.timeFrom) ||
      normalizeStr(f.timeTo) ||
      f.unfollowedOnly ||
      f.hasProblemsOnly ||
      f.hasProblem ||
      f.overdueUnpaidOnly
    );
  }

  function doesReservationMatchFilters(reservation, followUps, filters, userContext) {
    if (!reservation || typeof reservation !== 'object') return false;
    return filterReservations([reservation], followUps, filters || {}, userContext).length > 0;
  }

  function reapplyReservationDeltaToFilteredList(currentItems, changedReservations, deletedIds, filters, followUps, userContext) {
    var base = Array.isArray(currentItems) ? currentItems.slice() : [];
    var changed = Array.isArray(changedReservations) ? changedReservations : [];
    var deleted = Array.isArray(deletedIds) ? deletedIds : [];
    var f = filters || {};

    var delMap = {};
    for (var d = 0; d < deleted.length; d++) {
      var did = normalizeStr(deleted[d]);
      if (did) delMap[did] = true;
    }

    var changedById = {};
    for (var c = 0; c < changed.length; c++) {
      var ch = changed[c];
      if (ch && ch.id) {
        changedById[String(ch.id)] = ch;
      }
    }

    var updatedBase = [];
    var newMatching = [];
    var seen = {};
    var removedCount = 0;
    var updatedCount = 0;
    var addedCount = 0;

    for (var i = 0; i < base.length; i++) {
      var cur = base[i];
      if (!cur || !cur.id) continue;
      var cid = String(cur.id);
      if (delMap[cid]) {
        removedCount++;
        continue;
      }
      if (seen[cid]) continue;
      seen[cid] = true;
      if (Object.prototype.hasOwnProperty.call(changedById, cid)) {
        var chRec = changedById[cid];
        var nextRec = Object.assign({}, cur, chRec);
        var rawChSeq = chRec && (chRec.sourceOrder !== undefined ? chRec.sourceOrder : chRec.source_order);
        var chSeq = (rawChSeq !== undefined && rawChSeq !== null && rawChSeq !== '') ? Number(rawChSeq) : NaN;
        var curSeq = (cur.sourceOrder !== undefined && cur.sourceOrder !== null && cur.sourceOrder !== '') ? Number(cur.sourceOrder) : NaN;
        if (!(isFinite(chSeq) && chSeq > 0) && isFinite(curSeq) && curSeq > 0) {
          nextRec.sourceOrder = Math.floor(curSeq);
        }
        if (doesReservationMatchFilters(nextRec, followUps, f, userContext)) {
          updatedBase.push(nextRec);
          updatedCount++;
        } else {
          removedCount++;
        }
      } else {
        if (doesReservationMatchFilters(cur, followUps, f, userContext)) {
          updatedBase.push(cur);
        } else {
          removedCount++;
        }
      }
    }

    for (var j = 0; j < changed.length; j++) {
      var chNew = changed[j];
      if (!chNew || !chNew.id) continue;
      var nid = String(chNew.id);
      if (delMap[nid] || seen[nid]) continue;
      seen[nid] = true;
      if (doesReservationMatchFilters(chNew, followUps, f, userContext)) {
        newMatching.push(chNew);
        addedCount++;
      }
    }

    var mergedPool = newMatching.concat(updatedBase);
    var sortedItems = filterReservations(mergedPool, followUps, f, userContext);
    return {
      items: sortedItems,
      removedCount: removedCount,
      updatedCount: updatedCount,
      addedCount: addedCount
    };
  }

  function filterProblemsList(problems, filters) {
    var list = Array.isArray(problems) ? problems : [];
    var f = (filters && typeof filters === 'object') ? filters : {};
    var st = normalizeStr(f.status);
    var pr = normalizeStr(f.priority);
    var empId = normalizeStr(f.employeeId);
    var search = normalizeStr(f.search);

    return list.filter(function (p) {
      if (!p || typeof p !== 'object') return false;
      if (st && normalizeStr(p.status) !== st) return false;
      if (pr && normalizeStr(p.priority) !== pr) return false;
      if (empId) {
        var ids = Array.isArray(p.assignedEmployeeIds) ? p.assignedEmployeeIds : [];
        if (ids.indexOf(empId) === -1) return false;
      }
      if (search && !matchesSearchFields([
        p.problemNumber,
        p.reservationNumber,
        p.customerName,
        p.description
      ], search)) {
        return false;
      }
      return true;
    });
  }

  function reapplyProblemDeltaToFilteredList(currentItems, changedProblems, deletedReservationIds, filters, deletedProblemIds) {
    var base = Array.isArray(currentItems) ? currentItems.slice() : [];
    var changed = Array.isArray(changedProblems) ? changedProblems : [];
    var delRes = Array.isArray(deletedReservationIds) ? deletedReservationIds : [];
    var delPrb = Array.isArray(deletedProblemIds) ? deletedProblemIds : [];
    var f = filters || {};

    var delResMap = {};
    for (var d = 0; d < delRes.length; d++) {
      var drid = normalizeStr(delRes[d]);
      if (drid) delResMap[drid] = true;
    }

    var delPrbMap = {};
    for (var dp = 0; dp < delPrb.length; dp++) {
      var dpid = normalizeStr(delPrb[dp]);
      if (dpid) delPrbMap[dpid] = true;
    }

    var changedById = {};
    for (var c = 0; c < changed.length; c++) {
      var ch = changed[c];
      if (ch && ch.id) changedById[String(ch.id)] = ch;
    }

    var out = [];
    var seen = {};

    for (var c2 = 0; c2 < changed.length; c2++) {
      var candNew = changed[c2];
      if (!candNew || !candNew.id) continue;
      var pidNew = String(candNew.id);
      if (delPrbMap[pidNew] || delResMap[normalizeStr(candNew.reservationId)]) continue;
      var isAlreadyInBase = base.some(function (x) { return x && String(x.id) === pidNew; });
      if (!isAlreadyInBase && !seen[pidNew]) {
        seen[pidNew] = true;
        if (filterProblemsList([candNew], f).length > 0) {
          out.push(candNew);
        }
      }
    }

    for (var i = 0; i < base.length; i++) {
      var cur = base[i];
      if (!cur || !cur.id) continue;
      var pid = String(cur.id);
      if (delPrbMap[pid] || delResMap[normalizeStr(cur.reservationId)] || seen[pid]) continue;
      seen[pid] = true;
      var resolved = Object.prototype.hasOwnProperty.call(changedById, pid)
        ? Object.assign({}, cur, changedById[pid])
        : cur;
      if (delPrbMap[normalizeStr(resolved.id)] || delResMap[normalizeStr(resolved.reservationId)]) continue;
      if (filterProblemsList([resolved], f).length > 0) {
        out.push(resolved);
      }
    }

    out.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
    return out;
  }

  function filterTeamFollowUpsList(followUps, filters) {
    var list = Array.isArray(followUps) ? followUps : [];
    var f = (filters && typeof filters === 'object') ? filters : {};
    var empId = normalizeStr(f.employeeId);
    var st = normalizeStr(f.status);
    var date = normalizeStr(f.date);
    var search = normalizeStr(f.search);

    return list.filter(function (item) {
      if (!item || typeof item !== 'object') return false;
      if (empId && normalizeStr(item.employeeId) !== empId) return false;
      if (st && normalizeStr(item.status) !== st) return false;
      if (date && normalizeStr(item.followUpDate) !== date) return false;
      if (search && !matchesSearchFields([
        item.reservationNumber,
        item.customerName,
        item.employeeName,
        item.action,
        item.notes
      ], search)) {
        return false;
      }
      return true;
    });
  }

  function reapplyFollowUpDeltaToFilteredList(currentItems, changedFollowUps, deletedReservationIds, filters, deletedFollowUpIds) {
    var base = Array.isArray(currentItems) ? currentItems.slice() : [];
    var changed = Array.isArray(changedFollowUps) ? changedFollowUps : [];
    var delRes = Array.isArray(deletedReservationIds) ? deletedReservationIds : [];
    var delFu = Array.isArray(deletedFollowUpIds) ? deletedFollowUpIds : [];
    var f = filters || {};

    var delResMap = {};
    for (var d = 0; d < delRes.length; d++) {
      var drid = normalizeStr(delRes[d]);
      if (drid) delResMap[drid] = true;
    }

    var delFuMap = {};
    for (var df = 0; df < delFu.length; df++) {
      var dfid = normalizeStr(delFu[df]);
      if (dfid) delFuMap[dfid] = true;
    }

    var changedById = {};
    for (var c = 0; c < changed.length; c++) {
      var ch = changed[c];
      if (ch && ch.id && !delFuMap[normalizeStr(ch.id)]) changedById[String(ch.id)] = ch;
    }

    var out = [];
    var seen = {};

    for (var c2 = 0; c2 < changed.length; c2++) {
      var candNew = changed[c2];
      if (!candNew || !candNew.id) continue;
      var fidNew = String(candNew.id);
      if (delFuMap[fidNew] || delResMap[normalizeStr(candNew.reservationId)]) continue;
      var isAlreadyInBase = base.some(function (x) { return x && String(x.id) === fidNew; });
      if (!isAlreadyInBase && !seen[fidNew]) {
        seen[fidNew] = true;
        if (filterTeamFollowUpsList([candNew], f).length > 0) {
          out.push(candNew);
        }
      }
    }

    for (var i = 0; i < base.length; i++) {
      var cur = base[i];
      if (!cur || !cur.id) continue;
      var fid = String(cur.id);
      if (delFuMap[fid] || delResMap[normalizeStr(cur.reservationId)] || seen[fid]) continue;
      seen[fid] = true;
      var resolved = Object.prototype.hasOwnProperty.call(changedById, fid)
        ? Object.assign({}, cur, changedById[fid])
        : cur;
      if (delFuMap[fid] || delResMap[normalizeStr(resolved.reservationId)]) continue;
      if (filterTeamFollowUpsList([resolved], f).length > 0) {
        out.push(resolved);
      }
    }

    out.sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return out;
  }

  function computeDashboardMetrics(reservations, followUps, problems, employees, dateRange, todayStr, options) {
    var today = todayStr || getRiyadhTodayDateStr();
    var start = (dateRange && dateRange.start) || '';
    var end = (dateRange && dateRange.end) || '';
    var opts = options || {};
    var excludedList = Array.isArray(opts.excludedEmployeeIds)
      ? opts.excludedEmployeeIds
      : (opts.statsControlConfig && Array.isArray(opts.statsControlConfig.excludedFromStatsEmployeeIds)
        ? opts.statsControlConfig.excludedFromStatsEmployeeIds
        : []);
    var excludedIdMap = {};
    for (var exi = 0; exi < excludedList.length; exi++) {
      var exId = normalizeStr(excludedList[exi]);
      if (exId) excludedIdMap[exId] = true;
    }
    var excludedNameMap = {};
    for (var empIdx = 0; empIdx < (employees || []).length; empIdx++) {
      var empItem = employees[empIdx];
      if (empItem && excludedIdMap[empItem.id] && empItem.name) {
        excludedNameMap[empItem.name] = true;
      }
    }

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
    var cancelledCount = 0;
    var rejectedCount = 0;

    for (var i = 0; i < filteredRes.length; i++) {
      var r = filteredRes[i];
      var st = r.internalStatus || 'تم الإنشاء';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      if (isCancelledStatus(r)) cancelledCount++;
      if (isInRejectedTab(r)) rejectedCount++;
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
      var isExcludedFu = (fu.employeeId && excludedIdMap[fu.employeeId]) || (!fu.employeeId && fu.employeeName && excludedNameMap[fu.employeeName]);
      if (!isExcludedFu && fu.employeeName) {
        empFollowUpCounts[fu.employeeName] = (empFollowUpCounts[fu.employeeName] || 0) + 1;
      }
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
      .filter(function (e) { return e && e.status === 'active' && !excludedIdMap[e.id]; })
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
        cancelled: cancelledCount,
        rejected: rejectedCount,
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

  function buildCacheBustedUrl(url, buildVersion) {
    var cleanUrl = normalizeStr(url);
    var ver = normalizeStr(buildVersion);
    if (!cleanUrl || !ver || ver === 'dev' || ver === 'local') return cleanUrl;
    var hashIdx = cleanUrl.indexOf('#');
    var basePart = hashIdx === -1 ? cleanUrl : cleanUrl.slice(0, hashIdx);
    var hashPart = hashIdx === -1 ? '' : cleanUrl.slice(hashIdx);
    if (/(?:[?&])v=/.test(basePart)) {
      return basePart.replace(/([?&]v=)[^&#]*/, '$1' + encodeURIComponent(ver)) + hashPart;
    }
    var sep = basePart.indexOf('?') === -1 ? '?' : '&';
    return basePart + sep + 'v=' + encodeURIComponent(ver) + hashPart;
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
    var seenSrcByBaseKey = {};
    var seenNoSrcBaseKey = {};
    var seenKeyBySrcId = {};
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var rawNum = extractReservationNumber(item);
      var srcId = extractSourceReservationId(item).replace(/^#+/, '').trim();
      var normNum = rawNum.replace(/^#+/, '').trim();
      if (!normNum && !srcId) continue;
      var baseKey = normNum || srcId;
      var itemPhone = normalizeStr(item.clientMobile || item.customerPhone || item.customer_phone || (item.customer && (item.customer.mobile || item.customer.phone)) || '').replace(/\D+/g, '');
      var finalKey = '';
      if (srcId && Object.prototype.hasOwnProperty.call(seenKeyBySrcId, srcId)) {
        finalKey = seenKeyBySrcId[srcId];
      } else if (srcId) {
        if (Object.prototype.hasOwnProperty.call(seenSrcByBaseKey, baseKey) && seenSrcByBaseKey[baseKey] && seenSrcByBaseKey[baseKey] !== srcId) {
          finalKey = baseKey + '::' + srcId;
        } else if (seenNoSrcBaseKey[baseKey]) {
          var prevNoSrc = map[baseKey];
          var prevNoSrcPhone = normalizeStr(prevNoSrc && (prevNoSrc.clientMobile || prevNoSrc.customerPhone || prevNoSrc.customer_phone || (prevNoSrc.customer && (prevNoSrc.customer.mobile || prevNoSrc.customer.phone)))).replace(/\D+/g, '');
          if (itemPhone && prevNoSrcPhone && itemPhone !== prevNoSrcPhone) {
            finalKey = baseKey + '::' + srcId;
          } else {
            finalKey = baseKey;
            seenSrcByBaseKey[baseKey] = srcId;
            delete seenNoSrcBaseKey[baseKey];
          }
        } else {
          finalKey = baseKey;
          seenSrcByBaseKey[baseKey] = srcId;
        }
        seenKeyBySrcId[srcId] = finalKey;
      } else {
        if (Object.prototype.hasOwnProperty.call(seenSrcByBaseKey, baseKey)) {
          var prevWithSrc = map[baseKey];
          var prevWithSrcPhone = normalizeStr(prevWithSrc && (prevWithSrc.clientMobile || prevWithSrc.customerPhone || prevWithSrc.customer_phone || (prevWithSrc.customer && (prevWithSrc.customer.mobile || prevWithSrc.customer.phone)))).replace(/\D+/g, '');
          if (itemPhone && prevWithSrcPhone && itemPhone !== prevWithSrcPhone) {
            finalKey = baseKey + '::row_' + i;
          } else {
            finalKey = baseKey;
          }
        } else {
          finalKey = baseKey;
          seenNoSrcBaseKey[baseKey] = true;
        }
      }
      if (!Object.prototype.hasOwnProperty.call(map, finalKey)) {
        order.push(finalKey);
        map[finalKey] = item;
      } else {
        var prev = map[finalKey];
        var merged = Object.assign({}, prev, item);
        var prevKeys = Object.keys(prev || {});
        for (var pk = 0; pk < prevKeys.length; pk++) {
          var k = prevKeys[pk];
          var nextEmpty = (merged[k] === undefined || merged[k] === null || merged[k] === '' || (Array.isArray(merged[k]) && merged[k].length === 0));
          var prevHas = (prev[k] !== undefined && prev[k] !== null && prev[k] !== '' && (!Array.isArray(prev[k]) || prev[k].length > 0));
          if (nextEmpty && prevHas) {
            merged[k] = prev[k];
          }
        }
        var mergedExtCode = extractReservationStatusCode(merged, true);
        if (isExplicitActiveStatusToken(mergedExtCode)) {
          merged.isSourceCancelled = false;
          merged.isSourceRejected = false;
        } else {
          if (prev.isSourceCancelled === true || item.isSourceCancelled === true) {
            merged.isSourceCancelled = true;
            merged.isSourceRejected = false;
          } else if (prev.isSourceRejected === true || item.isSourceRejected === true) {
            merged.isSourceRejected = true;
          }
        }
        map[finalKey] = merged;
      }
    }
    return order.map(function (k) { return map[k]; });
  }

  function dedupeEmployeesList(items) {
    var list = Array.isArray(items) ? items : [];
    var realUsernames = {};
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || typeof row !== 'object') continue;
      var rid = normalizeStr(row.id);
      if (!rid || rid.indexOf('EMP_OPT_') === 0) continue;
      var uname = normalizeLoginUsername(row.username || '');
      if (uname) realUsernames[uname] = true;
    }
    var byId = {};
    var idByUsername = {};
    var order = [];
    for (var j = 0; j < list.length; j++) {
      var emp = list[j];
      if (!emp || typeof emp !== 'object') continue;
      var eid = normalizeStr(emp.id);
      if (!eid) continue;
      var normUser = normalizeLoginUsername(emp.username || '');
      if (eid.indexOf('EMP_OPT_') === 0 && normUser && realUsernames[normUser]) {
        continue;
      }
      var targetId = eid;
      if (normUser && Object.prototype.hasOwnProperty.call(idByUsername, normUser) && idByUsername[normUser].indexOf('EMP_OPT_') !== 0 && eid.indexOf('EMP_OPT_') !== 0) {
        targetId = idByUsername[normUser];
      }
      if (!Object.prototype.hasOwnProperty.call(byId, targetId)) {
        order.push(targetId);
        byId[targetId] = emp;
        if (normUser && !idByUsername[normUser]) {
          idByUsername[normUser] = targetId;
        }
      } else {
        var prevEmp = byId[targetId];
        var mergedEmp = Object.assign({}, prevEmp, emp);
        if (eid !== targetId && targetId.indexOf('EMP_OPT_') !== 0) {
          mergedEmp.id = targetId;
        }
        byId[targetId] = mergedEmp;
      }
    }
    return order.map(function (idKey) { return byId[idKey]; });
  }

  function dedupeExtensionsByNumber(items) {
    var map = {};
    var order = [];
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var ext = list[i];
      if (!ext || typeof ext !== 'object') continue;
      var key = normalizeStr(
        ext.extensionNumber ||
        ext.extension_number ||
        ext.extendId ||
        ext.extend_id ||
        ext.code ||
        ext.id
      );
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
    // Multi-account GAS URLs (/macros/u/1/s/.../exec) break anonymous CORS/Anyone access; normalize cleanly
    clean = clean
      .replace(/^http:\/\//i, 'https://')
      .replace(/(\/macros)\/u\/\d+(\/s\/)/i, '$1$2')
      .replace(/([?&])authuser=\d+&?/i, '$1')
      .replace(/[?&]$/, '');
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
      if (k === 'visibleCols' || k === 'silentRefresh' || k === 'abortKey' || k.charAt(0) === '_') continue;
      var v = payload[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  function getGasActionTimeoutMs(action) {
    var key = normalizeStr(action);
    if (key === 'pullReservations' || key === 'syncRentalGate' || key === 'retryFailedSyncRecords' || key === 'exportReportData' || key === 'getReports') {
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
      var missingFnMatch = trimmed.match(/Script function not found:\s*([A-Za-z0-9_]+)/i);
      if (missingFnMatch) {
        var missingFn = missingFnMatch[1];
        return {
          success: false,
          message: 'خطأ من Google Apps Script: الدالة (' + missingFn + ') غير موجودة في الإصدار المنشور على رابط /exec. الحل: (1) تأكد من وجود ملف google-apps-script/Code.gs كاملاً داخل مشروع Apps Script وحفظه (Ctrl+S)، (2) من المحرر اختر Deploy <- Manage deployments <- تعديل (Edit) <- Version: New version <- Deploy لأن رابط /exec لا يقرأ التعديلات بدون نشر إصدار جديد.',
          data: { missingFunction: missingFn },
          error: 'GAS_MISSING_HANDLER'
        };
      }
      if (/accounts\.google\.com|ServiceLogin/i.test(trimmed)) {
        return {
          success: false,
          message: 'الرابط محمي بحساب Google لأن خيار Who has access لم يُضبط على Anyone. من محرر Apps Script: Deploy -> Manage deployments -> Edit -> Who has access: Anyone ثم Deploy.',
          data: null,
          error: 'GAS_AUTH_REQUIRED'
        };
      }
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

  function parseBackendResponseText(rawText, httpStatus, contentType) {
    var status = Number(httpStatus || 0);
    var trimmed = normalizeStr(rawText);
    var cType = normalizeStr(contentType).toLowerCase();

    if (!trimmed) {
      if (status === 404 || status === 405) {
        return {
          success: false,
          message: 'نقطة النهاية /api/crm غير متاحة على هذه الاستضافة (HTTP ' + status + ').',
          data: null,
          error: 'BACKEND_NOT_FOUND'
        };
      }
      if (status === 502 || status === 504) {
        return {
          success: false,
          message: 'انتهت مهلة أو تعذر اتصال خادم Vercel بقاعدة البيانات (HTTP ' + status + '). تحقق من رابط DATABASE_URL وحالة Neon.',
          data: null,
          error: 'GATEWAY_ERROR'
        };
      }
      return {
        success: false,
        message: 'أعاد خادم قاعدة البيانات السحابية استجابة فارغة (HTTP ' + status + '). تأكد من ضبط متغير DATABASE_URL في Vercel ومراجعة سجلات الخادم (Logs).',
        data: null,
        error: 'EMPTY_RESPONSE'
      };
    }

    if (trimmed.charAt(0) === '<' || /^<!doctype/i.test(trimmed) || cType.indexOf('text/html') !== -1) {
      return {
        success: false,
        message: 'أعاد الخادم صفحة HTML بدلاً من JSON (HTTP ' + status + '). تأكد من توجيه مسار /api/crm إلى Serverless Function وليس إلى index.html.',
        data: null,
        error: 'HTML_RESPONSE'
      };
    }

    try {
      var parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') {
        return {
          success: false,
          message: 'صيغة استجابة الخادم السحابي غير صالحة (HTTP ' + status + ').',
          data: null,
          error: 'INVALID_RESPONSE'
        };
      }
      if (status >= 400 && parsed.success !== false) {
        return Object.assign({}, parsed, {
          success: false,
          message: parsed.message || ('خطأ من خادم قاعدة البيانات السحابية (HTTP ' + status + ').'),
          error: parsed.error || ('HTTP_' + status)
        });
      }
      return parsed;
    } catch (e) {
      var preview = trimmed.replace(/\s+/g, ' ').slice(0, 140);
      return {
        success: false,
        message: 'تعذر قراءة استجابة الخادم السحابي كـ JSON (HTTP ' + status + '): ' + preview,
        data: null,
        error: 'INVALID_JSON'
      };
    }
  }

  var API_CACHE_POLICIES = {
    getAppBootstrap: { cacheable: false, ttlMs: 0, scope: 'dashboard' },
    getMe: { cacheable: true, ttlMs: 300000, scope: 'employees' },
    getEmployees: { cacheable: true, ttlMs: 300000, scope: 'employees' },
    getEmployeeDetails: { cacheable: true, ttlMs: 60000, scope: 'employees' },
    getDashboard: { cacheable: true, ttlMs: 60000, scope: 'dashboard' },
    getCustomers: { cacheable: true, ttlMs: 60000, scope: 'customers' },
    getCustomerDetails: { cacheable: true, ttlMs: 45000, scope: 'customers' },
    getCustomerNotes: { cacheable: true, ttlMs: 30000, scope: 'customers' },
    getCustomerNoteStatuses: { cacheable: true, ttlMs: 60000, scope: 'customers' },
    getCustomerNotesConfig: { cacheable: true, ttlMs: 60000, scope: 'settings' },
    getCustomerNoteHistory: { cacheable: false, ttlMs: 0, scope: 'customers' },
    getDataIntegrityReport: { cacheable: false, ttlMs: 0, scope: 'settings' },
    getDataIntegritySettings: { cacheable: false, ttlMs: 0, scope: 'settings' },
    getTodayAndRadar: { cacheable: true, ttlMs: 25000, scope: 'todayRadar' },
    getReservations: { cacheable: true, ttlMs: 60000, scope: 'reservations' },
    getInactiveReservations: { cacheable: true, ttlMs: 45000, scope: 'reservations' },
    searchCustomerByNationalId: { cacheable: false, ttlMs: 0, scope: 'reservations' },
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
    getTriggerStatus: { cacheable: true, ttlMs: 60000, scope: 'sync' },
    getAnnouncements: { cacheable: true, ttlMs: 15000, scope: 'announcements' },
    getDelegations: { cacheable: true, ttlMs: 30000, scope: 'employees' },
    getReservationLocks: { cacheable: false, ttlMs: 0, scope: 'reservations' },
    getDeltaSync: { cacheable: false, ttlMs: 0, scope: 'sync' }
  };

  var MUTATION_INVALIDATIONS = {
    login: ['*'],
    logout: ['*'],
    createCustomer: ['customers', 'dashboard', 'activity', 'reports'],
    updateCustomerProfile: ['customers', 'reservations', 'dashboard', 'activity', 'reports'],
    addCustomerNote: ['customers', 'reservations', 'problems', 'followUps', 'notifications', 'activity'],
    updateCustomerNote: ['customers', 'reservations', 'problems', 'followUps', 'notifications', 'activity'],
    deleteCustomerNote: ['customers', 'reservations', 'problems', 'followUps', 'activity'],
    changeCustomerNoteStatus: ['customers', 'reservations', 'problems', 'notifications', 'activity'],
    assignCustomerNoteEmployee: ['customers', 'reservations', 'problems', 'employees', 'notifications', 'activity'],
    addCustomerNoteAttachment: ['customers', 'reservations', 'problems', 'activity'],
    deleteCustomerNoteAttachment: ['customers', 'reservations', 'problems', 'activity'],
    saveCustomerNoteStatus: ['customers', 'settings', 'activity'],
    toggleCustomerNoteStatus: ['customers', 'settings', 'activity'],
    deleteCustomerNoteStatus: ['customers', 'settings', 'activity'],
    saveCustomerNotesConfig: ['customers', 'settings', 'reservations', 'problems', 'activity'],
    runDataIntegrityCheck: ['settings', 'activity'],
    recheckDataIntegrityRecord: ['settings', 'activity'],
    resolveDataIntegrityIssue: ['reservations', 'customers', 'todayRadar', 'dashboard', 'settings', 'activity'],
    rollbackDataIntegrityAction: ['reservations', 'customers', 'todayRadar', 'dashboard', 'settings', 'activity'],
    saveDataIntegritySettings: ['settings', 'activity'],
    controlDataIntegrityMonitor: ['settings', 'activity'],
    claimReservation: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'activity', 'reports'],
    unclaimReservation: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'activity', 'reports'],
    quickUpdateReservationStatus: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    rejectReservation: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    cancelReservation: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    restoreReservation: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    updateReservationDetails: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'activity', 'reports'],
    saveReservationPinnedNote: ['reservations', 'customers', 'todayRadar', 'followUps', 'activity'],
    togglePinnedCriticalReservation: ['followUps', 'reservations'],
    recordNoAnswerFollowUp: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    addFollowUp: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    updateFollowUp: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    deleteFollowUp: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    assignEmployees: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    removeAssignment: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'activity', 'reports'],
    bulkReassignEmployeeReservations: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    bulkReassignSelectedReservations: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    createProblem: ['reservations', 'customers', 'todayRadar', 'problems', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    updateProblem: ['reservations', 'customers', 'todayRadar', 'problems', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    deleteProblem: ['reservations', 'customers', 'todayRadar', 'problems', 'dashboard', 'employees', 'notifications', 'activity', 'reports'],
    createEmployee: ['employees', 'dashboard', 'activity', 'reports'],
    updateEmployee: ['employees', 'customers', 'dashboard', 'activity', 'reports'],
    saveEmployeeUiOverrides: ['employees', 'settings', 'dashboard', 'activity'],
    saveRoleUiDefaults: ['employees', 'settings', 'dashboard', 'activity'],
    restoreUiDefaults: ['employees', 'settings', 'dashboard', 'activity'],
    disableEmployee: ['employees', 'customers', 'dashboard', 'activity', 'reports'],
    deleteEmployee: ['employees', 'customers', 'reservations', 'todayRadar', 'problems', 'dashboard', 'activity', 'reports'],
    saveDelegation: ['employees', 'activity', 'notifications'],
    revokeDelegation: ['employees', 'activity', 'notifications'],
    saveAnnouncement: ['announcements', 'dashboard', 'activity'],
    deleteAnnouncement: ['announcements', 'dashboard', 'activity'],
    acquireReservationLock: [],
    releaseReservationLock: [],
    saveRolePreset: ['employees', 'activity'],
    deleteRolePreset: ['employees', 'activity'],
    resetRolePresets: ['employees', 'activity'],
    savePermissionDefinition: ['employees', 'activity'],
    deletePermissionDefinition: ['employees', 'activity'],
    markNotificationRead: ['notifications'],
    deleteNotification: ['notifications'],
    pullReservations: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'sync', 'activity', 'reports'],
    importReservationsFromExcel: ['reservations', 'customers', 'todayRadar', 'followUps', 'dashboard', 'employees', 'activity', 'reports'],
    syncRentalGate: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'sync', 'activity', 'reports'],
    retryFailedSyncRecords: ['reservations', 'customers', 'todayRadar', 'dashboard', 'employees', 'sync', 'activity', 'reports'],
    saveApiToken: ['settings', 'sync', 'activity'],
    saveGlobalConnectionSettings: ['settings', 'sync', 'activity'],
    applyUnifiedConnectionSetup: ['*'],
    updateSettings: ['settings', 'sync', 'reservations', 'customers', 'todayRadar', 'dashboard', 'reports', 'activity'],
    saveUserLayoutPrefs: ['dashboard', 'employees'],
    deleteAllReservations: ['*']
  };

  function getApiCachePolicy(action) {
    var key = normalizeStr(action);
    return API_CACHE_POLICIES[key] || { cacheable: false, ttlMs: 0, scope: '' };
  }

  var RESERVATION_UI_ONLY_KEYS = {
    visibleCols: true,
    forceRefresh: true,
    silentRefresh: true,
    abortKey: true,
    clientRequestId: true,
    nowMs: true,
    _keepOptimisticCache: true,
    _spamChecked: true,
    _replayingOfflineQueue: true,
    originTabId: true,
    selectedResIds: true,
    expandedRowIds: true,
    viewMode: true,
    tab: true,
    inactiveSubTab: true,
    radarFilter: true,
    radarSearch: true,
    todayFilter: true,
    todaySearch: true,
    todayTimeFrom: true,
    todayTimeTo: true,
    todayDisplayMode: true,
    todayCalendarGranularity: true,
    todayCalendarAnchorDate: true,
    todayCalendarEventFilter: true,
    todayCalendarSearch: true,
    pullPreset: true,
    pullFrom: true,
    pullTo: true
  };

  function stableSerializePayload(payload) {
    if (!payload || typeof payload !== 'object') return '{}';
    var keys = Object.keys(payload).filter(function (k) {
      return !RESERVATION_UI_ONLY_KEYS[k] && payload[k] !== undefined;
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

  function normalizeEmployeeEmail(raw) {
    return normalizeStr(raw).toLowerCase();
  }

  function normalizeEmployeePhone(raw) {
    var s = convertEasternDigitsToAscii(normalizeStr(raw));
    if (!s) return '';
    var digits = s.replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.indexOf('00966') === 0) digits = digits.slice(5);
    else if (digits.indexOf('966') === 0 && digits.length >= 11) digits = digits.slice(3);
    if (digits.length === 9 && digits.charAt(0) === '5') {
      digits = '0' + digits;
    }
    return digits;
  }

  var RESERVATION_REPORT_COLUMNS = [
    { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 1.38, formatType: 'ltr' },
    { key: 'customerName', label: 'اسم العميل', labelEn: 'Customer Name', widthWeight: 1.4, formatType: 'text' },
    { key: 'customerPhone', label: 'الجوال', labelEn: 'Phone', widthWeight: 1.28, formatType: 'ltr' },
    { key: 'companyName', label: 'الشركة', labelEn: 'Company', widthWeight: 1.15, formatType: 'text' },
    { key: 'branchName', label: 'الفرع', labelEn: 'Branch', widthWeight: 1.2, formatType: 'text' },
    { key: 'carName', label: 'السيارة', labelEn: 'Vehicle', widthWeight: 1.25, formatType: 'text' },
    { key: 'startDate', label: 'بداية الحجز', labelEn: 'Start Date', widthWeight: 1.18, formatType: 'date' },
    { key: 'endDate', label: 'نهاية الحجز', labelEn: 'End Date', widthWeight: 1.18, formatType: 'date' },
    { key: 'extensionsCount', label: 'مرات التمديد', labelEn: 'Extensions #', widthWeight: 0.68, formatType: 'number' },
    { key: 'extendedUntilDate', label: 'التمديد لحد', labelEn: 'Extended Until', widthWeight: 1.18, formatType: 'date' },
    { key: 'extensionsAmount', label: 'سعر التمديد', labelEn: 'Ext. Amount', widthWeight: 0.72, formatType: 'number' },
    { key: 'originalStatusAr', label: 'حالة الحجز الأصلية', labelEn: 'Original Status', widthWeight: 1.0, formatType: 'text' },
    { key: 'internalStatus', label: 'حالة المتابعة الداخلية', labelEn: 'Internal Status', widthWeight: 1.05, formatType: 'text' },
    { key: 'assignedEmployeeNames', label: 'الموظفون المسؤولون', labelEn: 'Assigned Staff', widthWeight: 1.25, formatType: 'list' },
    { key: 'priority', label: 'الأولوية', labelEn: 'Priority', widthWeight: 0.68, formatType: 'text' },
    { key: 'totalAmount', label: 'الإجمالي', labelEn: 'Total (SAR)', widthWeight: 0.78, formatType: 'number' },
    { key: 'lastUpdateText', label: 'آخر تحديث', labelEn: 'Last Update', widthWeight: 1.55, formatType: 'text' },
    { key: 'lastUpdatedByName', label: 'آخر موظف', labelEn: 'Updated By', widthWeight: 0.95, formatType: 'text' }
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
      { key: 'followUpTime', label: 'الوقت', labelEn: 'Time', widthWeight: 0.75, formatType: 'time' }
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
      { key: 'extensionNumber', label: 'رقم التمديد', labelEn: 'Extension #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Reservation #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'extensionTypeAr', label: 'نوع التمديد', labelEn: 'Type', widthWeight: 1.15, formatType: 'text' },
      { key: 'statusAr', label: 'الحالة', labelEn: 'Status', widthWeight: 0.95, formatType: 'text' },
      { key: 'paymentStatus', label: 'حالة الدفع', labelEn: 'Payment', widthWeight: 0.85, formatType: 'text' },
      { key: 'extendDays', label: 'أيام التمديد', labelEn: 'Days', widthWeight: 0.75, formatType: 'number' },
      { key: 'startDate', label: 'بداية التمديد', labelEn: 'Start Date', widthWeight: 0.95, formatType: 'date' },
      { key: 'endDate', label: 'التمديد لحد', labelEn: 'Extended Until', widthWeight: 0.95, formatType: 'date' },
      { key: 'amount', label: 'سعر التمديد (ر.س)', labelEn: 'Amount', widthWeight: 0.9, formatType: 'number' }
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
      { key: 'logTime', label: 'الوقت', labelEn: 'Time', widthWeight: 0.8, formatType: 'time' }
    ],
    customers: [
      { key: 'fullName', label: 'اسم العميل', labelEn: 'Customer Name', widthWeight: 1.45, formatType: 'text' },
      { key: 'countryCode', label: 'مفتاح الدولة', labelEn: 'Code', widthWeight: 0.72, formatType: 'ltr' },
      { key: 'phone', label: 'رقم الجوال', labelEn: 'Phone', widthWeight: 1.18, formatType: 'ltr' },
      { key: 'email', label: 'البريد الإلكتروني', labelEn: 'Email', widthWeight: 1.3, formatType: 'ltr' },
      { key: 'idNumber', label: 'رقم الهوية / الإقامة / الجواز', labelEn: 'ID / Passport', widthWeight: 1.15, formatType: 'ltr' },
      { key: 'bookingsCount', label: 'عدد الحجوزات', labelEn: 'Bookings', widthWeight: 0.72, formatType: 'number' },
      { key: 'activeBookingsCount', label: 'النشطة', labelEn: 'Active', widthWeight: 0.65, formatType: 'number' },
      { key: 'pastBookingsCount', label: 'السابقة', labelEn: 'Past', widthWeight: 0.65, formatType: 'number' },
      { key: 'extensionsCount', label: 'التمديدات', labelEn: 'Extensions', widthWeight: 0.68, formatType: 'number' },
      { key: 'openProblemsCount', label: 'المشاكل المفتوحة', labelEn: 'Open Problems', widthWeight: 0.75, formatType: 'number' },
      { key: 'lastReservationNumber', label: 'آخر حجز', labelEn: 'Last Booking #', widthWeight: 0.95, formatType: 'ltr' },
      { key: 'lastReservationDate', label: 'تاريخ آخر حجز', labelEn: 'Last Booking', widthWeight: 0.95, formatType: 'date' },
      { key: 'lastContactAt', label: 'آخر تواصل', labelEn: 'Last Contact', widthWeight: 1.05, formatType: 'datetime' },
      { key: 'lastReservationStatus', label: 'حالة آخر حجز', labelEn: 'Last Booking Status', widthWeight: 0.95, formatType: 'text' },
      { key: 'createdAt', label: 'تاريخ الإنشاء', labelEn: 'Created At', widthWeight: 0.95, formatType: 'date' }
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
    if (ft === 'time') {
      return formatTimePreference(val, opts.timeFormat, lang) || String(val);
    }
    if (ft === 'datetime') {
      return formatDateTimePreference(val, opts.timeFormat, lang) || String(val);
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

  function computePdfColumnWidths(columns, totalWidth, customWidthsMap) {
    var cols = Array.isArray(columns) ? columns : [];
    var totalW = Number(totalWidth || 0);
    if (!cols.length || totalW <= 0) return [];
    var customMap = (customWidthsMap && typeof customWidthsMap === 'object') ? customWidthsMap : null;
    var weights = cols.map(function (c) {
      var customVal = (customMap && c && c.key && customMap[c.key] !== undefined)
        ? Number(customMap[c.key])
        : (c && c.customWidthWeight !== undefined ? Number(c.customWidthWeight) : NaN);
      if (isFinite(customVal) && customVal > 0) return customVal;
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

  function wrapTextPreservingNewlines(measureFn, text, maxWidth, options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var measure = typeof measureFn === 'function' ? measureFn : function (s) { return String(s || '').length * 6; };
    var preserveBreaks = opts.preserveLineBreaks !== false;
    var unclipped = Boolean(opts.unclipped);
    var maxLines = (!unclipped && opts.maxLines && Number(opts.maxLines) > 0) ? Math.floor(Number(opts.maxLines)) : 0;
    var emptyFallback = opts.emptyFallback !== undefined ? String(opts.emptyFallback) : '-';
    var rawInput = text === undefined || text === null ? '' : String(text);

    if (!preserveBreaks) {
      rawInput = rawInput.replace(/\s+/g, ' ').trim();
    } else {
      rawInput = rawInput.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    if (!rawInput.trim()) return [emptyFallback];

    var paragraphs = preserveBreaks ? rawInput.split('\n') : [rawInput];
    while (paragraphs.length > 1 && !paragraphs[0].trim()) paragraphs.shift();
    while (paragraphs.length > 1 && !paragraphs[paragraphs.length - 1].trim()) paragraphs.pop();

    var safeMaxW = Math.max(20, Number(maxWidth || 200));
    var outLines = [];
    var truncated = false;

    for (var pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      var para = String(paragraphs[pIdx] || '').replace(/[ \t]+/g, ' ').trim();
      if (!para) {
        if (preserveBreaks) {
          if (maxLines && outLines.length >= maxLines) {
            truncated = true;
            break;
          }
          outLines.push('');
        }
        continue;
      }

      if (measure(para) <= safeMaxW) {
        if (maxLines && outLines.length >= maxLines) {
          truncated = true;
          break;
        }
        outLines.push(para);
        continue;
      }

      var words = para.split(' ');
      var current = '';
      for (var wIdx = 0; wIdx < words.length; wIdx++) {
        var word = words[wIdx];
        var candidate = current ? (current + ' ' + word) : word;
        if (measure(candidate) <= safeMaxW) {
          current = candidate;
        } else {
          if (current) {
            outLines.push(current);
            current = '';
            if (maxLines && outLines.length >= maxLines) {
              truncated = true;
              break;
            }
          }
          if (measure(word) > safeMaxW) {
            var part = '';
            for (var chIdx = 0; chIdx < word.length; chIdx++) {
              var nextPart = part + word.charAt(chIdx);
              if (measure(nextPart) > safeMaxW && part) {
                outLines.push(part);
                part = word.charAt(chIdx);
                if (maxLines && outLines.length >= maxLines) {
                  part = '';
                  truncated = true;
                  break;
                }
              } else {
                part = nextPart;
              }
            }
            if (truncated) break;
            current = part;
          } else {
            current = word;
          }
        }
      }

      if (truncated) break;
      if (current) {
        if (maxLines && outLines.length >= maxLines) {
          truncated = true;
          break;
        }
        outLines.push(current);
      }
    }

    if (maxLines && outLines.length > maxLines) {
      outLines = outLines.slice(0, maxLines);
      truncated = true;
    }
    if (maxLines && truncated && outLines.length === maxLines) {
      var last = outLines[outLines.length - 1];
      while (last.length > 2 && measure(last + '…') > safeMaxW) {
        last = last.slice(0, -1);
      }
      outLines[outLines.length - 1] = last + '…';
    }
    return outLines.length ? outLines : [emptyFallback];
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
      case 'saveReservationPinnedNote':
      case 'togglePinnedCriticalReservation':
      case 'recordNoAnswerFollowUp':
      case 'assignEmployees':
      case 'addFollowUp':
      case 'createProblem':
        return act + ':' + normalizeStr(p.reservationId || p.reservationNumber);
      case 'removeAssignment':
        return act + ':' + normalizeStr(p.reservationId) + ':' + normalizeStr(p.employeeId);
      case 'updateFollowUp':
      case 'deleteFollowUp':
        return act + ':' + normalizeStr(p.followUpId || p.id);
      case 'updateProblem':
      case 'deleteProblem':
        return act + ':' + normalizeStr(p.problemId || p.id);
      case 'markNotificationRead':
        return act + ':' + (p.markAll ? 'ALL' : normalizeStr(p.notificationId));
      case 'deleteNotification':
        return act + ':' + (p.deleteAll ? 'ALL' : normalizeStr(p.notificationId || p.id));
      case 'createEmployee':
        return act + ':' + normalizeLoginUsername(p.username || p.name);
      case 'updateEmployee':
      case 'disableEmployee':
      case 'deleteEmployee':
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
    if (entityType === 'Problem' || type === 'new_problem' || type === 'high_priority_problem' || type === 'problem_resolved') {
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

  var DELETE_ALL_RESERVATIONS_PHRASE = 'حذف جميع الحجوزات';

  function normalizeAutoSyncInterval(hoursVal, minutesVal, totalMinutesVal) {
    var hasHours = hoursVal !== undefined && hoursVal !== null && String(hoursVal).trim() !== '';
    var hasMinutes = minutesVal !== undefined && minutesVal !== null && String(minutesVal).trim() !== '';
    var hasTotal = totalMinutesVal !== undefined && totalMinutesVal !== null && String(totalMinutesVal).trim() !== '';

    var totalMinutes;
    if (hasTotal && !hasHours && !hasMinutes) {
      var parsedTotal = Number(totalMinutesVal);
      totalMinutes = isFinite(parsedTotal) ? Math.round(parsedTotal) : 720;
    } else if (!hasHours && !hasMinutes) {
      totalMinutes = 720;
    } else {
      var rawH = hasHours ? Number(hoursVal) : 0;
      var rawM = hasMinutes ? Number(minutesVal) : 0;
      if (!isFinite(rawH)) rawH = 0;
      if (!isFinite(rawM)) rawM = 0;
      totalMinutes = Math.round(Math.max(0, rawH) * 60 + Math.max(0, rawM));
    }

    if (!isFinite(totalMinutes) || totalMinutes < 1) totalMinutes = 1;
    if (totalMinutes > 10080) totalMinutes = 10080;

    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      totalMinutes: totalMinutes
    };
  }

  function formatAutoSyncIntervalAr(hoursVal, minutesVal) {
    var norm = normalizeAutoSyncInterval(hoursVal, minutesVal);
    var h = norm.hours;
    var m = norm.minutes;
    var hText = '';
    if (h > 0) {
      hText = h === 1 ? 'ساعة' : (h === 2 ? 'ساعتين' : (h + ' ساعة'));
    }
    var mText = '';
    if (m > 0) {
      mText = m === 1 ? 'دقيقة' : (m === 2 ? 'دقيقتين' : (m <= 10 ? (m + ' دقائق') : (m + ' دقيقة')));
    }
    if (hText && mText) return 'كل ' + hText + ' و' + mText;
    if (hText) return 'كل ' + hText;
    return 'كل ' + mText;
  }

  var MIN_AUTO_SYNC_SECONDS = 1;
  var MAX_AUTO_SYNC_SECONDS = 43200; // 12 hours

  function normalizeAutoSyncUnitCore(rawUnit) {
    var u = normalizeStr(rawUnit).toLowerCase();
    if (u === 'seconds' || u === 'second' || u === 's' || u === 'sec') return 'seconds';
    if (u === 'minutes' || u === 'minute' || u === 'm' || u === 'min') return 'minutes';
    if (u === 'hours' || u === 'hour' || u === 'h' || u === 'hr') return 'hours';
    return 'seconds';
  }

  function unitSecondsMultiplierCore(unit) {
    if (unit === 'hours') return 3600;
    if (unit === 'minutes') return 60;
    return 1;
  }

  function deriveBestSyncValueUnitCore(intervalSeconds) {
    var sec = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(Number(intervalSeconds) || 43200)));
    if (sec % 3600 === 0) return { value: sec / 3600, unit: 'hours' };
    if (sec % 60 === 0) return { value: sec / 60, unit: 'minutes' };
    return { value: sec, unit: 'seconds' };
  }

  function validateAutoSyncInterval(input) {
    var obj = (input && typeof input === 'object') ? input : {};
    var hasValue = obj.value !== undefined && obj.value !== null && convertEasternDigitsToAscii(String(obj.value)).trim() !== '';
    var hasSec = obj.intervalSeconds !== undefined && obj.intervalSeconds !== null && convertEasternDigitsToAscii(String(obj.intervalSeconds)).trim() !== '';
    var unit = normalizeAutoSyncUnitCore(obj.unit || 'seconds');
    var intervalSeconds = 43200;
    var value = 12;

    if (hasValue) {
      var strVal = convertEasternDigitsToAscii(String(obj.value)).trim();
      var numVal = Number(strVal);
      if (!strVal || !isFinite(numVal)) {
        return {
          valid: false,
          error: 'يرجى إدخال قيمة رقمية صحيحة لفترة المزامنة التلقائية.',
          intervalSeconds: 43200,
          value: 12,
          unit: 'hours',
          hours: 12,
          minutes: 0
        };
      }
      var exactSec = numVal * unitSecondsMultiplierCore(unit);
      if (exactSec < MIN_AUTO_SYNC_SECONDS) {
        return {
          valid: false,
          error: 'الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).',
          intervalSeconds: MIN_AUTO_SYNC_SECONDS,
          value: numVal,
          unit: unit,
          hours: 0,
          minutes: 1
        };
      }
      if (exactSec > MAX_AUTO_SYNC_SECONDS) {
        return {
          valid: false,
          error: 'الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
          intervalSeconds: MAX_AUTO_SYNC_SECONDS,
          value: numVal,
          unit: unit,
          hours: 12,
          minutes: 0
        };
      }
      intervalSeconds = Math.round(exactSec);
      if (Math.floor(numVal) === numVal) {
        value = numVal;
      } else {
        var best = deriveBestSyncValueUnitCore(intervalSeconds);
        value = best.value;
        unit = best.unit;
      }
    } else if (hasSec) {
      var secNum = Number(convertEasternDigitsToAscii(String(obj.intervalSeconds)).trim());
      if (!isFinite(secNum) || secNum < MIN_AUTO_SYNC_SECONDS) {
        return {
          valid: false,
          error: 'الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).',
          intervalSeconds: MIN_AUTO_SYNC_SECONDS,
          value: secNum,
          unit: 'seconds',
          hours: 0,
          minutes: 1
        };
      }
      if (secNum > MAX_AUTO_SYNC_SECONDS) {
        return {
          valid: false,
          error: 'الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
          intervalSeconds: MAX_AUTO_SYNC_SECONDS,
          value: secNum,
          unit: 'seconds',
          hours: 12,
          minutes: 0
        };
      }
      intervalSeconds = Math.round(secNum);
      var bestFromSec = deriveBestSyncValueUnitCore(intervalSeconds);
      value = bestFromSec.value;
      unit = bestFromSec.unit;
    } else {
      var h = Number(convertEasternDigitsToAscii(String(obj.hours !== undefined ? obj.hours : 12)).trim() || '0');
      var m = Number(convertEasternDigitsToAscii(String(obj.minutes !== undefined ? obj.minutes : 0)).trim() || '0');
      var totalSec = Math.round((isFinite(h) ? h : 0) * 3600 + (isFinite(m) ? m : 0) * 60);
      if (totalSec < MIN_AUTO_SYNC_SECONDS || totalSec > MAX_AUTO_SYNC_SECONDS) {
        return {
          valid: false,
          error: totalSec < MIN_AUTO_SYNC_SECONDS
            ? 'الحد الأدنى للفترة الزمنية للمزامنة التلقائية هو ثانية واحدة (1 ثانية).'
            : 'الحد الأقصى للفترة الزمنية للمزامنة التلقائية هو 12 ساعة (43,200 ثانية).',
          intervalSeconds: Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, totalSec || 1)),
          value: 12,
          unit: 'hours',
          hours: 12,
          minutes: 0
        };
      }
      intervalSeconds = totalSec;
      var bestLegacy = deriveBestSyncValueUnitCore(intervalSeconds);
      value = bestLegacy.value;
      unit = bestLegacy.unit;
    }

    var totalMinLegacy = Math.max(1, Math.round(intervalSeconds / 60));
    return {
      valid: true,
      error: '',
      intervalSeconds: intervalSeconds,
      value: value,
      unit: unit,
      hours: Math.floor(totalMinLegacy / 60),
      minutes: totalMinLegacy % 60
    };
  }

  function normalizeAutoSyncIntervalSeconds(settingsOrInput) {
    var s = (settingsOrInput && typeof settingsOrInput === 'object') ? settingsOrInput : { intervalSeconds: settingsOrInput };
    var hasSec = s.auto_sync_interval_seconds !== undefined || s.intervalSeconds !== undefined;
    var hasValueUnit = s.value !== undefined || s.auto_sync_interval_value !== undefined;
    var rawSec = s.auto_sync_interval_seconds !== undefined ? s.auto_sync_interval_seconds : s.intervalSeconds;
    var rawVal = s.auto_sync_interval_value !== undefined ? s.auto_sync_interval_value : s.value;
    var rawUnit = s.auto_sync_interval_unit !== undefined ? s.auto_sync_interval_unit : s.unit;

    var sec = 43200;
    if (hasSec && rawSec !== null && String(rawSec).trim() !== '') {
      var pSec = Number(convertEasternDigitsToAscii(String(rawSec)).trim());
      if (isFinite(pSec) && pSec > 0) {
        sec = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(pSec)));
      }
    } else if (hasValueUnit && rawVal !== null && String(rawVal).trim() !== '') {
      var vCheck = validateAutoSyncInterval({ value: rawVal, unit: rawUnit || 'seconds' });
      sec = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, vCheck.intervalSeconds));
    } else if (s.auto_sync_interval_hours !== undefined || s.auto_sync_interval_minutes !== undefined || s.hours !== undefined || s.minutes !== undefined) {
      var hVal = Number(s.auto_sync_interval_hours !== undefined ? s.auto_sync_interval_hours : (s.hours || 0));
      var mVal = Number(s.auto_sync_interval_minutes !== undefined ? s.auto_sync_interval_minutes : (s.minutes || 0));
      var calcSec = Math.round(Math.max(0, isFinite(hVal) ? hVal : 0) * 3600 + Math.max(0, isFinite(mVal) ? mVal : 0) * 60);
      if (calcSec > 0) sec = Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, calcSec));
    }

    var best = deriveBestSyncValueUnitCore(sec);
    var value = best.value;
    var unit = best.unit;
    if (rawUnit && rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
      var uClean = normalizeAutoSyncUnitCore(rawUnit);
      var vClean = Number(convertEasternDigitsToAscii(String(rawVal)).trim());
      if (isFinite(vClean) && vClean >= 1 && Math.round(vClean * unitSecondsMultiplierCore(uClean)) === sec) {
        value = Math.round(vClean);
        unit = uClean;
      }
    }
    var legacyMin = Math.max(1, Math.round(sec / 60));
    return {
      intervalSeconds: sec,
      value: value,
      unit: unit,
      hours: Math.floor(legacyMin / 60),
      minutes: legacyMin % 60
    };
  }

  function formatAutoSyncIntervalSecondsAr(secondsOrObj) {
    var sec = (secondsOrObj && typeof secondsOrObj === 'object')
      ? normalizeAutoSyncIntervalSeconds(secondsOrObj).intervalSeconds
      : Math.max(MIN_AUTO_SYNC_SECONDS, Math.min(MAX_AUTO_SYNC_SECONDS, Math.round(Number(secondsOrObj) || 43200)));
    var h = Math.floor(sec / 3600);
    var rem = sec % 3600;
    var m = Math.floor(rem / 60);
    var s = rem % 60;
    var parts = [];
    if (h > 0) {
      parts.push(h === 1 ? 'ساعة واحدة' : (h === 2 ? 'ساعتين' : (h <= 10 ? (h + ' ساعات') : (h + ' ساعة'))));
    }
    if (m > 0) {
      parts.push(m === 1 ? 'دقيقة واحدة' : (m === 2 ? 'دقيقتين' : (m <= 10 ? (m + ' دقائق') : (m + ' دقيقة'))));
    }
    if (s > 0) {
      parts.push(s === 1 ? 'ثانية واحدة' : (s === 2 ? 'ثانيتين' : (s <= 10 ? (s + ' ثوانٍ') : (s + ' ثانية'))));
    }
    if (!parts.length) return 'كل 12 ساعة';
    return 'كل ' + parts.join(' و');
  }

  function normalizeDeleteReservationsScope(payload) {
    var p = (payload && typeof payload === 'object') ? payload : {};
    var rawScope = normalizeStr(p.scope).toLowerCase();
    var scope = (rawScope === 'month' || rawScope === 'year' || rawScope === 'all') ? rawScope : 'all';
    var y = parseInt(convertEasternDigitsToAscii(p.year !== undefined ? p.year : ''), 10);
    var m = parseInt(convertEasternDigitsToAscii(p.month !== undefined ? p.month : ''), 10);

    var rawYm = p.yearMonth || (typeof p.month === 'string' && p.month.indexOf('-') !== -1 ? p.month : '');
    if (scope === 'month' && rawYm) {
      var ymMatch = /^(\d{4})-(\d{1,2})$/.exec(convertEasternDigitsToAscii(rawYm).trim());
      if (ymMatch) {
        y = parseInt(ymMatch[1], 10);
        m = parseInt(ymMatch[2], 10);
      }
    }

    var year = (!isNaN(y) && y >= 2000 && y <= 2100) ? y : null;
    var month = (!isNaN(m) && m >= 1 && m <= 12) ? m : null;
    var ym = (year && month) ? (String(year) + '-' + (month < 10 ? ('0' + month) : String(month))) : '';
    var periodLabelAr = 'جميع الحجوزات';
    var periodLabelEn = 'All Reservations';
    if (scope === 'month') {
      periodLabelAr = ym ? ('شهر ' + ym) : 'شهر محدد';
      periodLabelEn = ym ? ('Month ' + ym) : 'Selected Month';
    } else if (scope === 'year') {
      periodLabelAr = year ? ('سنة ' + year) : 'سنة محددة';
      periodLabelEn = year ? ('Year ' + year) : 'Selected Year';
    }
    return {
      scope: scope,
      year: year,
      month: month,
      ym: ym,
      periodLabelAr: periodLabelAr,
      periodLabelEn: periodLabelEn
    };
  }

  function matchesReservationDeleteScope(reservation, scopeInfo) {
    if (!reservation || typeof reservation !== 'object') return false;
    var info = (scopeInfo && scopeInfo.scope) ? scopeInfo : normalizeDeleteReservationsScope(scopeInfo);
    if (info.scope === 'all') return true;
    var iso = formatDisplayDate(reservation.startDate || reservation.sourceCreatedAt || reservation.createdAt || '');
    if (!iso || iso.length < 4) return false;
    if (info.scope === 'year') {
      return info.year ? (iso.slice(0, 4) === String(info.year)) : false;
    }
    if (info.scope === 'month') {
      return info.ym ? (iso.slice(0, 7) === info.ym) : false;
    }
    return false;
  }

  function filterReservationsForDeleteScope(reservations, scopeOrPayload) {
    var list = Array.isArray(reservations) ? reservations : [];
    var info = (scopeOrPayload && scopeOrPayload.scope && scopeOrPayload.periodLabelAr)
      ? scopeOrPayload
      : normalizeDeleteReservationsScope(scopeOrPayload);
    if (info.scope === 'all') return list.slice();
    return list.filter(function (r) {
      return matchesReservationDeleteScope(r, info);
    });
  }

  function validateDeleteAllReservationsConfirmation(payload) {
    var p = payload || {};
    var scopeInfo = normalizeDeleteReservationsScope(p);
    var acknowledged = p.acknowledged === true || p.acknowledged === 'true';
    var confirmPhrase = normalizeStr(p.confirmPhrase);
    var password = String(p.password === undefined || p.password === null ? '' : p.password);

    if (scopeInfo.scope === 'month' && (!scopeInfo.year || !scopeInfo.month)) {
      return {
        valid: false,
        message: 'يرجى تحديد الشهر والسنة المطلوب حذف حجوزاتهما بشكل صحيح.'
      };
    }
    if (scopeInfo.scope === 'year' && !scopeInfo.year) {
      return {
        valid: false,
        message: 'يرجى تحديد السنة المطلوب حذف حجوزاتها بشكل صحيح (2000–2100).'
      };
    }
    if (!acknowledged) {
      return {
        valid: false,
        message: 'يرجى تأكيد الموافقة على حذف الحجوزات المحددة نهائياً أولاً.'
      };
    }
    if (confirmPhrase !== DELETE_ALL_RESERVATIONS_PHRASE) {
      return {
        valid: false,
        message: 'يرجى كتابة عبارة التأكيد بدقة: ' + DELETE_ALL_RESERVATIONS_PHRASE
      };
    }
    if (!password) {
      return {
        valid: false,
        message: 'يرجى إدخال كلمة مرور حسابك لتأكيد الأمان.'
      };
    }
    return { valid: true, message: '', scope: scopeInfo };
  }

  function padTwoDigits(n) {
    return n < 10 ? ('0' + n) : String(n);
  }

  function formatIsoDateParts(year, month, day) {
    var y = Number(year);
    var m = Number(month);
    var d = Number(day);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return '';
    return String(Math.floor(y)).padStart(4, '0') + '-' + padTwoDigits(Math.floor(m)) + '-' + padTwoDigits(Math.floor(d));
  }

  function getDaysInMonth(year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!isFinite(y) || !isFinite(m) || m < 1 || m > 12) return 30;
    if (m === 2) {
      var isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return isLeap ? 29 : 28;
    }
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  }

  function convertEasternDigitsToAscii(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
  }

  function sanitizeManualDateInput(raw, prevRaw) {
    var ascii = convertEasternDigitsToAscii(raw).replace(/[^0-9-]/g, '');
    // Collapse duplicate hyphens or leading hyphens
    ascii = ascii.replace(/^-+/, '').replace(/-+/g, '-');
    // Limit to YYYY-MM-DD shape progressively while allowing free editing
    var parts = ascii.split('-');
    if (parts.length > 3) {
      parts = [parts[0], parts[1], parts.slice(2).join('')];
    }
    if (parts[0] && parts[0].length > 4) {
      var overflow0 = parts[0].slice(4);
      parts[0] = parts[0].slice(0, 4);
      parts[1] = overflow0 + (parts[1] || '');
    }
    if (parts[1] && parts[1].length > 2) {
      var overflow1 = parts[1].slice(2);
      parts[1] = parts[1].slice(0, 2);
      parts[2] = overflow1 + (parts[2] || '');
    }
    if (parts[2] && parts[2].length > 2) {
      parts[2] = parts[2].slice(0, 2);
    }
    var out = parts.join('-');
    var prev = convertEasternDigitsToAscii(prevRaw || '');
    var isInserting = out.length > prev.length;
    if (isInserting && parts.length === 1 && out.length === 4) {
      out = out + '-';
    } else if (isInserting && parts.length === 2 && parts[0].length === 4 && parts[1].length === 2) {
      out = out + '-';
    }
    return out.slice(0, 10);
  }

  function parseIsoDateStrict(raw) {
    var cleaned = convertEasternDigitsToAscii(raw).trim();
    if (!cleaned) return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
    if (!match) return null;
    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    var maxDays = getDaysInMonth(year, month);
    if (day < 1 || day > maxDays) return null;
    return {
      iso: cleaned,
      year: year,
      month: month,
      day: day
    };
  }

  function validateIsoDateInput(raw, options) {
    var opts = options || {};
    var lang = opts.lang === 'en' ? 'en' : 'ar';
    var cleaned = convertEasternDigitsToAscii(raw).trim();
    if (!cleaned) {
      if (opts.required) {
        return {
          valid: false,
          empty: true,
          normalized: '',
          code: 'REQUIRED',
          message: lang === 'en' ? 'Date is required' : 'التاريخ مطلوب'
        };
      }
      return { valid: true, empty: true, normalized: '', code: '', message: '' };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return {
        valid: false,
        empty: false,
        normalized: '',
        code: 'INVALID_FORMAT',
        message: lang === 'en' ? 'Use YYYY-MM-DD format' : 'استخدم الصيغة YYYY-MM-DD'
      };
    }

    var parsed = parseIsoDateStrict(cleaned);
    if (!parsed) {
      return {
        valid: false,
        empty: false,
        normalized: '',
        code: 'INVALID_DATE',
        message: lang === 'en' ? 'Invalid calendar date' : 'تاريخ غير صالح'
      };
    }

    if (opts.minDate && parseIsoDateStrict(opts.minDate) && parsed.iso < opts.minDate) {
      return {
        valid: false,
        empty: false,
        normalized: '',
        code: 'BEFORE_MIN',
        message: lang === 'en' ? ('Date must be on or after ' + opts.minDate) : ('يجب أن يكون التاريخ من ' + opts.minDate + ' أو بعده')
      };
    }

    if (opts.maxDate && parseIsoDateStrict(opts.maxDate) && parsed.iso > opts.maxDate) {
      return {
        valid: false,
        empty: false,
        normalized: '',
        code: 'AFTER_MAX',
        message: lang === 'en' ? ('Date must be on or before ' + opts.maxDate) : ('يجب أن يكون التاريخ في ' + opts.maxDate + ' أو قبله')
      };
    }

    if (typeof opts.isDateDisabled === 'function' && opts.isDateDisabled(parsed.iso)) {
      return {
        valid: false,
        empty: false,
        normalized: '',
        code: 'DISABLED_DATE',
        message: lang === 'en' ? 'This date is unavailable' : 'هذا التاريخ غير متاح'
      };
    }

    return {
      valid: true,
      empty: false,
      normalized: parsed.iso,
      year: parsed.year,
      month: parsed.month,
      day: parsed.day,
      code: '',
      message: ''
    };
  }

  function shiftCalendarMonth(year, month, deltaMonths) {
    var y = Number(year);
    var m = Number(month);
    var delta = Number(deltaMonths || 0);
    if (!isFinite(y) || !isFinite(m)) {
      var now = new Date();
      y = now.getFullYear();
      m = now.getMonth() + 1;
    }
    var zeroBased = (y * 12) + (m - 1) + delta;
    var nextYear = Math.floor(zeroBased / 12);
    var nextMonth = ((zeroBased % 12) + 12) % 12 + 1;
    return { year: nextYear, month: nextMonth };
  }

  function buildCalendarMonthGrid(year, month, options) {
    var opts = options || {};
    var weekStartsOn = opts.weekStartsOn === 6 ? 6 : 0; // 0 = Sunday, 6 = Saturday
    var firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    var leadingCount = (firstDayOfWeek - weekStartsOn + 7) % 7;

    var prevYM = shiftCalendarMonth(year, month, -1);
    var prevMonthDays = getDaysInMonth(prevYM.year, prevYM.month);
    var currMonthDays = getDaysInMonth(year, month);
    var nextYM = shiftCalendarMonth(year, month, 1);

    var selectedIso = parseIsoDateStrict(opts.selectedDate) ? opts.selectedDate : '';
    var startIso = parseIsoDateStrict(opts.rangeStart) ? opts.rangeStart : '';
    var endIso = parseIsoDateStrict(opts.rangeEnd) ? opts.rangeEnd : '';
    var hoverIso = parseIsoDateStrict(opts.hoverDate) ? opts.hoverDate : '';
    var minIso = parseIsoDateStrict(opts.minDate) ? opts.minDate : '';
    var maxIso = parseIsoDateStrict(opts.maxDate) ? opts.maxDate : '';
    var todayIso = parseIsoDateStrict(opts.todayIso) ? opts.todayIso : '';

    var effStart = startIso;
    var effEnd = endIso;
    if (opts.isRange && effStart && !effEnd && hoverIso) {
      if (hoverIso < effStart) {
        effEnd = effStart;
        effStart = hoverIso;
      } else {
        effEnd = hoverIso;
      }
    } else if (effStart && effEnd && effStart > effEnd) {
      var tmp = effStart;
      effStart = effEnd;
      effEnd = tmp;
    }

    var cells = [];
    for (var i = 0; i < 42; i++) {
      var cYear;
      var cMonth;
      var cDay;
      var isCurrentMonth = false;
      if (i < leadingCount) {
        cYear = prevYM.year;
        cMonth = prevYM.month;
        cDay = prevMonthDays - leadingCount + i + 1;
      } else if (i < leadingCount + currMonthDays) {
        cYear = year;
        cMonth = month;
        cDay = i - leadingCount + 1;
        isCurrentMonth = true;
      } else {
        cYear = nextYM.year;
        cMonth = nextYM.month;
        cDay = i - (leadingCount + currMonthDays) + 1;
      }

      var iso = formatIsoDateParts(cYear, cMonth, cDay);
      var disabled = false;
      if (minIso && iso < minIso) disabled = true;
      if (maxIso && iso > maxIso) disabled = true;
      if (!disabled && typeof opts.isDateDisabled === 'function' && opts.isDateDisabled(iso)) {
        disabled = true;
      }

      var isRangeStart = Boolean(effStart && iso === effStart);
      var isRangeEnd = Boolean(effEnd && iso === effEnd);
      var isInRange = Boolean(effStart && effEnd && iso > effStart && iso < effEnd);
      var isSelected = Boolean(selectedIso && iso === selectedIso) || isRangeStart || isRangeEnd;

      cells.push({
        iso: iso,
        year: cYear,
        month: cMonth,
        day: cDay,
        isCurrentMonth: isCurrentMonth,
        isToday: Boolean(todayIso && iso === todayIso),
        isSelected: isSelected,
        isRangeStart: isRangeStart,
        isRangeEnd: isRangeEnd,
        isInRange: isInRange,
        isDisabled: disabled
      });
    }

    return cells;
  }

  function resolveRangeSelectionClick(currentStart, currentEnd, clickedIso, activeRole) {
    var clicked = parseIsoDateStrict(clickedIso) ? clickedIso : '';
    var start = parseIsoDateStrict(currentStart) ? currentStart : '';
    var end = parseIsoDateStrict(currentEnd) ? currentEnd : '';
    if (!clicked) return { start: start, end: end, nextRole: activeRole === 'end' ? 'end' : 'start', completed: false };

    if (activeRole === 'end') {
      if (!start) {
        // Allow picking only end date without forcing start date
        return { start: '', end: clicked, nextRole: 'end', completed: true };
      }
      if (clicked < start) {
        return { start: clicked, end: start, nextRole: 'end', completed: true };
      }
      return { start: start, end: clicked, nextRole: 'end', completed: true };
    }

    // Picking start (or starting fresh range)
    if (end && clicked > end) {
      return { start: clicked, end: '', nextRole: 'end', completed: false };
    }
    return { start: clicked, end: end, nextRole: 'end', completed: Boolean(end) };
  }

  function clampPdfPage(page, totalPages) {
    var total = Math.max(1, Math.floor(Number(totalPages || 1)));
    var p = Math.floor(Number(page || 1));
    if (!isFinite(p) || p < 1) return 1;
    if (p > total) return total;
    return p;
  }

  var PDF_ZOOM_MIN = 0.25;
  var PDF_ZOOM_MAX = 2.5;
  var PDF_ZOOM_STEPS = [0.25, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

  function clampPdfZoom(scale) {
    var num = Number(scale);
    if (!isFinite(num) || num <= 0) return 1;
    var clamped = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, num));
    return Math.round(clamped * 100) / 100;
  }

  function computePdfZoom(action, currentScale, metrics) {
    var cur = clampPdfZoom(currentScale || 1);
    var m = metrics || {};
    var padX = Number(m.padX !== undefined ? m.padX : 40);
    var padY = Number(m.padY !== undefined ? m.padY : 40);
    var vw = Math.max(120, Number(m.viewportWidth || 800) - padX);
    var vh = Math.max(120, Number(m.viewportHeight || 600) - padY);
    var pw = Math.max(1, Number(m.pageWidth || 794));
    var ph = Math.max(1, Number(m.pageHeight || 1123));

    if (action === 'reset') {
      return { scale: 1, mode: 'custom' };
    }
    if (action === 'fit-width') {
      return { scale: clampPdfZoom(vw / pw), mode: 'fit-width' };
    }
    if (action === 'fit-page') {
      return { scale: clampPdfZoom(Math.min(vw / pw, vh / ph)), mode: 'fit-page' };
    }
    if (action === 'in') {
      for (var i = 0; i < PDF_ZOOM_STEPS.length; i++) {
        if (PDF_ZOOM_STEPS[i] > cur + 0.02) {
          return { scale: PDF_ZOOM_STEPS[i], mode: 'custom' };
        }
      }
      return { scale: PDF_ZOOM_MAX, mode: 'custom' };
    }
    if (action === 'out') {
      for (var j = PDF_ZOOM_STEPS.length - 1; j >= 0; j--) {
        if (PDF_ZOOM_STEPS[j] < cur - 0.02) {
          return { scale: PDF_ZOOM_STEPS[j], mode: 'custom' };
        }
      }
      return { scale: PDF_ZOOM_MIN, mode: 'custom' };
    }
    return { scale: clampPdfZoom(action), mode: 'custom' };
  }

  var PDF_LAYOUT_PRESETS = {
    compact: {
      id: 'compact',
      defaultTargetPages: 1,
      marginPt: 18,
      headerH: 52,
      contHeaderH: 30,
      footerReserve: 26,
      baseFont: 8.1,
      cellPadX: 4,
      cellPadY: 3,
      lineRatio: 1.24,
      kpiH: 35,
      kpiGap: 6,
      kpiPerRow: 5,
      sectionGap: 7,
      extraLineH: 11.5,
      extraBlockPad: 3,
      chartH: 118,
      chartGap: 8,
      maxCellLines: 2
    },
    balanced: {
      id: 'balanced',
      defaultTargetPages: 3,
      marginPt: 30,
      headerH: 70,
      contHeaderH: 42,
      footerReserve: 36,
      baseFont: 9.3,
      cellPadX: 6,
      cellPadY: 5.5,
      lineRatio: 1.38,
      kpiH: 46,
      kpiGap: 10,
      kpiPerRow: 4,
      sectionGap: 12,
      extraLineH: 14.5,
      extraBlockPad: 6,
      chartH: 160,
      chartGap: 12,
      maxCellLines: 3
    },
    comfortable: {
      id: 'comfortable',
      defaultTargetPages: 6,
      marginPt: 40,
      headerH: 80,
      contHeaderH: 50,
      footerReserve: 42,
      baseFont: 10.6,
      cellPadX: 8.5,
      cellPadY: 8,
      lineRatio: 1.54,
      kpiH: 56,
      kpiGap: 13,
      kpiPerRow: 3,
      sectionGap: 18,
      extraLineH: 17.5,
      extraBlockPad: 9,
      chartH: 196,
      chartGap: 16,
      maxCellLines: 4
    }
  };

  var PDF_QUALITY_PROFILES = {
    small: {
      id: 'small',
      renderScale: 1.15,
      jpegQuality: 0.56,
      chartCaptureQuality: 0.72,
      chartCaptureMaxW: 720,
      imageCompression: 'SLOW',
      stripMetadata: true,
      compressStreams: true,
      downsampleLogoPx: 72,
      bytesPerPixel: 0.042
    },
    balanced: {
      id: 'balanced',
      renderScale: 1.45,
      jpegQuality: 0.76,
      chartCaptureQuality: 0.84,
      chartCaptureMaxW: 960,
      imageCompression: 'MEDIUM',
      stripMetadata: true,
      compressStreams: true,
      downsampleLogoPx: 96,
      bytesPerPixel: 0.075
    },
    high: {
      id: 'high',
      renderScale: 1.85,
      jpegQuality: 0.90,
      chartCaptureQuality: 0.92,
      chartCaptureMaxW: 1280,
      imageCompression: 'MEDIUM',
      stripMetadata: false,
      compressStreams: true,
      downsampleLogoPx: 144,
      bytesPerPixel: 0.132
    },
    unoptimized: {
      id: 'unoptimized',
      renderScale: 2.0,
      jpegQuality: 0.95,
      chartCaptureQuality: 0.95,
      chartCaptureMaxW: 1600,
      imageCompression: 'FAST',
      stripMetadata: false,
      compressStreams: false,
      downsampleLogoPx: 192,
      bytesPerPixel: 0.205
    }
  };

  function clampPdfTargetPages(val) {
    var n = Math.round(Number(val));
    if (!isFinite(n) || n < 1) return 1;
    if (n > 10) return 10;
    return n;
  }

  var PDF_BRAND_IDENTITY = {
    primaryColor: '#D9232A',
    darkGray: '#303030',
    white: '#FFFFFF',
    surfaceLight: '#F7F7F8',
    borderLight: '#E4E4E7'
  };

  var PDF_ARABIC_FONTS = [
    { id: 'IBM Plex Sans Arabic', labelAr: 'IBM Plex Sans Arabic (الافتراضي)', labelEn: 'IBM Plex Sans Arabic (Default)' },
    { id: 'Cairo', labelAr: 'Cairo (كايرو الحديث)', labelEn: 'Cairo (Modern)' },
    { id: 'Tajawal', labelAr: 'Tajawal (تجوال الواضح)', labelEn: 'Tajawal (Clean)' },
    { id: 'Tahoma', labelAr: 'Tahoma (الخط الكلاسيكي)', labelEn: 'Tahoma (System)' }
  ];

  var PDF_DESIGN_STYLES = [
    { id: 'modern_minimal', labelAr: 'Modern Minimal (هوية Web God)', labelEn: 'Modern Minimal (Web God)' },
    { id: 'executive_classic', labelAr: 'التصميم التنفيذي الداكن', labelEn: 'Executive Dark Header' }
  ];

  var PDF_MARGIN_PRESETS_MM = {
    narrow: { top: 6, right: 6, bottom: 6, left: 6 },
    normal: { top: 10, right: 10, bottom: 10, left: 10 },
    wide: { top: 15, right: 15, bottom: 15, left: 15 }
  };

  var PDF_FONT_SIZE_SCALES = {
    small: 0.88,
    medium: 1.0,
    large: 1.15
  };

  function normalizePdfHexColor(color, fallback) {
    var def = normalizeStr(fallback) || PDF_BRAND_IDENTITY.primaryColor;
    var raw = normalizeStr(color);
    if (!raw) return def;
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      return ('#' + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2) + raw.charAt(3) + raw.charAt(3)).toUpperCase();
    }
    return def;
  }

  function resolvePdfExportSettings(opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var presetRaw = normalizeStr(o.preset).toLowerCase();
    var preset = (presetRaw === 'compact' || presetRaw === 'balanced' || presetRaw === 'comfortable' || presetRaw === 'custom')
      ? presetRaw
      : 'balanced';
    var qualityRaw = normalizeStr(o.quality).toLowerCase();
    var quality = (qualityRaw === 'small' || qualityRaw === 'balanced' || qualityRaw === 'high')
      ? qualityRaw
      : 'balanced';
    var defaultTp = (PDF_LAYOUT_PRESETS[preset] && PDF_LAYOUT_PRESETS[preset].defaultTargetPages) || 3;
    var targetPages = o.targetPages !== undefined ? clampPdfTargetPages(o.targetPages) : defaultTp;
    var optimizeFileSize = o.optimizeFileSize === undefined ? true : Boolean(o.optimizeFileSize);
    var rawPaper = normalizeStr(o.paperSize).toLowerCase();
    var paperSize = rawPaper === 'letter' ? 'letter' : (rawPaper === 'a3' ? 'a3' : 'a4');
    var orientation = normalizeStr(o.orientation).toLowerCase() === 'portrait' ? 'portrait' : 'landscape';
    return {
      targetPages: targetPages,
      preset: preset,
      optimizeFileSize: optimizeFileSize,
      quality: quality,
      paperSize: paperSize,
      orientation: orientation
    };
  }

  function clampMarginMm(val, fallback) {
    var n = Number(val);
    if (!isFinite(n)) return fallback;
    return Math.max(4, Math.min(35, Math.round(n * 10) / 10));
  }

  function resolvePdfMarginsMm(marginPreset, customMargins) {
    var mp = normalizeStr(marginPreset).toLowerCase();
    if (mp === 'narrow' || mp === 'wide' || mp === 'normal') {
      return Object.assign({}, PDF_MARGIN_PRESETS_MM[mp]);
    }
    if (mp === 'custom') {
      var cm = (customMargins && typeof customMargins === 'object') ? customMargins : {};
      return {
        top: clampMarginMm(cm.top, 10),
        right: clampMarginMm(cm.right, 10),
        bottom: clampMarginMm(cm.bottom, 10),
        left: clampMarginMm(cm.left, 10)
      };
    }
    return Object.assign({}, PDF_MARGIN_PRESETS_MM.normal);
  }

  function resolveAdvancedPdfSettings(opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var base = resolvePdfExportSettings(o);
    var rawMarginPreset = normalizeStr(o.marginPreset).toLowerCase();
    var marginPreset = (rawMarginPreset === 'narrow' || rawMarginPreset === 'normal' || rawMarginPreset === 'wide' || rawMarginPreset === 'custom')
      ? rawMarginPreset
      : 'normal';
    var customMargins = resolvePdfMarginsMm(marginPreset === 'custom' ? 'custom' : 'normal', o.customMargins);

    var rawStyle = normalizeStr(o.designStyle).toLowerCase();
    var designStyle = rawStyle === 'executive_classic' ? 'executive_classic' : 'modern_minimal';

    var rawScale = normalizeStr(o.fontSizeScale).toLowerCase();
    var fontSizeScale = (rawScale === 'small' || rawScale === 'large') ? rawScale : 'medium';

    var allowedFontIds = PDF_ARABIC_FONTS.map(function (f) { return f.id; });
    var fontFamily = allowedFontIds.indexOf(normalizeStr(o.fontFamily)) !== -1
      ? normalizeStr(o.fontFamily)
      : 'IBM Plex Sans Arabic';

    var rawNotesSize = normalizeStr(o.notesFontSize).toLowerCase();
    var notesFontSize = (rawNotesSize === 'small' || rawNotesSize === 'large') ? rawNotesSize : 'medium';

    var customWidthsClean = {};
    if (o.columnWidths && typeof o.columnWidths === 'object') {
      Object.keys(o.columnWidths).forEach(function (k) {
        var num = Number(o.columnWidths[k]);
        if (isFinite(num) && num >= 5 && num <= 80) {
          customWidthsClean[k] = Math.round(num * 10) / 10;
        }
      });
    }

    return Object.assign({}, base, {
      marginPreset: marginPreset,
      customMargins: customMargins,
      designStyle: designStyle,
      primaryColor: normalizePdfHexColor(o.primaryColor, PDF_BRAND_IDENTITY.primaryColor),
      fontSizeScale: fontSizeScale,
      fontFamily: fontFamily,
      showLogo: o.showLogo === undefined ? true : Boolean(o.showLogo),
      showTitle: o.showTitle === undefined ? true : Boolean(o.showTitle),
      showDateTime: o.showDateTime === undefined ? true : Boolean(o.showDateTime),
      showFooter: o.showFooter === undefined ? true : Boolean(o.showFooter),
      showPageNumbers: o.showPageNumbers === undefined ? true : Boolean(o.showPageNumbers),
      showKpis: o.showKpis === undefined ? true : Boolean(o.showKpis),
      showTableHeaders: o.showTableHeaders === undefined ? true : Boolean(o.showTableHeaders),
      repeatTableHeader: o.repeatTableHeader === undefined ? true : Boolean(o.repeatTableHeader),
      autoColumnWidths: o.autoColumnWidths === undefined ? true : Boolean(o.autoColumnWidths),
      columnWidths: customWidthsClean,
      selectedColumns: Array.isArray(o.selectedColumns) ? o.selectedColumns.map(normalizeStr).filter(Boolean) : null,
      columnOrder: Array.isArray(o.columnOrder) ? o.columnOrder.map(normalizeStr).filter(Boolean) : null,
      showNotes: o.showNotes === undefined ? true : Boolean(o.showNotes),
      notesFullUnclipped: o.notesFullUnclipped === undefined ? true : Boolean(o.notesFullUnclipped),
      notesPreserveLineBreaks: o.notesPreserveLineBreaks === undefined ? true : Boolean(o.notesPreserveLineBreaks),
      notesFontSize: notesFontSize
    });
  }

  function applyPdfColumnSelectionAndOrder(allColumns, selectedKeys, orderedKeys, customWidthsMap) {
    var list = Array.isArray(allColumns) ? allColumns.slice() : [];
    if (!list.length) return [];

    var byKey = {};
    list.forEach(function (col) {
      if (col && col.key) byKey[col.key] = col;
    });

    var ordered = [];
    var seen = {};
    if (Array.isArray(orderedKeys) && orderedKeys.length) {
      orderedKeys.forEach(function (k) {
        if (byKey[k] && !seen[k]) {
          ordered.push(byKey[k]);
          seen[k] = true;
        }
      });
    }
    list.forEach(function (col) {
      if (col && col.key && !seen[col.key]) {
        ordered.push(col);
        seen[col.key] = true;
      }
    });

    var hasSelection = Array.isArray(selectedKeys) && selectedKeys.length > 0;
    var selectedSet = {};
    if (hasSelection) {
      selectedKeys.forEach(function (k) { selectedSet[k] = true; });
    }

    var filtered = hasSelection
      ? ordered.filter(function (c) { return Boolean(selectedSet[c.key]); })
      : ordered;
    if (!filtered.length) filtered = ordered.slice(0, Math.min(6, ordered.length));

    var widths = (customWidthsMap && typeof customWidthsMap === 'object') ? customWidthsMap : null;
    return filtered.map(function (c) {
      var copy = Object.assign({}, c);
      if (widths && widths[c.key] !== undefined && Number(widths[c.key]) > 0) {
        copy.customWidthWeight = Number(widths[c.key]);
      }
      return copy;
    });
  }

  function getUserPdfPrefsStorageKey(user) {
    var u = (user && typeof user === 'object') ? user : {};
    var rawKey = normalizeStr(u.id || u.employeeId || u.username || 'guest')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    return 'rg_crm_pdf_export_prefs_v2_' + (rawKey || 'guest');
  }

  function getPaperDimensionsMm(paperSize, orientation) {
    var ps = normalizeStr(paperSize).toLowerCase();
    var baseW = ps === 'letter' ? 215.9 : (ps === 'a3' ? 297 : 210);
    var baseH = ps === 'letter' ? 279.4 : (ps === 'a3' ? 420 : 297);
    if (normalizeStr(orientation).toLowerCase() === 'portrait') {
      return { widthMm: baseW, heightMm: baseH };
    }
    return { widthMm: baseH, heightMm: baseW };
  }

  function lerpNum(a, b, t) {
    return a + (b - a) * t;
  }

  function simulatePdfPagination(m, stats) {
    var pageWpt = m.pageWpt;
    var pageHpt = m.pageHpt;
    var pad = m.marginPt;
    var footerReserve = m.footerReserve;
    var headerGap = m.headerGap;
    var firstUsable = Math.max(120, pageHpt - m.headerH - headerGap - footerReserve);
    var contUsable = Math.max(120, pageHpt - m.contHeaderH - headerGap - footerReserve);

    var pages = 1;
    var y = m.headerH + headerGap;
    var limitY = pageHpt - footerReserve;

    function ensure(needed) {
      if (y + needed > limitY) {
        pages += 1;
        y = m.contHeaderH + headerGap;
      }
    }

    var kpiCount = Math.max(0, Number(stats.kpiCount !== undefined ? stats.kpiCount : (stats.summaryCount || 0)));
    var wideCount = Math.max(0, Number(stats.wideSummaryCount || 0));

    if (kpiCount > 0) {
      var perRow = Math.min(m.kpiPerRow, kpiCount);
      var kpiRows = Math.ceil(kpiCount / Math.max(1, perRow));
      for (var kr = 0; kr < kpiRows; kr++) {
        ensure(m.kpiH + m.kpiGap);
        y += m.kpiH + m.kpiGap;
      }
    }
    if (wideCount > 0) {
      var colsWide = (pageWpt > 900 && wideCount > 1) ? 2 : 1;
      var wideRows = Math.ceil(wideCount / colsWide);
      var wideCardH = Math.round(24 + m.extraLineH * 1.8 + 8);
      for (var wr = 0; wr < wideRows; wr++) {
        ensure(wideCardH + m.kpiGap);
        y += wideCardH + m.kpiGap;
      }
      y += Math.round(m.sectionGap * 0.4);
    }

    var colCount = Math.max(0, Number(stats.columnCount || 0));
    var rowCount = Math.max(0, Number(stats.rowCount || 0));
    var avgChars = Math.max(8, Number(stats.avgCharsPerCell || 18));
    var contentW = Math.max(200, pageWpt - pad * 2);

    if (colCount > 0) {
      var avgColW = Math.max(32, contentW / colCount - m.cellPadX * 2);
      var charsPerLine = Math.max(6, Math.floor(avgColW / (m.baseFont * 0.56)));
      var estLines = Math.min(m.maxCellLines, Math.max(1, Math.ceil(avgChars / charsPerLine)));
      var headerRowH = Math.max(Math.round(m.baseFont * 2.2), Math.round(m.cellLineH + m.cellPadY * 2));
      var estRowH = Math.max(Math.round(m.baseFont * 1.9), Math.round(estLines * m.cellLineH + m.cellPadY * 2));

      if (rowCount === 0) {
        ensure(headerRowH + 28);
        y += headerRowH + 32;
      } else {
        ensure(headerRowH + estRowH);
        y += headerRowH;
        var rowsOnThisPage = 0;
        for (var r = 0; r < rowCount; r++) {
          var forceBreak = (m.maxRowsPerPage > 0 && rowsOnThisPage >= m.maxRowsPerPage);
          if (forceBreak || (y + estRowH > limitY)) {
            pages += 1;
            y = m.contHeaderH + headerGap;
            y += headerRowH;
            rowsOnThisPage = 0;
          }
          y += estRowH;
          rowsOnThisPage += 1;
        }
        y += m.sectionGap;
      }
    }

    var extraSecCount = Math.max(0, Number(stats.extraSectionsCount || 0));
    var extraLinesCount = Math.max(0, Number(stats.extraLinesCount || 0));
    if (extraLinesCount > 0) {
      if (m.breakBeforeExtra && y > (m.headerH + headerGap + 40)) {
        pages += 1;
        y = m.contHeaderH + headerGap;
      }
      var avgLinesPerSec = Math.max(1, Math.ceil(extraLinesCount / Math.max(1, extraSecCount || 1)));
      var lineBoxH = Math.round(m.extraLineH * 1.35 + m.extraBlockPad * 2);
      var linesRemaining = extraLinesCount;
      var secTotal = Math.max(1, extraSecCount || 1);
      for (var s = 0; s < secTotal && linesRemaining > 0; s++) {
        ensure(Math.round(m.baseFont * 3.4));
        y += Math.round(m.baseFont * 2.2);
        var take = Math.min(linesRemaining, avgLinesPerSec);
        var extraRowsOnPage = 0;
        for (var li = 0; li < take; li++) {
          if ((m.maxExtraPerPage > 0 && extraRowsOnPage >= m.maxExtraPerPage) || (y + lineBoxH > limitY)) {
            pages += 1;
            y = m.contHeaderH + headerGap;
            extraRowsOnPage = 0;
          }
          y += lineBoxH;
          extraRowsOnPage += 1;
        }
        linesRemaining -= take;
        y += Math.round(m.sectionGap * 0.75);
      }
    }

    var chartCount = Math.max(0, Number(stats.chartCount || 0));
    if (chartCount > 0) {
      if (m.breakBeforeCharts && y > (m.headerH + headerGap + 40)) {
        pages += 1;
        y = m.contHeaderH + headerGap;
      }
      var cCols = Math.min(chartCount, m.chartCols || 2);
      var chartRows = Math.ceil(chartCount / Math.max(1, cCols));
      for (var chR = 0; chR < chartRows; chR++) {
        ensure(m.chartH + m.chartGap);
        y += m.chartH + m.chartGap;
      }
    }

    return {
      pages: Math.max(1, pages),
      firstUsable: firstUsable,
      contUsable: contUsable
    };
  }

  function estimatePdfFileSizeBytes(plan, stats) {
    var p = plan || {};
    var s = stats || {};
    var pages = Math.max(1, Number(p.estimatedPages || 1));
    var scale = Number(p.renderScale || 1.45);
    var pxPerPage = Math.round(Number(p.pageWpt || 1123) * scale) * Math.round(Number(p.pageHpt || 794) * scale);
    var bpp = Number(p.bytesPerPixel || 0.075);
    var chartBoost = Math.max(0, Number(s.chartCount || 0)) * (p.optimizeFileSize ? 5500 : 12000);
    var rowDensityBoost = Math.min(60, Math.max(0, Number(s.rowCount || 0))) * (p.optimizeFileSize ? 380 : 620);
    var metaOverhead = p.stripMetadata ? 1600 : 4200;
    return Math.round(pages * pxPerPage * bpp + chartBoost + rowDensityBoost + metaOverhead);
  }

  function computePdfLayoutPlan(params) {
    var cfg = resolvePdfExportSettings(params);
    var adv = resolveAdvancedPdfSettings(params);
    var p = params || {};
    var lang = normalizeStr(p.lang) === 'en' ? 'en' : 'ar';
    var dims = getPaperDimensionsMm(cfg.paperSize, cfg.orientation);
    var isPortrait = cfg.orientation === 'portrait';
    var pageWpt = Math.round(dims.widthMm * 3.78);
    var pageHpt = Math.round(dims.heightMm * 3.78);
    var colCount = Math.max(0, Number(p.columnCount || 0));
    var rowCount = Math.max(0, Number(p.rowCount || 0));
    var chartCount = Math.max(0, Number(p.chartCount || 0));
    var extraSectionsCount = Math.max(0, Number(p.extraSectionsCount || 0));
    var extraLinesCount = Math.max(0, Number(p.extraLinesCount || 0));
    var kpiCount = adv.showKpis
      ? Math.max(0, Number(p.kpiCount !== undefined ? p.kpiCount : (p.summaryCount || 0)))
      : 0;
    var wideSummaryCount = Math.max(0, Number(p.wideSummaryCount || 0));

    var fontScaleMult = PDF_FONT_SIZE_SCALES[adv.fontSizeScale] || 1.0;
    var hasExplicitMargin = Boolean(p.marginPreset && normalizeStr(p.marginPreset).toLowerCase() !== 'normal');
    var marginMmObj = resolvePdfMarginsMm(adv.marginPreset, adv.customMargins);
    var explicitMarginPt = Math.round(((marginMmObj.left + marginMmObj.right) / 2) * 2.84);

    var stats = {
      rowCount: rowCount,
      columnCount: colCount,
      kpiCount: kpiCount,
      wideSummaryCount: wideSummaryCount,
      extraSectionsCount: extraSectionsCount,
      extraLinesCount: extraLinesCount,
      chartCount: chartCount,
      avgCharsPerCell: Number(p.avgCharsPerCell || 18)
    };

    var presetKey = PDF_LAYOUT_PRESETS[cfg.preset] ? cfg.preset : 'balanced';
    var baseProfile = PDF_LAYOUT_PRESETS[presetKey];

    // Strict readability floor (never shrunk below legible thresholds)
    var minReadableFont = colCount >= 10 ? 7.3 : (colCount >= 8 ? 7.6 : 8.0);
    var floorProfile = {
      marginPt: 16,
      headerH: 48,
      contHeaderH: 26,
      footerReserve: (adv.showFooter || adv.showPageNumbers) ? 24 : 10,
      baseFont: minReadableFont,
      cellPadX: 3.4,
      cellPadY: 2.5,
      lineRatio: 1.18,
      kpiH: isPortrait ? 38 : 32,
      kpiGap: 5,
      kpiPerRow: isPortrait ? 3 : 5,
      sectionGap: 5,
      extraLineH: 11,
      extraBlockPad: 2.5,
      chartH: isPortrait ? 136 : 106,
      chartGap: 6,
      maxCellLines: isPortrait ? 4 : 2
    };

    var ceilProfile = {
      marginPt: 46,
      headerH: 86,
      contHeaderH: 54,
      footerReserve: (adv.showFooter || adv.showPageNumbers) ? 46 : 16,
      baseFont: colCount >= 9 ? 10.2 : 11.4,
      cellPadX: 10,
      cellPadY: 9.5,
      lineRatio: 1.62,
      kpiH: isPortrait ? 64 : 58,
      kpiGap: 14,
      kpiPerRow: isPortrait ? 2 : 4,
      sectionGap: 22,
      extraLineH: 19,
      extraBlockPad: 10,
      chartH: isPortrait ? 230 : 210,
      chartGap: 18,
      maxCellLines: isPortrait ? 6 : 4
    };

    function buildMetricsFromProfile(prof, extraOpts) {
      var eo = extraOpts || {};
      var scaledBase = prof.baseFont * fontScaleMult;
      var baseFont = colCount >= 10
        ? Math.min(scaledBase, 8.8 * fontScaleMult)
        : (colCount >= 8 ? Math.min(scaledBase, 9.5 * fontScaleMult) : scaledBase);
      baseFont = Math.max(minReadableFont, Math.round(baseFont * 10) / 10);
      var cellLineH = Math.round((baseFont * prof.lineRatio + 1.2) * 10) / 10;
      var chosenMarginPt = hasExplicitMargin ? explicitMarginPt : Math.round(prof.marginPt);
      var kpiPerRowResolved = isPortrait
        ? Math.min(3, Math.max(2, Math.round(prof.kpiPerRow)))
        : Math.max(3, Math.round(prof.kpiPerRow));
      return {
        pageWpt: pageWpt,
        pageHpt: pageHpt,
        marginPt: chosenMarginPt,
        marginsPt: {
          top: hasExplicitMargin ? Math.round(marginMmObj.top * 2.84) : chosenMarginPt,
          right: hasExplicitMargin ? Math.round(marginMmObj.right * 2.84) : chosenMarginPt,
          bottom: hasExplicitMargin ? Math.round(marginMmObj.bottom * 2.84) : chosenMarginPt,
          left: hasExplicitMargin ? Math.round(marginMmObj.left * 2.84) : chosenMarginPt
        },
        headerH: Math.round(prof.headerH),
        contHeaderH: Math.round(prof.contHeaderH),
        headerGap: Math.round(Math.max(8, prof.sectionGap * 1.15)),
        footerReserve: (adv.showFooter || adv.showPageNumbers) ? Math.round(prof.footerReserve) : 14,
        baseFont: baseFont,
        headerFont: Math.round(Math.max(baseFont, baseFont * 1.02) * 10) / 10,
        cellPadX: Math.round(prof.cellPadX * 10) / 10,
        cellPadY: Math.round(prof.cellPadY * 10) / 10,
        cellLineH: cellLineH,
        kpiH: Math.round(prof.kpiH * (fontScaleMult > 1 ? 1.08 : 1)),
        kpiGap: Math.round(prof.kpiGap),
        kpiPerRow: kpiPerRowResolved,
        sectionGap: Math.round(prof.sectionGap),
        extraLineH: Math.round(prof.extraLineH * fontScaleMult * 10) / 10,
        extraBlockPad: Math.round(prof.extraBlockPad * 10) / 10,
        chartH: Math.round(prof.chartH),
        chartGap: Math.round(prof.chartGap),
        chartCols: eo.chartCols || (isPortrait ? 1 : (chartCount > 1 ? 2 : 1)),
        maxCellLines: Math.round(prof.maxCellLines),
        maxRowsPerPage: eo.maxRowsPerPage || 0,
        maxExtraPerPage: eo.maxExtraPerPage || 0,
        breakBeforeExtra: Boolean(eo.breakBeforeExtra),
        breakBeforeCharts: Boolean(eo.breakBeforeCharts)
      };
    }

    function blendProfiles(a, b, t) {
      return {
        marginPt: lerpNum(a.marginPt, b.marginPt, t),
        headerH: lerpNum(a.headerH, b.headerH, t),
        contHeaderH: lerpNum(a.contHeaderH, b.contHeaderH, t),
        footerReserve: lerpNum(a.footerReserve, b.footerReserve, t),
        baseFont: lerpNum(a.baseFont, b.baseFont, t),
        cellPadX: lerpNum(a.cellPadX, b.cellPadX, t),
        cellPadY: lerpNum(a.cellPadY, b.cellPadY, t),
        lineRatio: lerpNum(a.lineRatio, b.lineRatio, t),
        kpiH: lerpNum(a.kpiH, b.kpiH, t),
        kpiGap: lerpNum(a.kpiGap, b.kpiGap, t),
        kpiPerRow: t >= 0.65 ? b.kpiPerRow : a.kpiPerRow,
        sectionGap: lerpNum(a.sectionGap, b.sectionGap, t),
        extraLineH: lerpNum(a.extraLineH, b.extraLineH, t),
        extraBlockPad: lerpNum(a.extraBlockPad, b.extraBlockPad, t),
        chartH: lerpNum(a.chartH, b.chartH, t),
        chartGap: lerpNum(a.chartGap, b.chartGap, t),
        maxCellLines: t >= 0.65 ? b.maxCellLines : a.maxCellLines
      };
    }

    var portraitAdjustedBase = isPortrait
      ? Object.assign({}, baseProfile, {
          kpiPerRow: presetKey === 'compact' ? 3 : 2,
          kpiH: baseProfile.kpiH + 6,
          maxCellLines: baseProfile.maxCellLines + 2,
          chartH: Math.round(baseProfile.chartH * 1.12)
        })
      : baseProfile;

    var naturalMetrics = buildMetricsFromProfile(portraitAdjustedBase, {});
    var naturalSim = simulatePdfPagination(naturalMetrics, stats);
    var chosenMetrics = naturalMetrics;
    var chosenSim = naturalSim;
    var readabilityWarning = false;
    var warningCode = '';
    var warningMessageAr = '';
    var warningMessageEn = '';

    if (cfg.targetPages < naturalSim.pages) {
      var foundFit = false;
      var steps = 16;
      for (var st = 1; st <= steps; st++) {
        var frac = st / steps;
        var candidateProf = blendProfiles(portraitAdjustedBase, floorProfile, frac);
        var candMetrics = buildMetricsFromProfile(candidateProf, {
          chartCols: isPortrait ? 1 : (chartCount >= 3 ? 3 : (chartCount > 1 ? 2 : 1))
        });
        var candSim = simulatePdfPagination(candMetrics, stats);
        chosenMetrics = candMetrics;
        chosenSim = candSim;
        if (candSim.pages <= cfg.targetPages) {
          foundFit = true;
          break;
        }
      }
      if (!foundFit && chosenSim.pages > cfg.targetPages) {
        readabilityWarning = true;
        warningCode = 'MIN_PAGES_EXCEEDED';
        warningMessageEn = 'Some content requires additional pages (' + chosenSim.pages + ' pages minimum) to maintain readability.';
        warningMessageAr = 'بعض المحتوى يتطلب صفحات إضافية (' + chosenSim.pages + ' صفحات على الأقل) للحفاظ على وضوح القراءة.';
      }
    } else if (cfg.targetPages > naturalSim.pages) {
      var expandRatio = Math.min(1, (cfg.targetPages - naturalSim.pages) / Math.max(2, 10 - naturalSim.pages));
      var expProf = blendProfiles(portraitAdjustedBase, ceilProfile, expandRatio);
      var useSingleChartCol = isPortrait || (cfg.targetPages >= 6 && chartCount > 1);
      var breakCharts = (chartCount > 0 && cfg.targetPages >= naturalSim.pages + 1);
      var breakExtra = (extraLinesCount > 0 && cfg.targetPages >= naturalSim.pages + 2);

      var chartPageReserve = chartCount > 0 ? (useSingleChartCol ? Math.min(chartCount, 2) : 1) : 0;
      var extraPageReserve = extraLinesCount > 0 ? (breakExtra ? Math.max(1, Math.ceil(extraLinesCount / 14)) : 0) : 0;
      var tablePageBudget = Math.max(1, cfg.targetPages - (breakCharts ? chartPageReserve : 0) - extraPageReserve);

      var maxRowsPerPage = 0;
      if (rowCount > 1 && tablePageBudget > 1) {
        maxRowsPerPage = Math.max(2, Math.ceil(rowCount / tablePageBudget));
      }
      var maxExtraPerPage = 0;
      if (rowCount === 0 && extraLinesCount > 2 && cfg.targetPages >= 2) {
        var extraBudget = Math.max(1, cfg.targetPages - (breakCharts ? chartPageReserve : 0));
        maxExtraPerPage = Math.max(2, Math.ceil(extraLinesCount / extraBudget));
      }

      var expMetrics = buildMetricsFromProfile(expProf, {
        chartCols: useSingleChartCol ? 1 : (chartCount > 1 ? 2 : 1),
        maxRowsPerPage: maxRowsPerPage,
        maxExtraPerPage: maxExtraPerPage,
        breakBeforeExtra: breakExtra,
        breakBeforeCharts: breakCharts
      });
      var expSim = simulatePdfPagination(expMetrics, stats);

      if (expSim.pages < cfg.targetPages && rowCount > 1) {
        for (var mr = Math.max(1, maxRowsPerPage - 1); mr >= 1; mr--) {
          var refinedMetrics = buildMetricsFromProfile(expProf, {
            chartCols: useSingleChartCol ? 1 : (chartCount > 1 ? 2 : 1),
            maxRowsPerPage: mr,
            maxExtraPerPage: maxExtraPerPage,
            breakBeforeExtra: breakExtra,
            breakBeforeCharts: breakCharts
          });
          var refinedSim = simulatePdfPagination(refinedMetrics, stats);
          if (refinedSim.pages <= cfg.targetPages) {
            expMetrics = refinedMetrics;
            expSim = refinedSim;
          }
          if (refinedSim.pages >= cfg.targetPages) break;
        }
      }

      chosenMetrics = expMetrics;
      chosenSim = expSim;
    }

    var qualityProfile = cfg.optimizeFileSize
      ? (PDF_QUALITY_PROFILES[cfg.quality] || PDF_QUALITY_PROFILES.balanced)
      : PDF_QUALITY_PROFILES.unoptimized;

    var plan = Object.assign({}, chosenMetrics, {
      targetPages: cfg.targetPages,
      preset: cfg.preset,
      optimizeFileSize: cfg.optimizeFileSize,
      quality: cfg.quality,
      paperSize: cfg.paperSize,
      orientation: cfg.orientation,
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
      estimatedPages: chosenSim.pages,
      readabilityWarning: readabilityWarning,
      warningCode: warningCode,
      warningMessageAr: warningMessageAr,
      warningMessageEn: warningMessageEn,
      warningMessage: lang === 'en' ? warningMessageEn : warningMessageAr,
      renderScale: qualityProfile.renderScale,
      jpegQuality: qualityProfile.jpegQuality,
      chartCaptureQuality: qualityProfile.chartCaptureQuality,
      chartCaptureMaxW: qualityProfile.chartCaptureMaxW,
      imageCompression: qualityProfile.imageCompression,
      stripMetadata: qualityProfile.stripMetadata,
      compressStreams: qualityProfile.compressStreams,
      downsampleLogoPx: qualityProfile.downsampleLogoPx,
      bytesPerPixel: qualityProfile.bytesPerPixel
    });

    plan.estimatedBytes = estimatePdfFileSizeBytes(plan, stats);
    return plan;
  }

  // =========================================================================
  // 24-HOUR RESERVATION EXPIRY RADAR & SHIFT HANDOVER SUMMARY
  // =========================================================================

  function parseReservationEndTimestampMs(dateStr, timeStr) {
    var rawDate = convertEasternDigitsToAscii(normalizeStr(dateStr));
    if (!rawDate) return null;

    var rawTime = convertEasternDigitsToAscii(normalizeStr(timeStr));
    // Full ISO timestamp with time zone / T when no separate time override is provided
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawDate) && !rawTime) {
      var parsedIso = Date.parse(rawDate);
      if (!isNaN(parsedIso)) return parsedIso;
    }

    var dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(rawDate);
    if (!dateOnlyMatch) {
      var fallbackMs = Date.parse(rawDate);
      return isNaN(fallbackMs) ? null : fallbackMs;
    }

    var year = parseInt(dateOnlyMatch[1], 10);
    var month = parseInt(dateOnlyMatch[2], 10);
    var day = parseInt(dateOnlyMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    var hh = 23;
    var mm = 59;
    var timeMatch = /^(\d{1,2}):(\d{2})/.exec(rawTime);
    if (timeMatch) {
      hh = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)));
      mm = Math.min(59, Math.max(0, parseInt(timeMatch[2], 10)));
    } else {
      var embeddedTime = /T(\d{2}):(\d{2})/.exec(rawDate);
      if (embeddedTime) {
        hh = Math.min(23, Math.max(0, parseInt(embeddedTime[1], 10)));
        mm = Math.min(59, Math.max(0, parseInt(embeddedTime[2], 10)));
      }
    }

    var dt = new Date(year, month - 1, day, hh, mm, 0, 0);
    var ms = dt.getTime();
    return isNaN(ms) ? null : ms;
  }

  function resolveReservationEffectiveEnd(res) {
    var r = (res && typeof res === 'object') ? res : {};
    var extDate = normalizeStr(r.extendedUntilDate);
    var extTime = normalizeStr(r.extendedUntilTime);
    var endDate = normalizeStr(r.endDate || r.originalEndDate);
    var endTime = normalizeStr(r.endTime || r.originalEndTime);

    var useExt = Boolean(extDate);
    var effDate = useExt ? extDate : endDate;
    var effTime = useExt ? (extTime || endTime || '23:59') : (endTime || '23:59');
    var cleanTime = '';
    var tm = /^(\d{1,2}):(\d{2})/.exec(convertEasternDigitsToAscii(effTime));
    if (tm) {
      cleanTime = padTwoDigits(parseInt(tm[1], 10)) + ':' + padTwoDigits(parseInt(tm[2], 10));
    }

    var tsMs = parseReservationEndTimestampMs(effDate, cleanTime || effTime);
    return {
      date: effDate.substring(0, 10),
      time: cleanTime || '',
      isExtended: useExt || Number(r.extensionsCount || 0) > 0 || Boolean(r.hasExtensions),
      timestampMs: tsMs
    };
  }

  var CLOSED_RESERVATION_STATUSES = [
    'تم الإلغاء', 'تم الالغاء', 'تم الإلغاء من العميل', 'تم الالغاء من العميل', 'ملغي', 'ملغى', 'ملغاة', 'ملغي من العميل',
    'cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer', 'customer_cancelled', 'customer_canceled', 'user_cancelled', 'user_canceled', 'client_cancelled', 'admin_cancelled',
    'لم يتم الحجز',
    'مرفوض', 'مرفوضة', 'تم الرفض', 'مرفوض من الموقع', 'مرفوض من الشركة',
    'rejected', 'declined', 'refused', 'rejected_by_admin', 'rejected_by_company', 'provider_rejected', 'admin_rejected', 'company_rejected', 'auto_rejected',
    'تم الإرجاع', 'تم الاستلام', 'منتهي', 'مكتمل', 'completed', 'returned', 'closed', 'لم يحضر', 'no_show'
  ];

  function isReservationClosedStatus(res) {
    var r = (res && typeof res === 'object') ? res : {};
    if (isInactiveReservation(r)) return true;
    var internal = normalizeStr(r.internalStatus).toLowerCase();
    var origAr = normalizeStr(r.originalStatusAr).toLowerCase();
    var origCode = normalizeStr(r.originalStatusCode).toLowerCase();
    for (var i = 0; i < CLOSED_RESERVATION_STATUSES.length; i++) {
      var st = CLOSED_RESERVATION_STATUSES[i].toLowerCase();
      if (internal === st || origAr === st || origCode === st) {
        return true;
      }
    }
    return false;
  }

  function formatRemainingDurationLabels(diffMs) {
    var isPast = diffMs < 0;
    var absMin = Math.round(Math.abs(diffMs) / 60000);
    var hrs = Math.floor(absMin / 60);
    var mins = absMin % 60;

    if (absMin < 1) {
      return {
        ar: isPast ? 'انتهى للتو' : 'أقل من دقيقة',
        en: isPast ? 'Just expired' : '< 1m left'
      };
    }

    var partsAr = [];
    var partsEn = [];
    if (hrs > 0) {
      partsAr.push(hrs + ' س');
      partsEn.push(hrs + 'h');
    }
    if (mins > 0) {
      partsAr.push(mins + ' د');
      partsEn.push(mins + 'm');
    }
    var bodyAr = partsAr.join(' ');
    var bodyEn = partsEn.join(' ');
    return {
      ar: isPast ? ('منتهي منذ ' + bodyAr) : ('باقي ' + bodyAr),
      en: isPast ? ('Overdue ' + bodyEn) : (bodyEn + ' left')
    };
  }

  function classifyExpiryRadarItem(res, nowMs, options) {
    var opts = options || {};
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var windowHours = Math.max(1, Number(opts.windowHours || 24));
    var gracePastHours = Math.max(0, Number(opts.gracePastHours !== undefined ? opts.gracePastHours : 12));

    if (!res || typeof res !== 'object') return null;
    if (isInactiveReservation(res) || isReservationClosedStatus(res)) return null;

    var eff = resolveReservationEffectiveEnd(res);
    if (eff.timestampMs === null || !isFinite(eff.timestampMs)) return null;

    var diffMs = eff.timestampMs - now;
    var maxFutureMs = windowHours * 3600000;
    var maxPastMs = gracePastHours * 3600000;
    if (diffMs > maxFutureMs || diffMs < -maxPastMs) return null;

    var bucket = 'soon_24h';
    var urgencyRank = 2;
    if (diffMs < 0) {
      bucket = 'expired_unclosed';
      urgencyRank = 0;
    } else if (diffMs <= 6 * 3600000) {
      bucket = 'critical_6h';
      urgencyRank = 1;
    }

    var labels = formatRemainingDurationLabels(diffMs);
    return {
      reservation: res,
      effectiveEndDate: eff.date,
      effectiveEndTime: eff.time,
      effectiveEndTimestampMs: eff.timestampMs,
      isExtended: eff.isExtended,
      diffMs: diffMs,
      diffMinutes: Math.round(diffMs / 60000),
      bucket: bucket,
      urgencyRank: urgencyRank,
      remainingLabelAr: labels.ar,
      remainingLabelEn: labels.en
    };
  }

  function computeExpiryRadarSummary(reservations, nowMs, options) {
    var list = Array.isArray(reservations) ? reservations : [];
    var opts = options || {};
    var subFilter = normalizeStr(opts.subFilter || 'all').toLowerCase();
    var search = normalizeStr(opts.search);

    var allMatches = [];
    var critical6hCount = 0;
    var soon24hCount = 0;
    var expiredUnclosedCount = 0;
    var extendedInRadarCount = 0;

    for (var i = 0; i < list.length; i++) {
      var item = classifyExpiryRadarItem(list[i], nowMs, opts);
      if (!item) continue;
      if (item.bucket === 'expired_unclosed') expiredUnclosedCount += 1;
      else if (item.bucket === 'critical_6h') critical6hCount += 1;
      else soon24hCount += 1;
      if (item.isExtended) extendedInRadarCount += 1;
      allMatches.push(item);
    }

    allMatches.sort(function (a, b) {
      if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
      return a.effectiveEndTimestampMs - b.effectiveEndTimestampMs;
    });

    var filtered = allMatches.filter(function (entry) {
      if (subFilter === 'critical_6h' && entry.bucket !== 'critical_6h') return false;
      if (subFilter === 'soon_24h' && entry.bucket === 'expired_unclosed') return false;
      if (subFilter === 'expired_unclosed' && entry.bucket !== 'expired_unclosed') return false;
      if (search) {
        var r = entry.reservation || {};
        if (!matchesSearchFields([
          r.reservationNumber,
          r.customerName,
          r.customerPhone,
          r.carName,
          r.plateNumber,
          r.companyName,
          r.branchName
        ], search)) {
          return false;
        }
      }
      return true;
    });

    return {
      items: filtered,
      allItems: allMatches,
      totalCount: allMatches.length,
      upcoming24hCount: critical6hCount + soon24hCount,
      critical6hCount: critical6hCount,
      soon24hCount: soon24hCount,
      expiredUnclosedCount: expiredUnclosedCount,
      extendedInRadarCount: extendedInRadarCount
    };
  }

  function normalizeWhatsappPhone(phone) {
    var digits = convertEasternDigitsToAscii(normalizeStr(phone)).replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.indexOf('05') === 0 && digits.length === 10) return '966' + digits.slice(1);
    if (digits.indexOf('5') === 0 && digits.length === 9) return '966' + digits;
    return digits;
  }

  function buildExtensionOfferMessage(res, lang, options) {
    var r = (res && typeof res === 'object') ? res : {};
    var isEn = lang === 'en';
    var eff = resolveReservationEffectiveEnd(r);
    var endDisp = formatDisplayDate(eff.date || r.endDate || '');
    var timeDisp = eff.time ? (' ' + eff.time) : '';
    var custName = normalizeStr(r.customerName) || (isEn ? 'Valued Customer' : 'عميلنا الكريم');
    var resNum = normalizeStr(r.reservationNumber || r.id) || '-';
    var carName = normalizeStr(r.carName) || (isEn ? 'your vehicle' : 'مركبتك');
    var company = normalizeStr(r.companyName);
    var agentName = normalizeStr(options && options.agentName);

    if (isEn) {
      return 'Hello ' + custName + ',\n' +
        'This is Rental Gate Customer Care' + (agentName ? (' (' + agentName + ')') : '') + '.\n' +
        'Your rental reservation #' + resNum + ' (' + carName + (company ? ' - ' + company : '') + ') is scheduled to end on ' +
        endDisp + timeDisp + '.\n' +
        'Would you like us to extend your contract smoothly before expiry, or confirm your return details?';
    }
    return 'السلام عليكم أ/ ' + custName + '،\n' +
      'معك فريق خدمة العملاء في Rental Gate' + (agentName ? (' (' + agentName + ')') : '') + '.\n' +
      'نود تذكيركم بأن حجزكم رقم ' + resNum + ' (' + carName + (company ? ' - ' + company : '') + ') يقترب من موعد الانتهاء بتاريخ ' +
      endDisp + timeDisp + '.\n' +
      'هل ترغبون في تمديد مدة الإيجار قبل انتهاء العقد لنجهز لكم الإجراء فوراً أم تأكيد موعد التسليم؟';
  }

  var SHIFT_HANDOVER_PRESETS = [
    { key: '8h', labelAr: 'آخر 8 ساعات', labelEn: 'Last 8 Hours' },
    { key: '12h', labelAr: 'آخر 12 ساعة', labelEn: 'Last 12 Hours' },
    { key: 'today', labelAr: 'وردية اليوم', labelEn: "Today's Shift" },
    { key: 'yesterday', labelAr: 'وردية الأمس', labelEn: "Yesterday's Shift" },
    { key: 'custom', labelAr: 'نطاق مخصص', labelEn: 'Custom Range' }
  ];

  var HANDOVER_SETTINGS_DEFAULTS = {
    defaultPreset: '8h',
    defaultTimeFrom: '',
    defaultTimeTo: '',
    includeTodayMovements: true,
    includePending: true,
    includeClosed: true,
    includeOpenProblems: true,
    includeExpiring24h: true,
    autoIncludeNotes: true
  };

  function normalizeHandoverSettings(raw) {
    var input = raw;
    if (typeof raw === 'string') {
      try {
        input = JSON.parse(raw);
      } catch (_e) {
        input = {};
      }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var validPresets = ['8h', '12h', 'today', 'yesterday', 'custom'];
    var preset = normalizeStr(obj.defaultPreset || HANDOVER_SETTINGS_DEFAULTS.defaultPreset).toLowerCase();
    if (validPresets.indexOf(preset) === -1) preset = '8h';
    function pickBool(k) {
      if (obj[k] === undefined || obj[k] === null) return HANDOVER_SETTINGS_DEFAULTS[k];
      return obj[k] === true || obj[k] === 'true' || obj[k] === 1;
    }
    return {
      defaultPreset: preset,
      defaultTimeFrom: normalizeTimeHHmm(obj.defaultTimeFrom, ''),
      defaultTimeTo: normalizeTimeHHmm(obj.defaultTimeTo, ''),
      includeTodayMovements: pickBool('includeTodayMovements'),
      includePending: pickBool('includePending'),
      includeClosed: pickBool('includeClosed'),
      includeOpenProblems: pickBool('includeOpenProblems'),
      includeExpiring24h: pickBool('includeExpiring24h'),
      autoIncludeNotes: pickBool('autoIncludeNotes')
    };
  }

  var HANDOVER_PDF_VISIBILITY_DEFAULTS = {
    includeSummaryKpis: true,
    includeTodayMovements: true,
    splitPickupsAndReturns: false,
    includePending: true,
    includeClosed: true,
    includeOpenProblems: true,
    includeExpiring24h: true,
    autoIncludeNotes: true,
    includeCustomerPhone: true,
    colCategory: true,
    colReservationNumber: true,
    colCustomerName: true,
    colCarName: true,
    colStatus: true,
    colPriority: true,
    colLastUpdate: true
  };

  function normalizeHandoverPdfVisibility(raw, baseHandoverSettings) {
    var input = raw;
    if (typeof raw === 'string') {
      try {
        input = JSON.parse(raw);
      } catch (_e) {
        input = {};
      }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var base = baseHandoverSettings ? normalizeHandoverSettings(baseHandoverSettings) : null;
    function pickFlag(k) {
      if (obj[k] !== undefined && obj[k] !== null) {
        return obj[k] === true || obj[k] === 'true' || obj[k] === 1;
      }
      if (base && base[k] !== undefined) {
        return Boolean(base[k]);
      }
      return Boolean(HANDOVER_PDF_VISIBILITY_DEFAULTS[k]);
    }
    return {
      includeSummaryKpis: pickFlag('includeSummaryKpis'),
      includeTodayMovements: pickFlag('includeTodayMovements'),
      splitPickupsAndReturns: pickFlag('splitPickupsAndReturns'),
      includePending: pickFlag('includePending'),
      includeClosed: pickFlag('includeClosed'),
      includeOpenProblems: pickFlag('includeOpenProblems'),
      includeExpiring24h: pickFlag('includeExpiring24h'),
      autoIncludeNotes: pickFlag('autoIncludeNotes'),
      includeCustomerPhone: pickFlag('includeCustomerPhone'),
      colCategory: pickFlag('colCategory'),
      colReservationNumber: pickFlag('colReservationNumber'),
      colCustomerName: pickFlag('colCustomerName'),
      colCarName: pickFlag('colCarName'),
      colStatus: pickFlag('colStatus'),
      colPriority: pickFlag('colPriority'),
      colLastUpdate: pickFlag('colLastUpdate')
    };
  }

  function resolveShiftWindow(preset, customFrom, customTo, nowMs, timeOpts) {
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var key = normalizeStr(preset || '8h').toLowerCase();
    var nowDate = new Date(now);
    var todayStr = formatIsoDateParts(nowDate.getFullYear(), nowDate.getMonth() + 1, nowDate.getDate());
    var tOpts = (timeOpts && typeof timeOpts === 'object') ? timeOpts : {};
    var timeFromClean = normalizeTimeHHmm(tOpts.timeFrom, '');
    var timeToClean = normalizeTimeHHmm(tOpts.timeTo, '');
    var hasTimeRange = Boolean(timeFromClean || timeToClean);

    var fromParts = timeFromClean ? timeFromClean.split(':') : ['00', '00'];
    var toParts = timeToClean ? timeToClean.split(':') : ['23', '59'];
    var fH = parseInt(fromParts[0], 10) || 0;
    var fM = parseInt(fromParts[1], 10) || 0;
    var tH = parseInt(toParts[0], 10);
    var tM = parseInt(toParts[1], 10);
    if (isNaN(tH)) tH = 23;
    if (isNaN(tM)) tM = 59;

    var startMs;
    var endMs = now;
    var labelAr = 'آخر 8 ساعات';
    var labelEn = 'Last 8 Hours';

    if (key === '12h') {
      if (hasTimeRange) {
        startMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), fH, fM, 0, 0).getTime();
        endMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), tH, tM, 59, 999).getTime();
      } else {
        startMs = now - 12 * 3600000;
      }
      labelAr = 'آخر 12 ساعة';
      labelEn = 'Last 12 Hours';
    } else if (key === 'today') {
      startMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hasTimeRange ? fH : 0, hasTimeRange ? fM : 0, 0, 0).getTime();
      endMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hasTimeRange ? tH : 23, hasTimeRange ? tM : 59, 59, 999).getTime();
      labelAr = 'وردية اليوم (' + formatDisplayDate(todayStr) + ')';
      labelEn = "Today's Shift (" + formatDisplayDate(todayStr) + ')';
    } else if (key === 'yesterday') {
      var yDate = new Date(now - 86400000);
      var yStr = formatIsoDateParts(yDate.getFullYear(), yDate.getMonth() + 1, yDate.getDate());
      startMs = new Date(yDate.getFullYear(), yDate.getMonth(), yDate.getDate(), hasTimeRange ? fH : 0, hasTimeRange ? fM : 0, 0, 0).getTime();
      endMs = new Date(yDate.getFullYear(), yDate.getMonth(), yDate.getDate(), hasTimeRange ? tH : 23, hasTimeRange ? tM : 59, 59, 999).getTime();
      labelAr = 'وردية الأمس (' + formatDisplayDate(yStr) + ')';
      labelEn = "Yesterday's Shift (" + formatDisplayDate(yStr) + ')';
    } else if (key === 'custom') {
      var parsedFrom = parseIsoDateStrict(customFrom);
      var parsedTo = parseIsoDateStrict(customTo);
      var fromObj = parsedFrom
        ? new Date(parsedFrom.year, parsedFrom.month - 1, parsedFrom.day, hasTimeRange ? fH : 0, hasTimeRange ? fM : 0, 0, 0)
        : new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hasTimeRange ? fH : 0, hasTimeRange ? fM : 0, 0, 0);
      var toObj = parsedTo
        ? new Date(parsedTo.year, parsedTo.month - 1, parsedTo.day, hasTimeRange ? tH : 23, hasTimeRange ? tM : 59, 59, 999)
        : (hasTimeRange
          ? new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), tH, tM, 59, 999)
          : new Date(now));
      if (fromObj.getTime() > toObj.getTime()) {
        var swapTmp = fromObj;
        fromObj = toObj;
        toObj = new Date(swapTmp.getFullYear(), swapTmp.getMonth(), swapTmp.getDate(), hasTimeRange ? tH : 23, hasTimeRange ? tM : 59, 59, 999);
      }
      startMs = fromObj.getTime();
      endMs = toObj.getTime();
      var fStr = formatIsoDateParts(fromObj.getFullYear(), fromObj.getMonth() + 1, fromObj.getDate());
      var tStr = formatIsoDateParts(toObj.getFullYear(), toObj.getMonth() + 1, toObj.getDate());
      labelAr = 'نطاق مخصص (' + formatDisplayDate(fStr) + ' ← ' + formatDisplayDate(tStr) + ')';
      labelEn = 'Custom (' + formatDisplayDate(fStr) + ' -> ' + formatDisplayDate(tStr) + ')';
    } else {
      key = '8h';
      if (hasTimeRange) {
        startMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), fH, fM, 0, 0).getTime();
        endMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), tH, tM, 59, 999).getTime();
      } else {
        startMs = now - 8 * 3600000;
      }
    }

    if (hasTimeRange) {
      if (startMs > endMs) {
        var sSwap = startMs;
        startMs = endMs;
        endMs = sSwap;
      }
      var timeTag = ' [' + (timeFromClean || '00:00') + ' - ' + (timeToClean || '23:59') + ']';
      labelAr += timeTag;
      labelEn += timeTag;
    }

    return {
      preset: key,
      startMs: startMs,
      endMs: endMs,
      timeFrom: timeFromClean,
      timeTo: timeToClean,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      labelAr: labelAr,
      labelEn: labelEn
    };
  }

  function parseTimestampLooseMs(val) {
    var s = normalizeStr(val);
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return parseReservationEndTimestampMs(s, '12:00');
    }
    var ms = Date.parse(s);
    if (!isNaN(ms)) return ms;
    return parseReservationEndTimestampMs(s.substring(0, 10), '');
  }

  function isRecordInShiftWindow(tsValues, win) {
    for (var i = 0; i < tsValues.length; i++) {
      var ms = parseTimestampLooseMs(tsValues[i]);
      if (ms !== null && ms >= win.startMs && ms <= win.endMs) {
        return true;
      }
    }
    return false;
  }

  var PENDING_WORKFLOW_STATUSES = [
    'تم الإنشاء', 'جديد', 'قيد الانتظار', 'معلق', 'بانتظار الدفع', 'تم الحجز'
  ];

  function computeShiftHandoverSummary(input) {
    var cfg = (input && typeof input === 'object') ? input : {};
    var reservations = Array.isArray(cfg.reservations) ? cfg.reservations : [];
    var problems = Array.isArray(cfg.problems) ? cfg.problems : [];
    var followUps = Array.isArray(cfg.followUps) ? cfg.followUps : [];
    var nowMs = (typeof cfg.nowMs === 'number' && isFinite(cfg.nowMs)) ? cfg.nowMs : Date.now();
    var hSettings = normalizeHandoverSettings(cfg.handoverSettings);
    var win = cfg.shiftWindow && typeof cfg.shiftWindow.startMs === 'number'
      ? cfg.shiftWindow
      : resolveShiftWindow(cfg.preset || hSettings.defaultPreset || '8h', cfg.dateFrom, cfg.dateTo, nowMs, {
          timeFrom: cfg.timeFrom !== undefined ? cfg.timeFrom : hSettings.defaultTimeFrom,
          timeTo: cfg.timeTo !== undefined ? cfg.timeTo : hSettings.defaultTimeTo
        });

    var followedSet = {};
    var shiftFollowUps = [];
    for (var fi = 0; fi < followUps.length; fi++) {
      var fu = followUps[fi];
      if (!fu) continue;
      if (fu.reservationId) followedSet[fu.reservationId] = true;
      if (isRecordInShiftWindow([fu.createdAt, fu.followUpDate], win)) {
        shiftFollowUps.push(fu);
      }
    }

    var closedReservations = [];
    var pendingReservations = [];
    var activeHealthyCount = 0;

    for (var ri = 0; ri < reservations.length; ri++) {
      var r = reservations[ri];
      if (!r) continue;
      var enriched = Object.assign({}, r, { isFollowed: Boolean(r.isFollowed || followedSet[r.id]) });
      var isClosed = isReservationClosedStatus(enriched);

      if (isClosed) {
        if (isRecordInShiftWindow([enriched.lastUpdatedAt, enriched.updatedAt, enriched.endDate], win)) {
          closedReservations.push(enriched);
        }
        continue;
      }

      var st = normalizeStr(enriched.internalStatus);
      var origSt = normalizeStr(enriched.originalStatusAr);
      var assigned = Array.isArray(enriched.assignedEmployeeIds) ? enriched.assignedEmployeeIds : [];
      var needsFollow = PENDING_WORKFLOW_STATUSES.indexOf(st) !== -1 ||
        PENDING_WORKFLOW_STATUSES.indexOf(origSt) !== -1 ||
        !enriched.isFollowed ||
        assigned.length === 0 ||
        Boolean(enriched.hasProblem);

      if (needsFollow) {
        pendingReservations.push(enriched);
      } else {
        activeHealthyCount += 1;
      }
    }

    // Sort closed newest first, pending by problem/priority/unassigned then newest
    closedReservations.sort(function (a, b) {
      return String(b.lastUpdatedAt || b.updatedAt || '').localeCompare(String(a.lastUpdatedAt || a.updatedAt || ''));
    });

    var prioOrder = { 'مرتفع': 0, 'متوسط': 1, 'عادي': 2 };
    pendingReservations.sort(function (a, b) {
      var pa = a.hasProblem ? -1 : (prioOrder[a.priority] !== undefined ? prioOrder[a.priority] : 2);
      var pb = b.hasProblem ? -1 : (prioOrder[b.priority] !== undefined ? prioOrder[b.priority] : 2);
      if (pa !== pb) return pa - pb;
      return String(b.lastUpdatedAt || b.createdAt || '').localeCompare(String(a.lastUpdatedAt || a.createdAt || ''));
    });

    var openProblems = problems.filter(function (p) {
      return p && !isProblemClosedStatus(p.status);
    }).sort(function (a, b) {
      var pa = prioOrder[a.priority] !== undefined ? prioOrder[a.priority] : 2;
      var pb = prioOrder[b.priority] !== undefined ? prioOrder[b.priority] : 2;
      if (pa !== pb) return pa - pb;
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });

    var closedProblemsInShift = problems.filter(function (p) {
      return p && isProblemClosedStatus(p.status) && isRecordInShiftWindow([p.updatedAt, p.createdAt], win);
    });

    var radar = computeExpiryRadarSummary(reservations, nowMs, { windowHours: 24, gracePastHours: 12 });
    var todayMovementsSummary = computeTodayMovementsSummary(reservations, nowMs, {
      timeFrom: win.timeFrom,
      timeTo: win.timeTo
    });
    var highPriorityProblemsCount = openProblems.filter(function (p) { return p.priority === 'مرتفع'; }).length;

    return {
      shiftWindow: win,
      handoverSettings: hSettings,
      generatedAtIso: new Date(nowMs).toISOString(),
      staffName: normalizeStr(cfg.staffName) || 'مشرف الوردية',
      notes: normalizeStr(cfg.notes),
      closedReservations: closedReservations,
      pendingReservations: pendingReservations,
      openProblems: openProblems,
      closedProblemsInShift: closedProblemsInShift,
      expiring24h: radar.items,
      todayMovements: todayMovementsSummary.items,
      todayMovementsStats: {
        totalCount: todayMovementsSummary.items.length,
        pickupCount: todayMovementsSummary.items.filter(function (it) { return it.movementType === 'pickup'; }).length,
        returnCount: todayMovementsSummary.items.filter(function (it) { return it.movementType === 'return'; }).length,
        pendingPickupCount: todayMovementsSummary.items.filter(function (it) { return it.movementType === 'pickup' && !it.isCompleted; }).length,
        pendingReturnCount: todayMovementsSummary.items.filter(function (it) { return it.movementType === 'return' && !it.isCompleted; }).length,
        overdueCount: todayMovementsSummary.items.filter(function (it) { return it.isOverdue; }).length
      },
      shiftFollowUps: shiftFollowUps,
      counts: {
        closedCount: closedReservations.length,
        pendingCount: pendingReservations.length,
        activeHealthyCount: activeHealthyCount,
        openProblemsCount: openProblems.length,
        highPriorityProblemsCount: highPriorityProblemsCount,
        closedProblemsCount: closedProblemsInShift.length,
        expiring24hCount: radar.totalCount,
        followUpsCount: shiftFollowUps.length,
        todayMovementsCount: todayMovementsSummary.items.length
      }
    };
  }

  function buildShiftHandoverPdfPayload(summary, lang, options) {
    var s = (summary && typeof summary === 'object') ? summary : computeShiftHandoverSummary({});
    var isEn = lang === 'en';
    var timeFmt = normalizeTimeFormat(options && options.timeFormat);
    var win = s.shiftWindow || {};
    var counts = s.counts || {};
    var hSettings = normalizeHandoverSettings((options && options.handoverSettings) || s.handoverSettings);
    var vis = normalizeHandoverPdfVisibility(options && options.pdfVisibility, hSettings);
    var winLabel = isEn ? (win.labelEn || '') : (win.labelAr || '');

    var title = isEn
      ? ('Shift Handover Report — ' + winLabel)
      : ('ملخص تسليم الوردية — ' + winLabel);

    var summaryItems = [];
    if (vis.includeSummaryKpis) {
      summaryItems.push(
        { label: isEn ? 'Shift Supervisor' : 'مسؤول التسليم', value: s.staffName || '-' },
        { label: isEn ? 'Closed Bookings' : 'الحجوزات المغلقة', value: String(counts.closedCount || 0) },
        { label: isEn ? 'Pending / Action Needed' : 'قيد الانتظار / المتابعة', value: String(counts.pendingCount || 0) },
        { label: isEn ? 'Open Problems' : 'المشكلات المفتوحة', value: String(counts.openProblemsCount || 0) },
        { label: isEn ? 'Expiring ≤ 24h' : 'تنتهي خلال 24 ساعة', value: String(counts.expiring24hCount || 0) },
        { label: isEn ? "Today's Pickups & Returns" : 'التسليم والاستلام اليوم', value: String(counts.todayMovementsCount || 0) },
        { label: isEn ? 'Shift Follow-Ups' : 'متابعات الوردية', value: String(counts.followUpsCount || 0) }
      );
    }
    if (vis.autoIncludeNotes && s.notes) {
      summaryItems.push({
        label: isEn ? 'Handover Notes for Next Shift' : 'ملاحظات التسليم للوردية التالية',
        value: s.notes
      });
    }

    var allColumns = [
      { flag: 'colCategory', key: 'category', label: 'التصنيف', labelEn: 'Category', widthWeight: 1.0 },
      { flag: 'colReservationNumber', key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Booking #', formatType: 'ltr', widthWeight: 1.05 },
      { flag: 'colCustomerName', key: 'customerName', label: 'العميل', labelEn: 'Customer', widthWeight: 1.25 },
      { flag: 'colCarName', key: 'carName', label: 'السيارة', labelEn: 'Vehicle', widthWeight: 1.15 },
      { flag: 'colStatus', key: 'internalStatus', label: 'الحالة', labelEn: 'Status', widthWeight: 1.0 },
      { flag: 'colPriority', key: 'priority', label: 'الأولوية', labelEn: 'Priority', widthWeight: 0.75 },
      { flag: 'colLastUpdate', key: 'lastUpdateText', label: 'آخر تحديث / إجراء مطلوب', labelEn: 'Last Update / Next Action', widthWeight: 1.75 }
    ];
    var includeAnyTableRows = Boolean(vis.includePending || vis.includeClosed);
    var columns = includeAnyTableRows
      ? allColumns.filter(function (c) { return Boolean(vis[c.flag]); }).map(function (c) {
          var colObj = { key: c.key, label: c.label, labelEn: c.labelEn, widthWeight: c.widthWeight };
          if (c.formatType) colObj.formatType = c.formatType;
          return colObj;
        })
      : [];

    var rows = [];
    if (columns.length > 0 && vis.includePending) {
      (s.pendingReservations || []).forEach(function (r) {
        rows.push({
          category: isEn ? 'Pending' : 'قيد الانتظار',
          reservationNumber: r.reservationNumber || '-',
          customerName: (r.customerName || '-') + (vis.includeCustomerPhone && r.customerPhone ? (' (' + r.customerPhone + ')') : ''),
          carName: r.carName || '-',
          internalStatus: r.internalStatus || r.originalStatusAr || '-',
          priority: r.priority || 'عادي',
          lastUpdateText: r.lastUpdateText || (isEn ? 'Needs follow-up' : 'تحتاج متابعة')
        });
      });
    }
    if (columns.length > 0 && vis.includeClosed) {
      (s.closedReservations || []).forEach(function (r) {
        rows.push({
          category: isEn ? 'Closed' : 'مغلق في الوردية',
          reservationNumber: r.reservationNumber || '-',
          customerName: (r.customerName || '-') + (vis.includeCustomerPhone && r.customerPhone ? (' (' + r.customerPhone + ')') : ''),
          carName: r.carName || '-',
          internalStatus: r.internalStatus || r.originalStatusAr || '-',
          priority: r.priority || 'عادي',
          lastUpdateText: r.lastUpdateText || '-'
        });
      });
    }

    var extraSections = [];
    var todayMvs = s.todayMovements || [];
    var tables = [];

    if (vis.includeTodayMovements && vis.splitPickupsAndReturns) {
      var pickupRows = [];
      var returnRows = [];
      todayMvs.forEach(function (it) {
        var r = it.reservation || {};
        var tDisp = it.scheduledTime ? formatTimePreference(it.scheduledTime, timeFmt, lang) : '-';
        var branchVal = it.movementType === 'return'
          ? ((r.deliverBranchName || r.branchName || '-'))
          : (r.branchName || '-');
        var rowObj = {
          scheduledTime: tDisp,
          reservationNumber: r.reservationNumber || r.id || '-',
          customerName: (r.customerName || '-') + (vis.includeCustomerPhone && r.customerPhone ? (' (' + r.customerPhone + ')') : ''),
          carName: r.carName || '-',
          branchLocation: [r.companyName || '', branchVal].filter(Boolean).join(' — ') || '-',
          statusText: it.isCompleted
            ? (isEn ? 'Completed' : 'مكتمل')
            : (it.isOverdue ? (isEn ? 'Overdue' : 'متأخر') : (r.internalStatus || (isEn ? 'Scheduled' : 'مجدول')))
        };
        if (it.movementType === 'return') returnRows.push(rowObj);
        else pickupRows.push(rowObj);
      });

      var movementCols = [
        { key: 'scheduledTime', label: 'الوقت', labelEn: 'Time', formatType: 'ltr', widthWeight: 0.85 },
        { key: 'reservationNumber', label: 'رقم الحجز', labelEn: 'Booking #', formatType: 'ltr', widthWeight: 1.05 },
        { key: 'customerName', label: 'العميل', labelEn: 'Customer', widthWeight: 1.35 },
        { key: 'carName', label: 'السيارة', labelEn: 'Vehicle', widthWeight: 1.15 },
        { key: 'branchLocation', label: 'الشركة / الفرع', labelEn: 'Company / Branch', widthWeight: 1.25 },
        { key: 'statusText', label: 'الحالة', labelEn: 'Status', widthWeight: 0.9 }
      ];

      tables.push({
        kind: 'pickups',
        title: (isEn ? "Today's Pickups — Handing Over to Customer (" : 'قسم التسليم اليوم — تسليم السيارة للعميل (') + pickupRows.length + ')',
        columns: movementCols,
        rows: pickupRows
      });
      tables.push({
        kind: 'returns',
        title: (isEn ? "Today's Returns — Receiving Back from Customer (" : 'قسم الاستلام / الإرجاع اليوم — استلام السيارة من العميل (') + returnRows.length + ')',
        columns: movementCols,
        rows: returnRows
      });
    } else if (vis.includeTodayMovements && todayMvs.length > 0) {
      extraSections.push({
        title: (isEn ? "Today's Pickups & Returns (" : 'التسليم والاستلام اليوم (') + todayMvs.length + ')',
        lines: todayMvs.map(function (it) {
          var r = it.reservation || {};
          var kind = it.movementType === 'pickup' ? (isEn ? 'Pickup' : 'تسليم') : (isEn ? 'Return' : 'استلام');
          var tDisp = it.scheduledTime ? formatTimePreference(it.scheduledTime, timeFmt, lang) : '-';
          var phonePart = (vis.includeCustomerPhone && r.customerPhone) ? (' (' + r.customerPhone + ')') : '';
          return '[' + kind + ' ' + tDisp + '] ' + (r.reservationNumber || '-') + ' | ' + (r.customerName || '-') +
            phonePart + ' | ' + (r.carName || '-') + ' — ' + (r.branchName || '-');
        })
      });
    }

    var openPrbs = s.openProblems || [];
    if (vis.includeOpenProblems && openPrbs.length > 0) {
      extraSections.push({
        title: (isEn ? 'Open Problems to Hand Over (' : 'المشكلات المفتوحة المسلّمة للوردية التالية (') + openPrbs.length + ')',
        lines: openPrbs.map(function (p) {
          return (p.problemNumber || '-') + ' | ' + (p.reservationNumber || '-') + ' | ' + (p.customerName || '-') +
            ' [' + (p.priority || 'عادي') + ' - ' + (p.status || '-') + ']: ' + (p.description || '-');
        })
      });
    }

    var expList = s.expiring24h || [];
    if (vis.includeExpiring24h && expList.length > 0) {
      extraSections.push({
        title: (isEn ? '24h Expiry Radar Alerts (' : 'تنبيهات انتهاء الحجوزات خلال 24 ساعة (') + expList.length + ')',
        lines: expList.map(function (it) {
          var r = it.reservation || {};
          var rem = isEn ? it.remainingLabelEn : it.remainingLabelAr;
          var endTimeDisp = it.effectiveEndTime ? formatTimePreference(it.effectiveEndTime, timeFmt, lang) : '';
          var phonePart = (vis.includeCustomerPhone && r.customerPhone) ? (' (' + r.customerPhone + ')') : '';
          return (r.reservationNumber || '-') + ' | ' + (r.customerName || '-') + phonePart + ' | ' +
            (r.carName || '-') + ' — ' + rem + ' (' + formatDisplayDate(it.effectiveEndDate) + (endTimeDisp ? ' ' + endTimeDisp : '') + ')';
        })
      });
    }

    if (tables.length > 0 && columns.length > 0) {
      tables.push({
        kind: 'shift_bookings',
        title: (isEn ? 'Pending & Closed Shift Bookings (' : 'الحجوزات قيد المتابعة والمغلقة في الوردية (') + rows.length + ')',
        columns: columns,
        rows: rows
      });
    }

    var dateSlug = String(s.generatedAtIso || '').substring(0, 10) || 'shift';
    return {
      title: title,
      filename: 'rental-gate-shift-handover-' + dateSlug + '.pdf',
      summaryItems: summaryItems,
      columns: columns,
      rows: rows,
      tables: tables,
      extraSections: extraSections
    };
  }

  // ---------- TODAY'S PICKUPS & RETURNS RADAR ----------

  var EXPLICIT_ACTIVE_STATUS_VALUES = [
    'confirmed', 'completed', 'finished', 'closed', 'ended', 'active', 'started',
    'finished_by_driver', 'in_progress', 'booked', 'reserved', 'delivered', 'picked_up',
    'received', 'on_rent', 'rented', 'car_received', 'ongoing', 'returned', 'extended',
    'automatically_extended', 'approved', 'accepted', 'admin_approved', 'paid',
    'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'hold', 'on_hold', 'onhold',
    'suspended', 'suspend', 'paused', 'pause', 'frozen', 'hold_by_admin', 'admin_hold',
    'waiting_approval', 'waiting_confirmation', 'pending_approval', 'pending_confirmation',
    'under_review', 'ready', 'ready_for_pickup', 'ready_to_pickup', 'on_the_way',
    'pending', 'new', 'created', 'expired', 'no_show', 'draft', 'unpaid',
    'waiting_payment', 'awaiting_payment', 'pending_payment', 'location_changed',
    'مؤكد', 'منتهي', 'مكتمل', 'نشط الآن', 'نشط الان', 'ناشط', 'نشط',
    'تم التسليم', 'تم التسليم من قبل السائق', 'تم الاستلام', 'تم الإرجاع', 'تم الارجاع',
    'تم التمديد', 'تم التمديد تلقائيًا', 'تم التمديد تلقائيا', 'مقبول', 'معتمد إداريًا', 'معتمد اداريا',
    'مدفوع', 'مدفوع عن طريق المحفظة', 'مدفوع بالمحفظة', 'تم الحجز', 'معلق',
    'قيد الانتظار', 'قيد التنفيذ', 'بدأ التنفيذ', 'جديد', 'في الطريق',
    'جاهز للاستلام', 'تم تغيير الموقع', 'بانتظار الدفع', 'غير مدفوع',
    'لم يحضر', 'مسودة', 'تم الإنشاء', 'تم الانشاء', 'لم يتم الحجز'
  ];

  var REJECTED_STATUS_VALUES = [
    'مرفوض', 'مرفوضة', 'تم الرفض', 'تم الرفض من الشركة', 'تم الرفض من المزود', 'مرفوض من الموقع', 'مرفوض من الشركة', 'مرفوض من المزود', 'مرفوض من الادارة', 'مرفوض من الإدارة', 'مرفوض تلقائيا', 'مرفوض تلقائياً',
    'rejected', 'declined', 'refused', 'rejected_by_admin', 'rejected_by_company', 'rejected_by_provider', 'rejected_by_customer', 'rejected_by_client', 'rejected_by_user', 'provider_rejected', 'admin_rejected', 'company_rejected', 'customer_rejected', 'client_rejected', 'user_rejected', 'auto_rejected', 'system_rejected', 'declined_by_admin', 'declined_by_company', 'declined_by_provider', 'refused_by_admin', 'refused_by_company', 'refused_by_provider', 'declined_by_user', 'declined_by_client', 'declined_by_customer', 'refused_by_user', 'refused_by_client', 'refused_by_customer'
  ];

  var CANCELLED_STATUS_VALUES = [
    'تم الإلغاء', 'تم الالغاء', 'تم الإلغاء من العميل', 'تم الالغاء من العميل', 'تم الإلغاء من الشركة', 'تم الالغاء من الشركة',
    'الغاء العميل', 'إلغاء العميل', 'الغاء الحجز', 'إلغاء الحجز',
    'ملغي', 'ملغى', 'ملغاة', 'ملغي من العميل', 'ملغى من العميل', 'ملغاة من العميل', 'ملغي من الشركة', 'ملغى من الشركة', 'ملغي من الادارة', 'ملغي من الإدارة', 'ملغى من الادارة', 'ملغى من الإدارة', 'ملغي تلقائيا', 'ملغي تلقائياً',
    'cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer', 'cancelled_by_client', 'canceled_by_client', 'cancelled_by_user', 'canceled_by_user', 'cancelled_by_admin', 'canceled_by_admin', 'cancelled_by_provider', 'canceled_by_provider', 'cancelled_by_company', 'canceled_by_company', 'customer_cancelled', 'customer_canceled', 'user_cancelled', 'user_canceled', 'client_cancelled', 'client_canceled', 'admin_cancelled', 'admin_canceled', 'provider_cancelled', 'provider_canceled', 'company_cancelled', 'company_canceled', 'system_cancelled', 'system_canceled', 'auto_cancelled', 'auto_canceled'
  ];

  var REJECTION_REASONS_LIST = [
    'عدم توفر السيارة',
    'رفض الشركة للعميل',
    'مشكلة في الهوية أو الرخصة',
    'تعديل السعر أو شروط الدفع',
    'تم التحويل لشركة أخرى',
    'عدم مطابقة شروط العمر أو التأمين',
    'طلب العميل إلغاء الطلب',
    'أخرى'
  ];

  var CANCELLATION_REASONS_LIST = [
    'طلب العميل',
    'تغيير الموعد أو السفر',
    'عدم الحضور للاستلام',
    'عدم اكتمال السداد',
    'عدم توفر المركبة بالفرع',
    'حجز مكرر',
    'أخرى'
  ];

  var CAR_STATUS_AT_REQUEST_OPTIONS = [
    'متاحة عند الطلب',
    'غير متاحة',
    'تحتاج تأكيد الفرع',
    'مؤجرة مسبقاً',
    'قيد الصيانة',
    'تم التحويل لشركة أخرى'
  ];

  function matchesStatusList(val, list) {
    var norm = normalizeSearchText(val);
    if (!norm) return false;
    var underscoreNorm = norm.replace(/[\s-]+/g, '_');
    for (var i = 0; i < list.length; i++) {
      var target = normalizeSearchText(list[i]);
      if (norm === target || underscoreNorm === target.replace(/[\s-]+/g, '_')) return true;
    }
    return false;
  }

  function isExplicitActiveStatusToken(val) {
    var norm = normalizeSearchText(val);
    if (!norm || norm === 'غير محدد') return false;
    if (isRejectedToken(norm) || isCancelledToken(norm)) return false;
    return matchesStatusList(norm, EXPLICIT_ACTIVE_STATUS_VALUES);
  }

  function isRejectedToken(val) {
    var norm = normalizeSearchText(val);
    if (!norm || norm === 'غير محدد') return false;
    if (matchesStatusList(norm, REJECTED_STATUS_VALUES)) return true;
    var u = norm.replace(/[\s-]+/g, '_');
    if (
      u.indexOf('rejected_by_') === 0 ||
      u.indexOf('declined_by_') === 0 ||
      u.indexOf('refused_by_') === 0 ||
      /_rejected$/.test(u) ||
      /_declined$/.test(u) ||
      /_refused$/.test(u) ||
      norm.indexOf('مرفوض') === 0 ||
      norm.indexOf('تم الرفض') === 0
    ) {
      return true;
    }
    return false;
  }

  function isCancelledToken(val) {
    var norm = normalizeSearchText(val);
    if (!norm || norm === 'غير محدد') return false;
    if (matchesStatusList(norm, CANCELLED_STATUS_VALUES)) return true;
    var u = norm.replace(/[\s-]+/g, '_');
    if (
      u.indexOf('cancelled_by_') === 0 ||
      u.indexOf('canceled_by_') === 0 ||
      /_cancelled$/.test(u) ||
      /_canceled$/.test(u) ||
      norm.indexOf('ملغي') === 0 ||
      norm.indexOf('ملغى') === 0 ||
      norm.indexOf('ملغاه') === 0 ||
      norm.indexOf('تم الالغاء') === 0 ||
      norm.indexOf('تم الغاء') === 0
    ) {
      return true;
    }
    return false;
  }

  function classifyReservationLifecycle(resOrStatus) {
    if (!resOrStatus) return 'active';
    if (typeof resOrStatus === 'string') {
      if (isRejectedToken(resOrStatus)) return 'rejected';
      if (isCancelledToken(resOrStatus)) return 'cancelled';
      return 'active';
    }
    // 1) Authoritative external status fields ALWAYS take precedence over stale flags or internalStatus
    var externalFields = [
      resOrStatus.originalStatusCode,
      resOrStatus.statusCode,
      resOrStatus.status_code,
      resOrStatus.originalStatusAr,
      resOrStatus.statusAr,
      resOrStatus.status_ar,
      resOrStatus.status,
      resOrStatus.reservationStatus
    ];
    var sawExplicitExternal = false;
    for (var i = 0; i < externalFields.length; i++) {
      var fv = typeof externalFields[i] === 'object' ? extractStatusTokenValue(externalFields[i]) : normalizeStr(externalFields[i]);
      if (!fv || fv === 'غير محدد') continue;
      sawExplicitExternal = true;
      if (isRejectedToken(fv)) return 'rejected';
      if (isCancelledToken(fv)) {
        // Authoritative refund/rejected override ONLY when source explicitly says NOT in cancelled list & IS in rejected list
        if (resOrStatus.isSourceRejected === true && resOrStatus.isSourceCancelled !== true) {
          return 'rejected';
        }
        return 'cancelled';
      }
    }
    // Any explicit non-rejected/non-cancelled external status (e.g. finished, started, automatically_extended, wallet_paid) is ALWAYS active!
    if (sawExplicitExternal) {
      return 'active';
    }

    // 2) Without explicit external status fields, consult mutually exclusive source flags (cancelled wins if both set)
    if (resOrStatus.isSourceCancelled === true) return 'cancelled';
    if (resOrStatus.isSourceRejected === true) return 'rejected';
    if (resOrStatus.isSourceRejected === false && resOrStatus.isSourceCancelled === false) {
      var fallbackInt = normalizeStr(resOrStatus.internalStatus);
      if (!fallbackInt || fallbackInt === 'غير محدد') return 'active';
      if (isRejectedToken(fallbackInt)) return 'rejected';
      if (isCancelledToken(fallbackInt)) return 'cancelled';
      return 'active';
    }

    // 3) Fallback to internalStatus then timestamps
    var internalVal = normalizeStr(resOrStatus.internalStatus);
    if (internalVal && internalVal !== 'غير محدد') {
      if (isRejectedToken(internalVal)) return 'rejected';
      if (isCancelledToken(internalVal)) return 'cancelled';
      return 'active';
    }
    var rejAt = normalizeStr(resOrStatus.rejectedAt);
    var canAt = normalizeStr(resOrStatus.cancelledAt);
    if (rejAt && canAt) {
      return canAt > rejAt ? 'cancelled' : 'rejected';
    }
    if (rejAt) return 'rejected';
    if (canAt) return 'cancelled';
    return 'active';
  }

  function isRejectedStatus(resOrStatus) {
    return classifyReservationLifecycle(resOrStatus) === 'rejected';
  }

  function isInRejectedTab(resOrStatus) {
    if (!resOrStatus || typeof resOrStatus === 'string') return isRejectedStatus(resOrStatus);
    if (isRejectedStatus(resOrStatus)) return true;
    return Boolean(normalizeStr(resOrStatus.rccStatus || resOrStatus.rcc_status));
  }

  function isCancelledStatus(resOrStatus) {
    return classifyReservationLifecycle(resOrStatus) === 'cancelled';
  }

  function isInactiveReservation(res) {
    var lc = classifyReservationLifecycle(res);
    return lc === 'rejected' || lc === 'cancelled';
  }

  function getReservationLifecycleKind(res) {
    return classifyReservationLifecycle(res);
  }

  function redactReservationSensitiveFields(res, user) {
    if (!res || typeof res !== 'object') return res;
    if (canUserViewCustomerId(user)) return res;
    return Object.assign({}, res, { customerIdNumber: '' });
  }

  function groupCustomerLookupResults(reservations, targetNationalId) {
    var list = Array.isArray(reservations) ? reservations : [];
    var targetNorm = normalizeNationalId(targetNationalId);
    var matched = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var ridNorm = normalizeNationalId(r.customerIdNumber);
      if (!ridNorm) continue;
      if (targetNorm) {
        var isExact = ridNorm === targetNorm;
        var isPartial = targetNorm.length >= 4 && ridNorm.indexOf(targetNorm) !== -1;
        if (!isExact && !isPartial) continue;
      }
      matched.push(r);
    }

    matched.sort(function (a, b) {
      var ta = String(a.lastUpdatedAt || a.updatedAt || a.startDate || a.createdAt || '');
      var tb = String(b.lastUpdatedAt || b.updatedAt || b.startDate || b.createdAt || '');
      return tb.localeCompare(ta);
    });

    if (matched.length === 0) {
      return {
        found: false,
        customer: null,
        customers: [],
        stats: { totalCount: 0, activeCount: 0, rejectedCount: 0, cancelledCount: 0, inactiveCount: 0 },
        activeReservations: [],
        inactiveReservations: [],
        reservations: [],
        totalMatches: 0
      };
    }

    var groupsByNormId = {};
    var groupOrder = [];
    var allActive = [];
    var allInactive = [];
    var totalRejected = 0;
    var totalCancelled = 0;

    for (var j = 0; j < matched.length; j++) {
      var item = matched[j];
      var normId = normalizeNationalId(item.customerIdNumber);
      if (!groupsByNormId[normId]) {
        groupsByNormId[normId] = [];
        groupOrder.push(normId);
      }
      groupsByNormId[normId].push(item);

      var kind = getReservationLifecycleKind(item);
      if (kind === 'rejected') {
        totalRejected += 1;
        allInactive.push(item);
      } else if (kind === 'cancelled') {
        totalCancelled += 1;
        allInactive.push(item);
      } else {
        allActive.push(item);
      }
    }

    if (targetNorm) {
      groupOrder.sort(function (a, b) {
        if (a === targetNorm && b !== targetNorm) return -1;
        if (b === targetNorm && a !== targetNorm) return 1;
        return 0;
      });
    }

    var customerProfiles = groupOrder.map(function (gid) {
      var items = groupsByNormId[gid];
      var latest = items[0];
      var companiesMap = {};
      var phonesMap = {};
      var cActive = [];
      var cInactive = [];
      var cRejected = 0;
      var cCancelled = 0;
      var cSpent = 0;

      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        var comp = normalizeStr(it.companyName);
        if (comp) companiesMap[comp] = true;
        var ph = normalizeStr(it.customerPhone);
        if (ph) phonesMap[ph] = true;
        var lc = getReservationLifecycleKind(it);
        if (lc === 'rejected') {
          cRejected += 1;
          cInactive.push(it);
        } else if (lc === 'cancelled') {
          cCancelled += 1;
          cInactive.push(it);
        } else {
          cActive.push(it);
        }
        cSpent += toNum(it.totalAmount, 0);
      }

      var rawIdStr = normalizeStr(latest.customerIdNumber);
      var custNameStr = normalizeStr(latest.customerName) || '-';
      var custPhoneStr = normalizeStr(latest.customerPhone) || '-';
      var custEmailStr = normalizeStr(latest.customerEmail) || '';

      return {
        nationalId: gid,
        customerIdNumber: gid,
        normalizedIdNumber: gid,
        name: custNameStr,
        customerName: custNameStr,
        phone: custPhoneStr,
        customerPhone: custPhoneStr,
        email: custEmailStr,
        customerEmail: custEmailStr,
        phones: Object.keys(phonesMap),
        companies: Object.keys(companiesMap),
        totalCount: items.length,
        totalBookings: items.length,
        totalReservations: items.length,
        activeCount: cActive.length,
        rejectedCount: cRejected,
        cancelledCount: cCancelled,
        inactiveCount: cInactive.length,
        totalSpent: Math.round(cSpent * 100) / 100,
        lastBookingDate: formatDisplayDate(latest.startDate || latest.createdAt) || '',
        activeReservations: cActive,
        inactiveReservations: cInactive,
        reservations: items
      };
    });

    return {
      found: true,
      customer: customerProfiles[0] || null,
      customers: customerProfiles,
      stats: {
        totalCount: matched.length,
        activeCount: allActive.length,
        rejectedCount: totalRejected,
        cancelledCount: totalCancelled,
        inactiveCount: allInactive.length
      },
      activeReservations: allActive,
      inactiveReservations: allInactive,
      reservations: matched,
      totalMatches: matched.length
    };
  }

  var EXCLUDED_TODAY_STATUSES = [
    'تم الإلغاء', 'تم الالغاء', 'تم الإلغاء من العميل', 'تم الالغاء من العميل', 'ملغي', 'ملغى', 'ملغاة', 'ملغي من العميل',
    'cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer', 'customer_cancelled', 'customer_canceled', 'user_cancelled', 'user_canceled', 'client_cancelled', 'admin_cancelled',
    'مرفوض', 'مرفوضة', 'تم الرفض', 'مرفوض من الموقع', 'مرفوض من الشركة',
    'rejected', 'declined', 'refused', 'rejected_by_admin', 'rejected_by_company', 'provider_rejected', 'admin_rejected', 'company_rejected', 'auto_rejected',
    'لم يتم الحجز', 'لم يحضر', 'no_show'
  ];

  var PICKUP_COMPLETED_STATUSES = [
    'تم التسليم', 'نشط الآن', 'نشط', 'active', 'delivered', 'picked_up',
    'تم الاستلام', 'تم الإرجاع', 'منتهي', 'مكتمل', 'completed', 'returned', 'closed'
  ];

  function isExcludedMovementStatus(res) {
    var r = (res && typeof res === 'object') ? res : {};
    if (isInactiveReservation(r)) return true;
    var internal = normalizeStr(r.internalStatus).toLowerCase();
    var origAr = normalizeStr(r.originalStatusAr).toLowerCase();
    var origCode = normalizeStr(r.originalStatusCode).toLowerCase();
    for (var i = 0; i < EXCLUDED_TODAY_STATUSES.length; i++) {
      var st = EXCLUDED_TODAY_STATUSES[i].toLowerCase();
      if (internal === st || origAr === st || origCode === st) return true;
    }
    return false;
  }

  function isPickupCompletedStatus(res) {
    var r = (res && typeof res === 'object') ? res : {};
    var internal = normalizeStr(r.internalStatus).toLowerCase();
    var origAr = normalizeStr(r.originalStatusAr).toLowerCase();
    var origCode = normalizeStr(r.originalStatusCode).toLowerCase();
    for (var i = 0; i < PICKUP_COMPLETED_STATUSES.length; i++) {
      var st = PICKUP_COMPLETED_STATUSES[i].toLowerCase();
      if (internal === st || origAr === st || origCode === st) return true;
    }
    return false;
  }

  function parseMinutesOfDay(timeStr) {
    var clean = convertEasternDigitsToAscii(normalizeStr(timeStr));
    var m = /^(\d{1,2}):(\d{2})/.exec(clean);
    if (!m) return null;
    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  function normalizeTimeHHmm(timeStr, fallback) {
    var mins = parseMinutesOfDay(timeStr);
    if (mins === null) return fallback || '';
    return padTwoDigits(Math.floor(mins / 60)) + ':' + padTwoDigits(mins % 60);
  }

  function resolveReservationStartInfo(res) {
    var r = (res && typeof res === 'object') ? res : {};
    var dateStr = formatDisplayDate(r.startDate || r.pickupDate || '');
    var rawTime = normalizeStr(r.startTime) || extractTimeOnly(r.startDate) || '09:00';
    var cleanTime = normalizeTimeHHmm(rawTime, '09:00');
    var tsMs = dateStr ? parseReservationEndTimestampMs(dateStr, cleanTime) : null;
    return {
      date: dateStr,
      time: cleanTime,
      minutesOfDay: parseMinutesOfDay(cleanTime),
      timestampMs: tsMs
    };
  }

  function computeTodayMovementsSummary(reservations, nowMs, options) {
    var list = Array.isArray(reservations) ? reservations : [];
    var opts = options || {};
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var todayDate = formatDisplayDate(opts.todayDate) || getRiyadhTodayDateStr(now);
    var subFilter = normalizeStr(opts.subFilter || 'all').toLowerCase();
    var search = normalizeStr(opts.search);

    var allItems = [];
    var pickupCount = 0;
    var returnCount = 0;
    var pendingPickupCount = 0;
    var pendingReturnCount = 0;
    var overdueCount = 0;
    var completedCount = 0;

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      if (isExcludedMovementStatus(r)) continue;

      var startInfo = resolveReservationStartInfo(r);
      if (startInfo.date && startInfo.date === todayDate) {
        var pickupDone = isPickupCompletedStatus(r);
        var pickupOverdue = !pickupDone && startInfo.timestampMs !== null && startInfo.timestampMs < now;
        pickupCount += 1;
        if (pickupDone) completedCount += 1;
        else pendingPickupCount += 1;
        if (pickupOverdue) overdueCount += 1;
        allItems.push({
          key: String(r.id || r.reservationNumber || i) + ':pickup',
          movementType: 'pickup',
          reservation: r,
          scheduledDate: todayDate,
          scheduledTime: startInfo.time,
          scheduledMinutes: startInfo.minutesOfDay !== null ? startInfo.minutesOfDay : 540,
          scheduledTimestampMs: startInfo.timestampMs,
          isCompleted: pickupDone,
          isOverdue: pickupOverdue,
          isExtended: false
        });
      }

      var effEnd = resolveReservationEffectiveEnd(r);
      if (effEnd.date && effEnd.date === todayDate) {
        var retTime = normalizeTimeHHmm(effEnd.time, '23:59');
        var retMins = parseMinutesOfDay(retTime);
        var retDone = isReservationClosedStatus(r);
        var retOverdue = !retDone && effEnd.timestampMs !== null && effEnd.timestampMs < now;
        returnCount += 1;
        if (retDone) completedCount += 1;
        else pendingReturnCount += 1;
        if (retOverdue) overdueCount += 1;
        allItems.push({
          key: String(r.id || r.reservationNumber || i) + ':return',
          movementType: 'return',
          reservation: r,
          scheduledDate: todayDate,
          scheduledTime: retTime,
          scheduledMinutes: retMins !== null ? retMins : 1439,
          scheduledTimestampMs: effEnd.timestampMs,
          isCompleted: retDone,
          isOverdue: retOverdue,
          isExtended: effEnd.isExtended
        });
      }
    }

    allItems.sort(function (a, b) {
      if (a.scheduledMinutes !== b.scheduledMinutes) return a.scheduledMinutes - b.scheduledMinutes;
      if (a.movementType !== b.movementType) return a.movementType === 'pickup' ? -1 : 1;
      var ra = normalizeStr(a.reservation && a.reservation.reservationNumber);
      var rb = normalizeStr(b.reservation && b.reservation.reservationNumber);
      return ra < rb ? -1 : (ra > rb ? 1 : 0);
    });

    var filtered = allItems.filter(function (item) {
      if (subFilter === 'pickup' && item.movementType !== 'pickup') return false;
      if (subFilter === 'return' && item.movementType !== 'return') return false;
      if ((opts.timeFrom || opts.timeTo) && !isTimeInRange(item.scheduledTime, opts.timeFrom, opts.timeTo)) return false;
      if (search) {
        var r = item.reservation || {};
        if (!matchesSearchFields([
          r.reservationNumber,
          r.customerName,
          r.customerPhone,
          r.carName,
          r.plateNumber,
          r.companyName,
          r.branchName
        ], search)) {
          return false;
        }
      }
      return true;
    });

    return {
      todayDate: todayDate,
      items: filtered,
      allItems: allItems,
      totalCount: allItems.length,
      filteredCount: filtered.length,
      pickupCount: pickupCount,
      returnCount: returnCount,
      pendingPickupCount: pendingPickupCount,
      pendingReturnCount: pendingReturnCount,
      overdueCount: overdueCount,
      completedCount: completedCount
    };
  }

  // ---------- EXTENSION COMPARISON SUMMARY ----------

  function computeExtensionComparisonSummary(res, extensions) {
    var r = (res && typeof res === 'object') ? res : {};
    var extList = Array.isArray(extensions) ? extensions : (Array.isArray(r.extensions) ? r.extensions : []);
    var origEndDate = formatDisplayDate(r.originalEndDate || r.endDate || '');
    var origEndTime = normalizeTimeHHmm(
      normalizeStr(r.originalEndTime) || extractTimeOnly(r.originalEndDate) || normalizeStr(r.endTime) || extractTimeOnly(r.endDate),
      ''
    );

    var extSummary = summarizeReservationExtensions(extList, r, origEndDate, origEndTime);
    var effEndDate = formatDisplayDate(r.extendedUntilDate || extSummary.extendedUntilDate || r.endDate || origEndDate);
    var effEndTime = normalizeTimeHHmm(
      normalizeStr(r.extendedUntilTime) || extSummary.extendedUntilTime || normalizeStr(r.endTime) || origEndTime,
      origEndTime
    );

    var baseDays = Math.max(0, Math.round(toNum(r.daysCount, 0)));
    var extendedDays = Math.max(
      Math.round(toNum(r.extendedDaysCount, 0)),
      Math.round(toNum(extSummary.extendedDaysCount, 0))
    );
    if (extendedDays === 0 && origEndDate && effEndDate && effEndDate > origEndDate) {
      extendedDays = computeDateDiffDays(origEndDate, effEndDate);
    }
    var totalDays = Math.max(baseDays + extendedDays, Math.round(toNum(r.totalDaysCount, 0)));

    var baseAmount = Math.round(toNum(r.baseAmount, 0) * 100) / 100;
    var extensionsAmount = Math.round(
      Math.max(toNum(r.extensionsAmount, 0), toNum(extSummary.extensionsAmount, 0)) * 100
    ) / 100;
    var totalAmount = Math.round(
      toNum(r.totalAmount, baseAmount + extensionsAmount) * 100
    ) / 100;
    if (baseAmount === 0 && totalAmount > extensionsAmount) {
      baseAmount = Math.round((totalAmount - extensionsAmount) * 100) / 100;
    }

    var extensionsCount = Math.max(
      Math.round(toNum(r.extensionsCount, 0)),
      Math.round(toNum(extSummary.extensionsCount, 0))
    );
    var amountDeltaPct = baseAmount > 0 ? Math.round((extensionsAmount / baseAmount) * 100) : 0;
    var hasExtensions = Boolean(
      extensionsCount > 0 ||
      extendedDays > 0 ||
      extensionsAmount > 0 ||
      (origEndDate && effEndDate && effEndDate > origEndDate) ||
      r.hasExtensions
    );

    return {
      hasExtensions: hasExtensions,
      extensionsCount: extensionsCount,
      originalEndDate: origEndDate,
      originalEndTime: origEndTime,
      effectiveEndDate: effEndDate,
      effectiveEndTime: effEndTime,
      baseDays: baseDays,
      extendedDays: extendedDays,
      totalDays: totalDays,
      baseAmount: baseAmount,
      extensionsAmount: extensionsAmount,
      totalAmount: totalAmount,
      amountDeltaPct: amountDeltaPct,
      extensions: extSummary.extensions || []
    };
  }

  // ---------- PEAK HOURS HEATMAP ----------

  var HEATMAP_DAY_ORDER = [
    { dayIndex: 6, labelAr: 'السبت', labelEn: 'Sat' },
    { dayIndex: 0, labelAr: 'الأحد', labelEn: 'Sun' },
    { dayIndex: 1, labelAr: 'الاثنين', labelEn: 'Mon' },
    { dayIndex: 2, labelAr: 'الثلاثاء', labelEn: 'Tue' },
    { dayIndex: 3, labelAr: 'الأربعاء', labelEn: 'Wed' },
    { dayIndex: 4, labelAr: 'الخميس', labelEn: 'Thu' },
    { dayIndex: 5, labelAr: 'الجمعة', labelEn: 'Fri' }
  ];

  function extractDayAndHourFromDateValue(rawDateStr, explicitTimeStr) {
    var strVal = normalizeStr(rawDateStr);
    var hasExplicitTimeArg = Boolean(normalizeStr(explicitTimeStr));
    var hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(strVal);
    if (!hasExplicitTimeArg && hasExplicitTz) {
      var parsedTz = new Date(strVal);
      if (!isNaN(parsedTz.getTime())) {
        var riyadhDt = new Date(parsedTz.getTime() + 3 * 3600000);
        return { dayIndex: riyadhDt.getUTCDay(), hour: riyadhDt.getUTCHours() };
      }
    }

    var dateOnly = formatDisplayDate(rawDateStr);
    var timeClean = normalizeTimeHHmm(normalizeStr(explicitTimeStr) || extractTimeOnly(rawDateStr), '');
    if (dateOnly && timeClean) {
      var parts = dateOnly.split('-');
      var tParts = timeClean.split(':');
      var dtUtc = new Date(Date.UTC(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10),
        parseInt(tParts[0], 10),
        parseInt(tParts[1], 10),
        0
      ));
      if (!isNaN(dtUtc.getTime())) {
        return { dayIndex: dtUtc.getUTCDay(), hour: dtUtc.getUTCHours() };
      }
    }

    if (strVal) {
      var parsed = new Date(strVal);
      if (!isNaN(parsed.getTime())) {
        var riyadhFallback = new Date(parsed.getTime() + 3 * 3600000);
        return { dayIndex: riyadhFallback.getUTCDay(), hour: riyadhFallback.getUTCHours() };
      }
    }

    if (dateOnly) {
      var dp = dateOnly.split('-');
      var dOnly = new Date(Date.UTC(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10), 10, 0, 0));
      if (!isNaN(dOnly.getTime())) {
        return { dayIndex: dOnly.getUTCDay(), hour: 10 };
      }
    }
    return null;
  }

  function computePeakHoursHeatmap(reservations, problems, options) {
    var resList = Array.isArray(reservations) ? reservations : [];
    var prbList = Array.isArray(problems) ? problems : [];
    var opts = options || {};
    var mode = normalizeStr(opts.mode || 'all').toLowerCase();
    if (mode !== 'reservations' && mode !== 'problems') mode = 'all';

    var gridByDay = {};
    for (var d = 0; d < HEATMAP_DAY_ORDER.length; d++) {
      var info = HEATMAP_DAY_ORDER[d];
      var hours = [];
      for (var h = 0; h < 24; h++) {
        hours.push({
          hour: h,
          hourLabel: padTwoDigits(h) + ':00',
          reservations: 0,
          problems: 0,
          count: 0,
          intensity: 0
        });
      }
      gridByDay[info.dayIndex] = {
        dayIndex: info.dayIndex,
        labelAr: info.labelAr,
        labelEn: info.labelEn,
        hours: hours,
        rowTotal: 0,
        reservationsTotal: 0,
        problemsTotal: 0
      };
    }

    var reservationEvents = 0;
    var problemEvents = 0;

    for (var i = 0; i < resList.length; i++) {
      var r = resList[i];
      if (!r || typeof r !== 'object') continue;
      var rSlot = extractDayAndHourFromDateValue(r.startDate || r.sourceCreatedAt || r.createdAt, r.startTime);
      if (!rSlot && (r.sourceCreatedAt || r.createdAt)) {
        rSlot = extractDayAndHourFromDateValue(r.sourceCreatedAt || r.createdAt, '');
      }
      if (!rSlot || !gridByDay[rSlot.dayIndex]) continue;
      var cellR = gridByDay[rSlot.dayIndex].hours[rSlot.hour];
      if (!cellR) continue;
      cellR.reservations += 1;
      gridByDay[rSlot.dayIndex].reservationsTotal += 1;
      reservationEvents += 1;
    }

    for (var j = 0; j < prbList.length; j++) {
      var p = prbList[j];
      if (!p || typeof p !== 'object') continue;
      var pSlot = extractDayAndHourFromDateValue(p.createdAt || p.updatedAt, '');
      if (!pSlot || !gridByDay[pSlot.dayIndex]) continue;
      var cellP = gridByDay[pSlot.dayIndex].hours[pSlot.hour];
      if (!cellP) continue;
      cellP.problems += 1;
      gridByDay[pSlot.dayIndex].problemsTotal += 1;
      problemEvents += 1;
    }

    var maxCount = 0;
    var totalEvents = 0;
    var hourTotals = [];
    for (var hi = 0; hi < 24; hi++) hourTotals.push(0);

    var days = HEATMAP_DAY_ORDER.map(function (meta) {
      var row = gridByDay[meta.dayIndex];
      var rowSum = 0;
      for (var hr = 0; hr < 24; hr++) {
        var cell = row.hours[hr];
        var val = mode === 'reservations'
          ? cell.reservations
          : (mode === 'problems' ? cell.problems : (cell.reservations + cell.problems));
        cell.count = val;
        rowSum += val;
        hourTotals[hr] += val;
        totalEvents += val;
        if (val > maxCount) maxCount = val;
      }
      row.rowTotal = rowSum;
      return row;
    });

    var busiestDay = days[0] || null;
    var peakSlot = null;
    for (var di = 0; di < days.length; di++) {
      var dayRow = days[di];
      if (!busiestDay || dayRow.rowTotal > busiestDay.rowTotal) {
        busiestDay = dayRow;
      }
      for (var hrIdx = 0; hrIdx < 24; hrIdx++) {
        var c = dayRow.hours[hrIdx];
        if (maxCount > 0 && c.count > 0) {
          var ratio = c.count / maxCount;
          c.intensity = ratio >= 0.78 ? 4 : (ratio >= 0.52 ? 3 : (ratio >= 0.26 ? 2 : 1));
        } else {
          c.intensity = 0;
        }
        if (!peakSlot || c.count > peakSlot.count) {
          peakSlot = {
            dayIndex: dayRow.dayIndex,
            labelAr: dayRow.labelAr,
            labelEn: dayRow.labelEn,
            hour: c.hour,
            hourLabel: c.hourLabel,
            count: c.count,
            reservations: c.reservations,
            problems: c.problems
          };
        }
      }
    }

    var peakHour = 0;
    for (var ph = 1; ph < 24; ph++) {
      if (hourTotals[ph] > hourTotals[peakHour]) peakHour = ph;
    }

    return {
      mode: mode,
      days: days,
      hourTotals: hourTotals,
      maxCount: maxCount,
      totalEvents: totalEvents,
      reservationEvents: reservationEvents,
      problemEvents: problemEvents,
      busiestDay: busiestDay
        ? { dayIndex: busiestDay.dayIndex, labelAr: busiestDay.labelAr, labelEn: busiestDay.labelEn, total: busiestDay.rowTotal }
        : null,
      peakHour: peakHour,
      peakHourLabel: padTwoDigits(peakHour) + ':00',
      peakHourTotal: hourTotals[peakHour] || 0,
      peakSlot: peakSlot
    };
  }

  // ---------- @MENTIONS EXTRACTION & SEGMENTATION ----------

  function normalizeMentionCandidates(employees, excludeEmployeeId) {
    var list = Array.isArray(employees) ? employees : [];
    var exId = normalizeStr(excludeEmployeeId);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var emp = list[i];
      if (!emp || typeof emp !== 'object') continue;
      if (normalizeStr(emp.status).toLowerCase() === 'disabled') continue;
      var id = normalizeStr(emp.id);
      var name = normalizeStr(emp.name);
      var username = normalizeStr(emp.username);
      if (!id || (!name && !username)) continue;
      if (exId && id === exId) continue;
      out.push({
        id: id,
        name: name,
        username: username,
        role: normalizeStr(emp.role)
      });
    }
    out.sort(function (a, b) {
      var la = (a.name || '').length;
      var lb = (b.name || '').length;
      if (lb !== la) return lb - la;
      return (b.username || '').length - (a.username || '').length;
    });
    return out;
  }

  function isMentionPrefixBoundary(ch) {
    return !ch || /[\s,،.(:;\[{"'«\-\n\r]/.test(ch);
  }

  function isMentionSuffixBoundary(ch) {
    return !ch || /[\s,،.!?;:)\]'"»\-@#\n\r]/.test(ch);
  }

  function matchMentionAtIndex(raw, atIdx, candidates) {
    var after = raw.slice(atIdx + 1);
    if (!after) return null;
    var afterLower = after.toLowerCase();

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.name) {
        var nmLower = c.name.toLowerCase();
        if (afterLower.indexOf(nmLower) === 0) {
          var nextChar = raw.charAt(atIdx + 1 + c.name.length);
          if (isMentionSuffixBoundary(nextChar)) {
            return { employee: c, length: 1 + c.name.length, matchedText: raw.slice(atIdx, atIdx + 1 + c.name.length) };
          }
        }
        var underscoreName = c.name.replace(/\s+/g, '_');
        if (underscoreName !== c.name) {
          var uLower = underscoreName.toLowerCase();
          if (afterLower.indexOf(uLower) === 0) {
            var nextU = raw.charAt(atIdx + 1 + underscoreName.length);
            if (isMentionSuffixBoundary(nextU)) {
              return { employee: c, length: 1 + underscoreName.length, matchedText: raw.slice(atIdx, atIdx + 1 + underscoreName.length) };
            }
          }
        }
      }
    }

    for (var j = 0; j < candidates.length; j++) {
      var cu = candidates[j];
      if (cu.username) {
        var unLower = cu.username.toLowerCase();
        if (afterLower.indexOf(unLower) === 0) {
          var nextUn = raw.charAt(atIdx + 1 + cu.username.length);
          if (isMentionSuffixBoundary(nextUn)) {
            return { employee: cu, length: 1 + cu.username.length, matchedText: raw.slice(atIdx, atIdx + 1 + cu.username.length) };
          }
        }
      }
    }
    return null;
  }

  function findMentionSegments(text, employees) {
    var raw = String(text === undefined || text === null ? '' : text);
    if (!raw) return [];
    var candidates = normalizeMentionCandidates(employees, '');
    if (candidates.length === 0 || raw.indexOf('@') === -1) {
      return [{ type: 'text', text: raw }];
    }

    var segments = [];
    var cursor = 0;
    var idx = 0;
    while (idx < raw.length) {
      if (raw.charAt(idx) === '@' && isMentionPrefixBoundary(idx === 0 ? '' : raw.charAt(idx - 1))) {
        var hit = matchMentionAtIndex(raw, idx, candidates);
        if (hit) {
          if (idx > cursor) {
            segments.push({ type: 'text', text: raw.slice(cursor, idx) });
          }
          segments.push({
            type: 'mention',
            text: hit.matchedText,
            employee: hit.employee
          });
          idx += hit.length;
          cursor = idx;
          continue;
        }
      }
      idx += 1;
    }
    if (cursor < raw.length) {
      segments.push({ type: 'text', text: raw.slice(cursor) });
    }
    return segments;
  }

  function extractMentionedEmployees(text, employees, options) {
    var opts = options || {};
    var segments = findMentionSegments(text, employees);
    var exId = normalizeStr(opts.excludeEmployeeId);
    var seen = {};
    var out = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.type !== 'mention' || !seg.employee) continue;
      var emp = seg.employee;
      if (exId && emp.id === exId) continue;
      if (seen[emp.id]) continue;
      seen[emp.id] = true;
      out.push(emp);
    }
    return out;
  }

  var MAX_PINNED_CRITICAL_RESERVATIONS = 3;

  var UI_SIMPLIFICATION_GROUPS = [
    {
      id: 'nav_topbar',
      labelAr: 'القائمة الجانبية والشريط العلوي',
      labelEn: 'Sidebar Navigation & Topbar'
    },
    {
      id: 'dashboard',
      labelAr: 'أقسام لوحة التحكم',
      labelEn: 'Dashboard Sections'
    },
    {
      id: 'reservations',
      labelAr: 'صفحة الحجوزات والأدوات',
      labelEn: 'Reservations Page & Toolbar'
    },
    {
      id: 'drawer',
      labelAr: 'تفاصيل الحجز (النافذة الجانبية)',
      labelEn: 'Reservation Details Drawer'
    },
    {
      id: 'modules',
      labelAr: 'متابعاتي والمشكلات والتقارير والموظفون',
      labelEn: 'Follow-Ups, Problems, Reports & Staff'
    }
  ];

  var UI_SIMPLIFICATION_OPTIONS = [
    // Group 1: Sidebar Navigation & Topbar
    { key: 'hideNavCustomers', legacyId: 'set-ui-hide-nav-customers', cssClass: 'rg-ui-hide-nav-customers', group: 'nav_topbar', labelAr: 'إخفاء صفحة «العملاء» من القائمة الجانبية', labelEn: 'Hide "Customers" from sidebar navigation' },
    { key: 'hideNavTeamFollowups', legacyId: 'set-ui-hide-nav-team-followups', cssClass: 'rg-ui-hide-nav-team-followups', group: 'nav_topbar', labelAr: 'إخفاء صفحة «متابعات الفريق» من القائمة الجانبية', labelEn: 'Hide "Team Follow-Ups" from sidebar navigation' },
    { key: 'hideNavProblems', legacyId: 'set-ui-hide-nav-problems', cssClass: 'rg-ui-hide-nav-problems', group: 'nav_topbar', labelAr: 'إخفاء صفحة «المشكلات» من القائمة الجانبية', labelEn: 'Hide "Problems" from sidebar navigation' },
    { key: 'hideNavReports', legacyId: 'set-ui-hide-nav-reports', cssClass: 'rg-ui-hide-nav-reports', group: 'nav_topbar', labelAr: 'إخفاء صفحة «التقارير والإحصائيات» من القائمة الجانبية', labelEn: 'Hide "Reports & Analytics" from sidebar navigation' },
    { key: 'hideNavEmployees', legacyId: 'set-ui-hide-nav-employees', cssClass: 'rg-ui-hide-nav-employees', group: 'nav_topbar', labelAr: 'إخفاء صفحة «الموظفون» من القائمة الجانبية', labelEn: 'Hide "Employees" from sidebar navigation' },
    { key: 'hideNavActivity', legacyId: 'set-ui-hide-nav-activity', cssClass: 'rg-ui-hide-nav-activity', group: 'nav_topbar', labelAr: 'إخفاء صفحة «سجل النشاطات» من القائمة الجانبية', labelEn: 'Hide "Activity Log" from sidebar navigation' },
    { key: 'hideTopbarSearch', legacyId: 'set-ui-hide-topbar-search', cssClass: 'rg-ui-hide-topbar-search', group: 'nav_topbar', labelAr: 'إخفاء شريط البحث السريع (Ctrl+K) من الشريط العلوي', labelEn: 'Hide topbar quick search (Ctrl+K)' },
    { key: 'hideTopbarRefresh', legacyId: 'set-ui-hide-topbar-refresh', cssClass: 'rg-ui-hide-topbar-refresh', group: 'nav_topbar', labelAr: 'إخفاء زر التحديث اليدوي من الشريط العلوي', labelEn: 'Hide topbar manual refresh button' },
    { key: 'hideTopbarNotifications', legacyId: 'set-ui-hide-topbar-notif', cssClass: 'rg-ui-hide-topbar-notif', group: 'nav_topbar', labelAr: 'إخفاء جرس الإشعارات من الشريط العلوي', labelEn: 'Hide topbar notifications bell' },
    { key: 'hideTopbarThemeToggle', legacyId: 'set-ui-hide-topbar-theme', cssClass: 'rg-ui-hide-topbar-theme', group: 'nav_topbar', labelAr: 'إخفاء زر الوضع الليلي/النهاري من الشريط العلوي', labelEn: 'Hide topbar theme toggle button' },
    { key: 'hideTopbarLangToggle', legacyId: 'set-ui-hide-topbar-lang', cssClass: 'rg-ui-hide-topbar-lang', group: 'nav_topbar', labelAr: 'إخفاء زر تبديل اللغة (EN / عربي) من الشريط العلوي', labelEn: 'Hide topbar language toggle button' },
    { key: 'hideTopbarAnnouncements', legacyId: 'set-ui-hide-topbar-announcements', cssClass: 'rg-ui-hide-topbar-announcements', group: 'nav_topbar', labelAr: 'إخفاء زر إدارة التعميمات والشريط الإعلاني', labelEn: 'Hide shift announcements banner & manager button' },
    { key: 'hideTopbarPreviewRole', legacyId: 'set-ui-hide-topbar-preview', cssClass: 'rg-ui-hide-topbar-preview', group: 'nav_topbar', labelAr: 'إخفاء زر «وضع المحاكاة (معاينة دور)» من الشريط العلوي', labelEn: 'Hide topbar Role Impersonation preview button' },
    { key: 'hideSidebarCollapseBtn', legacyId: 'set-ui-hide-sidebar-collapse', cssClass: 'rg-ui-hide-sidebar-collapse', group: 'nav_topbar', labelAr: 'إخفاء زر طي وتوسيع القائمة الجانبية', labelEn: 'Hide sidebar collapse/expand button' },
    { key: 'hideProfilePersonalBtn', legacyId: 'set-ui-hide-profile-personal', cssClass: 'rg-ui-hide-profile-personal', group: 'nav_topbar', labelAr: 'إخفاء زر «إعدادات الحساب الشخصي» من قائمة المستخدم', labelEn: 'Hide Personal Account Settings button in profile menu' },
    { key: 'hideProfileInstallAppBtn', legacyId: 'set-ui-hide-profile-install', cssClass: 'rg-ui-hide-profile-install', group: 'nav_topbar', labelAr: 'إخفاء زر «تثبيت التطبيق على الجهاز (PWA)» من قائمة المستخدم', labelEn: 'Hide Install App (PWA) button in profile menu' },
    { key: 'hideProfileThemeBtn', legacyId: 'set-ui-hide-profile-theme', cssClass: 'rg-ui-hide-profile-theme', group: 'nav_topbar', labelAr: 'إخفاء زر «تبديل المظهر» من قائمة المستخدم', labelEn: 'Hide Theme toggle button in profile menu' },
    { key: 'hideProfileLangBtn', legacyId: 'set-ui-hide-profile-lang', cssClass: 'rg-ui-hide-profile-lang', group: 'nav_topbar', labelAr: 'إخفاء زر «تبديل اللغة» من قائمة المستخدم', labelEn: 'Hide Language toggle button in profile menu' },
    { key: 'hideProfileLogoutBtn', legacyId: 'set-ui-hide-profile-logout', cssClass: 'rg-ui-hide-profile-logout', group: 'nav_topbar', labelAr: 'إخفاء زر «تسجيل الخروج» من قائمة المستخدم', labelEn: 'Hide Sign Out button in profile menu' },
    { key: 'hideNotifMarkAllBtn', legacyId: 'set-ui-hide-notif-mark-all', cssClass: 'rg-ui-hide-notif-mark-all', group: 'nav_topbar', labelAr: 'إخفاء زر «تحديد الكل كمقروء» داخل قائمة الإشعارات', labelEn: 'Hide "Mark all read" button in Notifications popover' },
    { key: 'hideLogoutBtn', legacyId: 'set-ui-hide-logout-btn', cssClass: 'rg-ui-hide-logout-btn', group: 'nav_topbar', labelAr: 'إخفاء زر «تسجيل الخروج» من الشريط العلوي', labelEn: 'Hide topbar Sign Out button' },

    // Group 2: Dashboard Sections
    { key: 'hideDashHeroKpis', legacyId: 'set-ui-hide-dash-hero-kpis', cssClass: 'rg-ui-hide-dash-hero-kpis', group: 'dashboard', labelAr: 'إخفاء بطاقات المؤشرات الرئيسية (Hero KPIs) في لوحة التحكم', labelEn: 'Hide Dashboard Hero KPI cards' },
    { key: 'hideDashStripKpis', legacyId: 'set-ui-hide-dash-strip-kpis', cssClass: 'rg-ui-hide-dash-strip-kpis', group: 'dashboard', labelAr: 'إخفاء شريط مؤشرات الحالات التفصيلية (KPI Strip) في لوحة التحكم', labelEn: 'Hide Dashboard detailed status KPI strip' },
    { key: 'hideDashDailyChart', legacyId: 'set-ui-hide-dash-daily-chart', cssClass: 'rg-ui-hide-dash-daily-chart', group: 'dashboard', labelAr: 'إخفاء رسم «المتابعات اليومية» من لوحة التحكم', labelEn: 'Hide Dashboard "Daily Follow-Ups" chart' },
    { key: 'hideDashRecentActivity', legacyId: 'set-ui-hide-dash-recent-activity', cssClass: 'rg-ui-hide-dash-recent-activity', group: 'dashboard', labelAr: 'إخفاء بطاقة «أحدث النشاطات» من لوحة التحكم', labelEn: 'Hide Dashboard "Recent Activity" card' },
    { key: 'hideDashChartsGrid', legacyId: 'set-ui-hide-dash-charts-grid', cssClass: 'rg-ui-hide-dash-charts-grid', group: 'dashboard', labelAr: 'إخفاء شبكة الرسوم البيانية التحليلية (توزيع الحالات، الشركات، الموظفين، المشكلات)', labelEn: 'Hide Dashboard analytics charts grid' },
    { key: 'hideDashboardRadar', legacyId: 'set-ui-hide-dash-radar', cssClass: 'rg-ui-hide-dash-radar', group: 'dashboard', labelAr: 'إخفاء رادار 24 ساعة في لوحة التحكم', labelEn: 'Hide 24h Expiry Radar section on Dashboard' },
    { key: 'hideDashboardHeatmap', legacyId: 'set-ui-hide-dash-heatmap', cssClass: 'rg-ui-hide-dash-heatmap', group: 'dashboard', labelAr: 'إخفاء مصفوفة ساعات الذروة من لوحة التحكم والتقارير', labelEn: 'Hide Peak Hours Heatmap from Dashboard & Reports' },
    { key: 'hideDashLeaderboard', legacyId: 'set-ui-hide-dash-leaderboard', cssClass: 'rg-ui-hide-dash-leaderboard', group: 'dashboard', labelAr: 'إخفاء بطاقة «لوحة الصدارة (Leaderboard)» في لوحة التحكم', labelEn: 'Hide Team Leaderboard section on Dashboard' },
    { key: 'hideDashBottomBento', legacyId: 'set-ui-hide-dash-bottom', cssClass: 'rg-ui-hide-dash-bottom', group: 'dashboard', labelAr: 'إخفاء بطاقات أحدث الحجوزات والمشكلات المفتوحة والإجراءات السريعة أسفل لوحة التحكم', labelEn: 'Hide Dashboard bottom bookings/problems/actions cards' },
    { key: 'hideDashCustomizeBtn', legacyId: 'set-ui-hide-dash-customize', cssClass: 'rg-ui-hide-dash-customize', group: 'dashboard', labelAr: 'إخفاء زر «تخصيص وترتيب الشاشات» في لوحة التحكم والشريط الجانبي', labelEn: 'Hide "Customize & Reorder Layout" buttons' },
    { key: 'hideShiftHandoverBtn', legacyId: 'set-ui-hide-handover-btn', cssClass: 'rg-ui-hide-handover-btn', group: 'dashboard', labelAr: 'إخفاء أزرار «تسليم الوردية (PDF)» من لوحة التحكم والحجوزات والتقارير', labelEn: 'Hide "Shift Handover (PDF)" buttons across pages' },
    { key: 'hideDashTimeFilter', legacyId: 'set-ui-hide-dash-time-filter', cssClass: 'rg-ui-hide-dash-time-filter', group: 'dashboard', labelAr: 'إخفاء شريط الفلتر الزمني في لوحة التحكم', labelEn: 'Hide Dashboard time-range filter bar' },
    { key: 'hideDashViewAllBtns', legacyId: 'set-ui-hide-dash-view-all', cssClass: 'rg-ui-hide-dash-view-all', group: 'dashboard', labelAr: 'إخفاء أزرار «عرض الكل» في بطاقات لوحة التحكم', labelEn: 'Hide "View All" buttons on Dashboard cards' },

    // Group 3: Reservations Page & Toolbar
    { key: 'hideResTodayTab', legacyId: 'set-ui-hide-res-today-tab', cssClass: 'rg-ui-hide-res-today-tab', group: 'reservations', labelAr: 'إخفاء تبويب وزر «التسليم والاستلام اليوم»', labelEn: 'Hide "Today\'s Pickups & Returns" tab & button' },
    { key: 'hideResRadarTab', legacyId: 'set-ui-hide-res-radar-tab', cssClass: 'rg-ui-hide-res-radar-tab', group: 'reservations', labelAr: 'إخفاء تبويب وزر «رادار انتهاء الحجوزات (24 ساعة)»', labelEn: 'Hide "24h Expiry Radar" tab & button' },
    { key: 'hideResRejectedTab', legacyId: 'set-ui-hide-res-rejected-tab', cssClass: 'rg-ui-hide-res-rejected-tab', group: 'reservations', labelAr: 'إخفاء تبويب وزر «الحجوزات المرفوضة» في صفحة الحجوزات', labelEn: 'Hide "Rejected Reservations" tab in Reservations' },
    { key: 'hideResCancelledTab', legacyId: 'set-ui-hide-res-cancelled-tab', cssClass: 'rg-ui-hide-res-cancelled-tab', group: 'reservations', labelAr: 'إخفاء تبويب وزر «الحجوزات الملغاة» في صفحة الحجوزات', labelEn: 'Hide "Cancelled Reservations" tab in Reservations' },
    { key: 'hideResCustomerIdLookupBtn', legacyId: 'set-ui-hide-res-id-lookup', cssClass: 'rg-ui-hide-res-id-lookup', group: 'reservations', labelAr: 'إخفاء زر «البحث برقم الهوية» في صفحة الحجوزات', labelEn: 'Hide "National ID Lookup" button in Reservations' },
    { key: 'hideResPullBtn', legacyId: 'set-ui-hide-res-pull-btn', cssClass: 'rg-ui-hide-res-pull-btn', group: 'reservations', labelAr: 'إخفاء زر وشريط سحب الحجوزات من Rental Gate API في صفحة الحجوزات', labelEn: 'Hide Rental Gate API pull bar & button on Reservations' },
    { key: 'hideResImportExcel', legacyId: 'set-ui-hide-res-import-btn', cssClass: 'rg-ui-hide-res-import-btn', group: 'reservations', labelAr: 'إخفاء زر «استيراد من Excel» في صفحة الحجوزات', labelEn: 'Hide "Import Excel" button in Reservations' },
    { key: 'hideResColsToggle', legacyId: 'set-ui-hide-res-cols-btn', cssClass: 'rg-ui-hide-res-cols-btn', group: 'reservations', labelAr: 'إخفاء زر «إظهار/إخفاء الأعمدة» في جدول الحجوزات', labelEn: 'Hide "Toggle Columns" button in Reservations' },
    { key: 'hideResExportExcel', legacyId: 'set-ui-hide-res-export-btn', cssClass: 'rg-ui-hide-res-export-btn', group: 'reservations', labelAr: 'إخفاء زر «تصدير Excel» في صفحة الحجوزات', labelEn: 'Hide "Export Excel" button in Reservations' },
    { key: 'hideResBulkReassign', legacyId: 'set-ui-hide-res-bulk', cssClass: 'rg-ui-hide-res-bulk', group: 'reservations', labelAr: 'إخفاء مربعات التحديد وشريط «إعادة التوزيع الجماعي» في الحجوزات', labelEn: 'Hide row multi-select & Bulk Reassign bar' },
    { key: 'hideResQuickStatus', legacyId: 'set-ui-hide-res-quick-status', cssClass: 'rg-ui-hide-res-quick-status', group: 'reservations', labelAr: 'إخفاء قائمة تغيير الحالة السريع من جدول الحجوزات', labelEn: 'Hide quick status select inside Reservations table' },
    { key: 'hideResClaimBtns', legacyId: 'set-ui-hide-res-claim-btns', cssClass: 'rg-ui-hide-res-claim-btns', group: 'reservations', labelAr: 'إخفاء أزرار «استلام عندي / إلغاء الاستلام» في جدول الحجوزات', labelEn: 'Hide Claim / Unclaim buttons in Reservations table' },
    { key: 'hideResFiltersExtras', legacyId: 'set-ui-hide-res-filters-extras', cssClass: 'rg-ui-hide-res-filters-extras', group: 'reservations', labelAr: 'إخفاء فلاتر التاريخ والأولوية وخيارات «لم تتم متابعتها / بها مشكلات»', labelEn: 'Hide extra date/priority/checkbox filters in Reservations' },
    { key: 'hideResResetBtn', legacyId: 'set-ui-hide-res-reset', cssClass: 'rg-ui-hide-res-reset', group: 'reservations', labelAr: 'إخفاء زر «إعادة ضبط» الفلاتر في الحجوزات', labelEn: 'Hide "Reset Filters" button in Reservations' },
    { key: 'hideTodayRefreshBtn', legacyId: 'set-ui-hide-today-refresh', cssClass: 'rg-ui-hide-today-refresh', group: 'reservations', labelAr: 'إخفاء أزرار «تحديث» داخل تبويبي اليوم ورادار 24 ساعة', labelEn: 'Hide Refresh buttons in Today & Radar tabs' },
    { key: 'hideRadarWhatsappBtns', legacyId: 'set-ui-hide-radar-wa', cssClass: 'rg-ui-hide-radar-wa', group: 'reservations', labelAr: 'إخفاء أزرار «واتساب» و«نسخ التمديد» في جدولي اليوم والرادار', labelEn: 'Hide WhatsApp & Copy Offer buttons in Today & Radar' },

    // Group 4: Reservation Details Drawer
    { key: 'hideDrawerBackBtn', legacyId: 'set-ui-hide-drawer-back', cssClass: 'rg-ui-hide-drawer-back', group: 'drawer', labelAr: 'إخفاء زر «العودة لملف الموظف» في رأس تفاصيل الحجز', labelEn: 'Hide "Back to Employee Profile" button in Drawer' },
    { key: 'hideDrawerClaimBtns', legacyId: 'set-ui-hide-drawer-claim', cssClass: 'rg-ui-hide-drawer-claim', group: 'drawer', labelAr: 'إخفاء أزرار «استلام الحجز عندي / إلغاء الاستلام» داخل التفاصيل', labelEn: 'Hide Claim / Unclaim buttons inside Drawer' },
    { key: 'hideDrawerCopySummary', legacyId: 'set-ui-hide-drawer-copy', cssClass: 'rg-ui-hide-drawer-copy', group: 'drawer', labelAr: 'إخفاء زر «نسخ ملخص الحجز» داخل التفاصيل', labelEn: 'Hide "Copy Summary" button in Drawer' },
    { key: 'hideDirectCallBtn', legacyId: 'set-ui-hide-direct-call', cssClass: 'rg-ui-hide-direct-call', group: 'drawer', labelAr: 'إخفاء أزرار «اتصال 9» المباشرة', labelEn: 'Hide "Call 9" direct call buttons' },
    { key: 'hideDrawerIcsBtn', legacyId: 'set-ui-hide-drawer-ics', cssClass: 'rg-ui-hide-drawer-ics', group: 'drawer', labelAr: 'إخفاء زر «تقويم .ics» داخل تفاصيل الحجز', labelEn: 'Hide "Calendar .ics" button in Drawer' },
    { key: 'hideDrawerQuickStatus', legacyId: 'set-ui-hide-drawer-quick-status', cssClass: 'rg-ui-hide-drawer-quick-status', group: 'drawer', labelAr: 'إخفاء شريط «التحديث السريع للحالة» داخل تفاصيل الحجز', labelEn: 'Hide quick status update bar in Drawer' },
    { key: 'hideDrawerEditBtn', legacyId: 'set-ui-hide-drawer-edit', cssClass: 'rg-ui-hide-drawer-edit', group: 'drawer', labelAr: 'إخفاء زر «تعديل تفاصيل الحجز» داخل التفاصيل', labelEn: 'Hide "Edit Booking" button in Drawer' },
    { key: 'hideDrawerPdfBtn', legacyId: 'set-ui-hide-drawer-pdf', cssClass: 'rg-ui-hide-drawer-pdf', group: 'drawer', labelAr: 'إخفاء زر «تصدير PDF» داخل تفاصيل الحجز', labelEn: 'Hide "Export PDF" button in Drawer' },
    { key: 'hideDrawerReportProblemBtn', legacyId: 'set-ui-hide-drawer-problem', cssClass: 'rg-ui-hide-drawer-problem', group: 'drawer', labelAr: 'إخفاء زر «تحويل إلى مشكلة» داخل تفاصيل الحجز', labelEn: 'Hide "Report Problem" button in Drawer' },
    { key: 'hideDrawerPinnedNote', legacyId: 'set-ui-hide-drawer-pinned-note', cssClass: 'rg-ui-hide-drawer-pinned-note', group: 'drawer', labelAr: 'إخفاء قسم «الملاحظة المثبتة» أعلى تفاصيل الحجز', labelEn: 'Hide "Pinned Note" card in Drawer' },
    { key: 'hideDrawerHeaderPinBtn', legacyId: 'set-ui-hide-drawer-header-pin', cssClass: 'rg-ui-hide-drawer-header-pin', group: 'drawer', labelAr: 'إخفاء زر «ملاحظة مشرف/مدير مثبتة» من رأس الحجز', labelEn: 'Hide "Supervisor Pinned Note" button in Drawer header' },
    { key: 'hideNoAnswerBtn', legacyId: 'set-ui-hide-no-answer-btn', cssClass: 'rg-ui-hide-no-answer-btn', group: 'drawer', labelAr: 'إخفاء زر وعداد «لم يرد» في الحجز ومتابعاتي', labelEn: 'Hide "No Answer" button & counter' },
    { key: 'hideSharedBadge', legacyId: 'set-ui-hide-shared-badge', cssClass: 'rg-ui-hide-shared-badge', group: 'drawer', labelAr: 'إخفاء شارة «حصري لك / مشترك مع»', labelEn: 'Hide "Exclusive / Shared" collaboration badges' },
    { key: 'hideCustomerContactExtras', legacyId: 'set-ui-hide-customer-extra', cssClass: 'rg-ui-hide-customer-extra', group: 'drawer', labelAr: 'إخفاء البريد الإلكتروني ورقم الهوية من رأس الحجز', labelEn: 'Hide customer email & ID in Drawer header' },
    { key: 'hideSecondaryCarMeta', legacyId: 'set-ui-hide-car-meta', cssClass: 'rg-ui-hide-car-meta', group: 'drawer', labelAr: 'إخفاء فئة السيارة وتفاصيل الاستلام/التسليم الثانوية', labelEn: 'Hide car category & secondary pickup/return metadata' },
    { key: 'hideFinancialBreakdown', legacyId: 'set-ui-hide-finance', cssClass: 'rg-ui-hide-finance', group: 'drawer', labelAr: 'إخفاء التفصيل المالي اليومي والضريبة والخصم والمبالغ الأساسية', labelEn: 'Hide daily/tax/discount financial breakdown' },
    { key: 'hideDrawerStatusStages', legacyId: 'set-ui-hide-drawer-stages', cssClass: 'rg-ui-hide-drawer-stages', group: 'drawer', labelAr: 'إخفاء قسم «مراحل الحالة وتطور الحجز» داخل الحجز', labelEn: 'Hide "Status Stages" timeline in Drawer' },
    { key: 'hideDrawerCollabSection', legacyId: 'set-ui-hide-drawer-collab', cssClass: 'rg-ui-hide-drawer-collab', group: 'drawer', labelAr: 'إخفاء قسم «الموظفون المشاركون» وإدارة الإسناد داخل الحجز', labelEn: 'Hide "Assigned Staff" & supervisor assignment panel in Drawer' },
    { key: 'hideDrawerKpiGrid', legacyId: 'set-ui-hide-drawer-kpis', cssClass: 'rg-ui-hide-drawer-kpis', group: 'drawer', labelAr: 'إخفاء بطاقات الملخص الرقمي (الأيام / المتابعات / المشكلات) داخل الحجز', labelEn: 'Hide numeric KPI summary cards in Drawer' },
    { key: 'hideDrawerExtensions', legacyId: 'set-ui-hide-drawer-extensions', cssClass: 'rg-ui-hide-drawer-extensions', group: 'drawer', labelAr: 'إخفاء قسم «سجل التمديدات» داخل تفاصيل الحجز', labelEn: 'Hide "Extensions History" section in Drawer' },
    { key: 'hideDrawerCharts', legacyId: 'set-ui-hide-drawer-charts', cssClass: 'rg-ui-hide-drawer-charts', group: 'drawer', labelAr: 'إخفاء الرسوم البيانية داخل تفاصيل الحجز', labelEn: 'Hide secondary charts in Drawer' },
    { key: 'hideDrawerTimeline', legacyId: 'set-ui-hide-drawer-timeline', cssClass: 'rg-ui-hide-drawer-timeline', group: 'drawer', labelAr: 'إخفاء سجل المتابعات والمشكلات المرتبطة داخل الحجز', labelEn: 'Hide follow-up log & linked tickets in Drawer' },
    { key: 'hideDrawerAddFollowupForm', legacyId: 'set-ui-hide-drawer-add-fu', cssClass: 'rg-ui-hide-drawer-add-fu', group: 'drawer', labelAr: 'إخفاء نموذج «إضافة متابعة جديدة» داخل تفاصيل الحجز', labelEn: 'Hide "Add Follow-Up" form inside Drawer' },
    { key: 'hideDrawerEditFollowupBtns', legacyId: 'set-ui-hide-drawer-edit-fu', cssClass: 'rg-ui-hide-drawer-edit-fu', group: 'drawer', labelAr: 'إخفاء أزرار «تعديل / إغلاق» داخل سجل المتابعات والتذاكر', labelEn: 'Hide Edit/Close buttons in Drawer timeline & tickets' },

    // Group 5: Customers & Other Modules
    { key: 'hideCustDashboard', legacyId: 'set-ui-hide-cust-dashboard', cssClass: 'rg-ui-hide-cust-dashboard', group: 'modules', labelAr: 'إخفاء لوحة مؤشرات العملاء (KPIs) في صفحة العملاء', labelEn: 'Hide Customers KPI dashboard' },
    { key: 'hideCustComplaintsTab', legacyId: 'set-ui-hide-cust-complaints', cssClass: 'rg-ui-hide-cust-complaints', group: 'modules', labelAr: 'إخفاء تبويب «المشاكل والشكاوى» داخل ملف العميل', labelEn: 'Hide Complaints tab in Customer Profile' },
    { key: 'hideCustTimelineTab', legacyId: 'set-ui-hide-cust-timeline', cssClass: 'rg-ui-hide-cust-timeline', group: 'modules', labelAr: 'إخفاء تبويب «السجل الزمني الموحد» داخل ملف العميل', labelEn: 'Hide Unified Timeline tab in Customer Profile' },
    { key: 'hideCustEditBtn', legacyId: 'set-ui-hide-cust-edit', cssClass: 'rg-ui-hide-cust-edit', group: 'modules', labelAr: 'إخفاء أزرار «إضافة / تعديل بيانات العميل»', labelEn: 'Hide Add/Edit Customer buttons' },
    { key: 'hideCustAddNoteBtn', legacyId: 'set-ui-hide-cust-add-note', cssClass: 'rg-ui-hide-cust-add-note', group: 'modules', labelAr: 'إخفاء نموذج وأزرار «إضافة ملاحظة / تواصل» في ملف العميل', labelEn: 'Hide Add Customer Note / Contact form' },
    { key: 'hideMyfuPinnedStrip', legacyId: 'set-ui-hide-myfu-pinned', cssClass: 'rg-ui-hide-myfu-pinned', group: 'modules', labelAr: 'إخفاء شريط وأزرار تثبيت «الحجوزات الحرجة» في متابعاتي', labelEn: 'Hide "Pinned Critical Bookings" strip & pin buttons' },
    { key: 'hideMyfuMentionsTab', legacyId: 'set-ui-hide-myfu-mentions', cssClass: 'rg-ui-hide-myfu-mentions', group: 'modules', labelAr: 'إخفاء تبويب «إشارات @Mention» في متابعاتي', labelEn: 'Hide "@Mentions" tab in My Follow-Ups' },
    { key: 'hideMyfuHistoryCard', legacyId: 'set-ui-hide-myfu-history', cssClass: 'rg-ui-hide-myfu-history', group: 'modules', labelAr: 'إخفاء قسم «سجل متابعاتي السابقة» في متابعاتي', labelEn: 'Hide "My Previous Follow-Ups" history card' },
    { key: 'hideMyfuIcsBtn', legacyId: 'set-ui-hide-myfu-ics', cssClass: 'rg-ui-hide-myfu-ics', group: 'modules', labelAr: 'إخفاء زر «تقويم .ics» في صفحة متابعاتي', labelEn: 'Hide "Calendar .ics" button in My Follow-Ups' },
    { key: 'hideTeamFuBulkBtn', legacyId: 'set-ui-hide-tfu-bulk', cssClass: 'rg-ui-hide-tfu-bulk', group: 'modules', labelAr: 'إخفاء أزرار «تحويل جماعي» و«ملف عملاء الموظف» و«إعادة ضبط» في متابعات الفريق', labelEn: 'Hide Team Follow-Ups bulk reassign, profile & reset buttons' },
    { key: 'hideProblemsRateIndicator', legacyId: 'set-ui-hide-prb-rates', cssClass: 'rg-ui-hide-prb-rates', group: 'modules', labelAr: 'إخفاء مؤشر «نسبة المشكلات لكل 100 حجز» في المشكلات والتقارير', labelEn: 'Hide "Problems per 100 Bookings" indicator & toggle' },
    { key: 'hideProblemsManageBtns', legacyId: 'set-ui-hide-prb-manage', cssClass: 'rg-ui-hide-prb-manage', group: 'modules', labelAr: 'إخفاء أزرار «تحديث / إدارة» التذاكر في جدول المشكلات', labelEn: 'Hide "Manage / Update" buttons in Problems table' },
    { key: 'hideProblemsCloseDeleteBtn', legacyId: 'set-ui-hide-prb-close-del', cssClass: 'rg-ui-hide-prb-close-del', group: 'modules', labelAr: 'إخفاء أزرار «إغلاق / حذف» التذاكر والمشكلات', labelEn: 'Hide Close & Delete ticket buttons in Problems' },
    { key: 'hideProblemsOpenResBtn', legacyId: 'set-ui-hide-prb-open-res', cssClass: 'rg-ui-hide-prb-open-res', group: 'modules', labelAr: 'إخفاء أزرار «فتح الحجز» من المشكلات وتفاصيل التذكرة', labelEn: 'Hide "Open Booking" buttons in Problems view & modal' },
    { key: 'hideProblemsResetBtn', legacyId: 'set-ui-hide-prb-reset', cssClass: 'rg-ui-hide-prb-reset', group: 'modules', labelAr: 'إخفاء أزرار «إعادة ضبط» و«إغلاق المشكلة» السريع في المشكلات', labelEn: 'Hide Problems reset filter & quick close buttons' },
    { key: 'hideReportsCharts', legacyId: 'set-ui-hide-reports-charts', cssClass: 'rg-ui-hide-reports-charts', group: 'modules', labelAr: 'إخفاء الرسوم البيانية في صفحة التقارير', labelEn: 'Hide charts section in Reports page' },
    { key: 'hideReportsExportModalBtn', legacyId: 'set-ui-hide-reports-export', cssClass: 'rg-ui-hide-reports-export', group: 'modules', labelAr: 'إخفاء زر «إعدادات التصدير (PDF / Excel)» في التقارير', labelEn: 'Hide "Export Settings (PDF / Excel)" button in Reports' },
    { key: 'hideReportsTypeTabs', legacyId: 'set-ui-hide-rep-tabs', cssClass: 'rg-ui-hide-rep-tabs', group: 'modules', labelAr: 'إخفاء تبويبات أنواع التقارير وزر «تحديث التقرير» في التقارير', labelEn: 'Hide Report Type tabs & Generate button in Reports' },
    { key: 'hideRolePresetsSection', legacyId: 'set-ui-hide-role-presets', cssClass: 'rg-ui-hide-role-presets', group: 'modules', labelAr: 'إخفاء قسم «إدارة الصلاحيات الجاهزة (القوالب الوظيفية)» في الموظفين', labelEn: 'Hide "Role Presets" section in Employees page' },
    { key: 'hideEmpRolePresetBtns', legacyId: 'set-ui-hide-emp-preset-btns', cssClass: 'rg-ui-hide-emp-preset-btns', group: 'modules', labelAr: 'إخفاء أزرار إضافة وتعديل وحذف القوالب الوظيفية في الموظفين', labelEn: 'Hide Role Preset add/edit/delete/use buttons' },
    { key: 'hideEmpManagePermsBtn', legacyId: 'set-ui-hide-emp-manage-perms', cssClass: 'rg-ui-hide-emp-manage-perms', group: 'modules', labelAr: 'إخفاء أزرار «إدارة وتعديل الصلاحيات الفردية» في الموظفين', labelEn: 'Hide "Manage Individual Permissions" buttons' },
    { key: 'hideEmployeesDelegations', legacyId: 'set-ui-hide-emp-delegations', cssClass: 'rg-ui-hide-emp-delegations', group: 'modules', labelAr: 'إخفاء قسم «الإنابة المؤقتة» في صفحة الموظفين', labelEn: 'Hide "Temporary Delegations" section in Employees page' },
    { key: 'hideEmployeesShiftTransfer', legacyId: 'set-ui-hide-emp-transfer', cssClass: 'rg-ui-hide-emp-transfer', group: 'modules', labelAr: 'إخفاء زر «نقل جماعي لحجوزات موظف» في صفحة الموظفين', labelEn: 'Hide "Bulk Shift Transfer" button in Employees page' },
    { key: 'hideEmployeesAddBtn', legacyId: 'set-ui-hide-emp-add', cssClass: 'rg-ui-hide-emp-add', group: 'modules', labelAr: 'إخفاء زر «إضافة موظف جديد» في صفحة الموظفين', labelEn: 'Hide "Add New Employee" button in Employees page' },
    { key: 'hideEmployeesRowActions', legacyId: 'set-ui-hide-emp-row-actions', cssClass: 'rg-ui-hide-emp-row-actions', group: 'modules', labelAr: 'إخفاء أزرار «إيقاف/تفعيل» و«حذف» و«محاكاة» من جدول الموظفين', labelEn: 'Hide Disable, Delete & Impersonate row buttons in Employees' },
    { key: 'hideEditDeveloperBtn', legacyId: 'set-ui-hide-edit-dev-btn', cssClass: 'rg-ui-hide-edit-dev-btn', group: 'modules', labelAr: 'إخفاء أزرار «تعديل بيانات المبرمج» من الإعدادات والموظفين وقائمة الحساب', labelEn: 'Hide "Edit Developer Data" buttons' },
    { key: 'hidePersonalSettingsCardBtn', legacyId: 'set-ui-hide-personal-card-btn', cssClass: 'rg-ui-hide-personal-card-btn', group: 'modules', labelAr: 'إخفاء زر فتح «إعدادات الحساب الشخصي» داخل بطاقة الإعدادات', labelEn: 'Hide Personal Settings button inside Settings card' },
    { key: 'hideSettingsDiagnostics', legacyId: 'set-ui-hide-set-diag', cssClass: 'rg-ui-hide-set-diag', group: 'modules', labelAr: 'إخفاء أزرار فحص الاتصال ومسح الكاش من صفحة الإعدادات', labelEn: 'Hide connection test & clear cache buttons in Settings' },
    { key: 'hideSettingsRgTokenCard', legacyId: 'set-ui-hide-set-rg-token', cssClass: 'rg-ui-hide-set-rg-token', group: 'modules', labelAr: 'إخفاء بطاقة تحديث توكن RG_TOKEN في صفحة الإعدادات', labelEn: 'Hide RG_TOKEN update card in Settings' },
    { key: 'hideSettingsSyncSection', legacyId: 'set-ui-hide-set-sync', cssClass: 'rg-ui-hide-set-sync', group: 'modules', labelAr: 'إخفاء قسم وأزرار «مزامنة بيانات Rental Gate API» في الإعدادات', labelEn: 'Hide Rental Gate Sync section & buttons in Settings' },
    { key: 'hideSettingsHandoverCard', legacyId: 'set-ui-hide-set-handover', cssClass: 'rg-ui-hide-set-handover', group: 'modules', labelAr: 'إخفاء بطاقة «إعدادات تسليم الوردية وتعميمات الفريق» في الإعدادات', labelEn: 'Hide Shift Handover & Announcements card in Settings' },
    { key: 'hideSettingsRoleUiDefaults', legacyId: 'set-ui-hide-set-role-defaults', cssClass: 'rg-ui-hide-set-role-defaults', group: 'modules', labelAr: 'إخفاء لوحة «التحكم المركزي بواجهة الأدوار (Role UI Defaults)» في الإعدادات', labelEn: 'Hide Role UI Defaults control panel in Settings' },
    { key: 'hideSettingsDangerZone', legacyId: 'set-ui-hide-set-danger', cssClass: 'rg-ui-hide-set-danger', group: 'modules', labelAr: 'إخفاء زر وقسم «حذف الحجوزات» من صفحة الإعدادات', labelEn: 'Hide Delete Reservations zone in Settings' }
  ];

  var TEAM_UI_PRESETS = {
    full: {
      id: 'full',
      labelAr: 'فريق متكامل (11+ موظف) — عرض كافة الحقول والتحليلات',
      labelEn: 'Full Team (11+) — Show All Fields & Analytics',
      hideSecondaryCarMeta: false,
      hideCustomerContactExtras: false,
      hideFinancialBreakdown: false,
      hideDrawerCharts: false,
      hideDashboardRadar: false,
      hideDashboardHeatmap: false
    },
    medium: {
      id: 'medium',
      labelAr: 'فريق متوسط (4–10 موظفين) — إخفاء الحقول الثانوية للعميل والرسوم داخل الحجز',
      labelEn: 'Medium Team (4–10) — Hide Customer Extras & Drawer Charts',
      hideSecondaryCarMeta: false,
      hideCustomerContactExtras: true,
      hideFinancialBreakdown: false,
      hideDrawerCharts: true,
      hideDashboardRadar: false,
      hideDashboardHeatmap: false
    },
    small: {
      id: 'small',
      labelAr: 'فريق صغير (1–3 موظفين) — واجهة مركزة للمتابعة السريعة',
      labelEn: 'Small Team (1–3) — Focused Rapid Follow-Up UI',
      hideSecondaryCarMeta: true,
      hideCustomerContactExtras: true,
      hideFinancialBreakdown: true,
      hideDrawerCharts: true,
      hideDashboardRadar: false,
      hideDashboardHeatmap: true
    },
    custom: {
      id: 'custom',
      labelAr: 'تخصيص يدوي للحقول والأقسام الظاهرة',
      labelEn: 'Custom Field & Section Visibility',
      hideSecondaryCarMeta: false,
      hideCustomerContactExtras: false,
      hideFinancialBreakdown: false,
      hideDrawerCharts: false,
      hideDashboardRadar: false,
      hideDashboardHeatmap: false
    }
  };

  var UI_FLAG_ALIASES = {
    hideResIdLookup: 'hideResCustomerIdLookupBtn',
    hideResCustomerIdLookupBtn: 'hideResIdLookup'
  };

  function toBoolFlagVal(val) {
    return val === true || val === 'true' || val === 1;
  }

  function normalizeUiSimplificationSettings(raw) {
    var input = raw;
    if (typeof raw === 'string') {
      try {
        input = JSON.parse(raw);
      } catch (_e) {
        input = {};
      }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var rawPreset = normalizeStr(obj.preset).toLowerCase();
    var presetId = (rawPreset === 'small' || rawPreset === 'medium' || rawPreset === 'full' || rawPreset === 'custom')
      ? rawPreset
      : 'full';
    var base = TEAM_UI_PRESETS[presetId] || TEAM_UI_PRESETS.full;

    function pickBool(key) {
      if (obj[key] !== undefined) {
        return toBoolFlagVal(obj[key]);
      }
      var alias = UI_FLAG_ALIASES[key];
      if (alias && obj[alias] !== undefined) {
        return toBoolFlagVal(obj[alias]);
      }
      return Boolean(base[key]);
    }

    var normalized = { preset: presetId };
    for (var i = 0; i < UI_SIMPLIFICATION_OPTIONS.length; i++) {
      var k = UI_SIMPLIFICATION_OPTIONS[i].key;
      var val = pickBool(k);
      normalized[k] = val;
      var aliasKey = UI_FLAG_ALIASES[k];
      if (aliasKey) {
        normalized[aliasKey] = val;
      }
    }
    return normalized;
  }

  // ---------- CENTRALIZED PER-ROLE UI DEFAULTS ----------

  var DEFAULT_RESERVATIONS_VISIBLE_COLS = [
    'reservationNumber',
    'customerName',
    'carName',
    'startDate',
    'totalAmount',
    'originalStatusAr',
    'internalStatus'
  ];

  function normalizeRoleUiDefaults(raw) {
    var input = raw;
    if (typeof raw === 'string') {
      try { input = JSON.parse(raw); } catch (_e) { input = {}; }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var rolesList = [ROLES.AGENT, ROLES.SUPERVISOR, ROLES.GENERAL_MANAGER, ROLES.DEVELOPER];
    var out = {};
    for (var i = 0; i < rolesList.length; i++) {
      var rKey = rolesList[i];
      var rCfg = (obj[rKey] && typeof obj[rKey] === 'object') ? obj[rKey] : {};
      var rawCols = Array.isArray(rCfg.visibleCols) ? rCfg.visibleCols.map(normalizeStr).filter(Boolean) : [];
      var dedupCols = [];
      var seenCol = {};
      for (var c = 0; c < rawCols.length; c++) {
        if (!seenCol[rawCols[c]]) { seenCol[rawCols[c]] = true; dedupCols.push(rawCols[c]); }
      }
      out[rKey] = {
        enabled: Boolean(rCfg.enabled),
        uiSimplification: rCfg.uiSimplification ? normalizeUiSimplificationSettings(rCfg.uiSimplification) : null,
        visibleCols: dedupCols.length ? dedupCols : DEFAULT_RESERVATIONS_VISIBLE_COLS.slice(),
        forceForRole: Boolean(rCfg.forceForRole)
      };
    }
    return out;
  }

  var UI_OVERRIDE_META_KEYS = {
    hiddenKeys: true,
    shownKeys: true,
    hidden: true,
    shown: true,
    flags: true,
    visibleCols: true,
    defaultRoute: true,
    updatedAt: true,
    updatedBy: true
  };

  function normalizeUiOverrides(raw) {
    var input = raw;
    if (typeof raw === 'string') {
      try { input = JSON.parse(raw); } catch (_e) { input = {}; }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var hiddenSeen = {};
    var hiddenKeys = [];
    var rawHidden = Array.isArray(obj.hiddenKeys) ? obj.hiddenKeys : (Array.isArray(obj.hidden) ? obj.hidden : []);
    for (var i = 0; i < rawHidden.length; i++) {
      var hk = normalizeStr(rawHidden[i]);
      if (hk && !hiddenSeen[hk]) { hiddenSeen[hk] = true; hiddenKeys.push(hk); }
    }
    var shownSeen = {};
    var shownKeys = [];
    var rawShown = Array.isArray(obj.shownKeys) ? obj.shownKeys : (Array.isArray(obj.shown) ? obj.shown : []);
    for (var j = 0; j < rawShown.length; j++) {
      var sk = normalizeStr(rawShown[j]);
      if (sk && !hiddenSeen[sk] && !shownSeen[sk]) { shownSeen[sk] = true; shownKeys.push(sk); }
    }
    var flags = {};
    var flagsSrc = (obj.flags && typeof obj.flags === 'object' && !Array.isArray(obj.flags)) ? obj.flags : {};
    var fKeys = Object.keys(flagsSrc);
    for (var fi = 0; fi < fKeys.length; fi++) {
      var fk = normalizeStr(fKeys[fi]);
      if (fk && typeof flagsSrc[fKeys[fi]] === 'boolean') {
        flags[fk] = flagsSrc[fKeys[fi]];
        if (UI_FLAG_ALIASES[fk] && flags[UI_FLAG_ALIASES[fk]] === undefined) {
          flags[UI_FLAG_ALIASES[fk]] = flagsSrc[fKeys[fi]];
        }
      }
    }
    var topKeys = Object.keys(obj);
    for (var ti = 0; ti < topKeys.length; ti++) {
      var tk = normalizeStr(topKeys[ti]);
      if (!tk || UI_OVERRIDE_META_KEYS[tk]) continue;
      if (typeof obj[topKeys[ti]] === 'boolean') {
        flags[tk] = obj[topKeys[ti]];
        if (UI_FLAG_ALIASES[tk] && flags[UI_FLAG_ALIASES[tk]] === undefined) {
          flags[UI_FLAG_ALIASES[tk]] = obj[topKeys[ti]];
        }
      }
    }
    var rawCols = Array.isArray(obj.visibleCols) ? obj.visibleCols.map(normalizeStr).filter(Boolean) : [];
    var colsOut = null;
    if (rawCols.length) {
      var colSeen = {};
      colsOut = [];
      for (var ci = 0; ci < rawCols.length; ci++) {
        if (!colSeen[rawCols[ci]]) { colSeen[rawCols[ci]] = true; colsOut.push(rawCols[ci]); }
      }
    }
    var out = {
      hiddenKeys: hiddenKeys,
      shownKeys: shownKeys,
      flags: flags,
      visibleCols: colsOut,
      defaultRoute: normalizeStr(obj.defaultRoute),
      updatedAt: normalizeStr(obj.updatedAt),
      updatedBy: normalizeStr(obj.updatedBy)
    };
    var outFlagKeys = Object.keys(flags);
    for (var ofi = 0; ofi < outFlagKeys.length; ofi++) {
      out[outFlagKeys[ofi]] = flags[outFlagKeys[ofi]];
    }
    return out;
  }

  function resolveRoleUiDefaultsForUser(user, roleUiDefaults, globalUiSimp) {
    var role = (user && user.role) ? normalizeStr(user.role) : ROLES.AGENT;
    if (role === ROLES.DEVELOPER) {
      var cleanDevUi = normalizeUiSimplificationSettings({ preset: 'full' });
      for (var di = 0; di < UI_SIMPLIFICATION_OPTIONS.length; di++) {
        var dk = UI_SIMPLIFICATION_OPTIONS[di].key;
        cleanDevUi[dk] = false;
        if (UI_FLAG_ALIASES[dk]) cleanDevUi[UI_FLAG_ALIASES[dk]] = false;
      }
      return {
        role: role,
        hasRoleOverride: false,
        hasEmployeeOverride: false,
        forceForRole: false,
        uiSimplification: cleanDevUi,
        uiOverrides: normalizeUiOverrides({}),
        visibleCols: DEFAULT_RESERVATIONS_VISIBLE_COLS.slice()
      };
    }
    var normDefaults = normalizeRoleUiDefaults(roleUiDefaults);
    var cfg = normDefaults[role] || normDefaults[ROLES.AGENT];
    var baseGlobal = normalizeUiSimplificationSettings(globalUiSimp);
    var roleUi = (cfg && cfg.enabled && cfg.uiSimplification)
      ? cfg.uiSimplification
      : baseGlobal;
    var effectiveUi = Object.assign({}, roleUi);
    var empOverrides = normalizeUiOverrides(user && user.uiOverrides);
    for (var i = 0; i < empOverrides.hiddenKeys.length; i++) {
      var hk = empOverrides.hiddenKeys[i];
      if (Object.prototype.hasOwnProperty.call(effectiveUi, hk)) {
        effectiveUi[hk] = true;
        if (UI_FLAG_ALIASES[hk]) effectiveUi[UI_FLAG_ALIASES[hk]] = true;
      }
    }
    for (var j = 0; j < empOverrides.shownKeys.length; j++) {
      var sk = empOverrides.shownKeys[j];
      if (Object.prototype.hasOwnProperty.call(effectiveUi, sk)) {
        effectiveUi[sk] = false;
        if (UI_FLAG_ALIASES[sk]) effectiveUi[UI_FLAG_ALIASES[sk]] = false;
      }
    }
    var flagKeys = Object.keys(empOverrides.flags);
    for (var k = 0; k < flagKeys.length; k++) {
      var fk = flagKeys[k];
      effectiveUi[fk] = empOverrides.flags[fk];
      if (UI_FLAG_ALIASES[fk]) {
        effectiveUi[UI_FLAG_ALIASES[fk]] = empOverrides.flags[fk];
      }
    }
    var visibleCols = (empOverrides.visibleCols && empOverrides.visibleCols.length)
      ? empOverrides.visibleCols.slice()
      : ((cfg && Array.isArray(cfg.visibleCols) && cfg.visibleCols.length)
        ? cfg.visibleCols.slice()
        : DEFAULT_RESERVATIONS_VISIBLE_COLS.slice());
    return {
      role: role,
      hasRoleOverride: Boolean(cfg && cfg.enabled),
      hasEmployeeOverride: Boolean(empOverrides.hiddenKeys.length || empOverrides.shownKeys.length || flagKeys.length || empOverrides.visibleCols),
      forceForRole: Boolean(cfg && cfg.enabled && cfg.forceForRole),
      uiSimplification: effectiveUi,
      uiOverrides: empOverrides,
      visibleCols: visibleCols
    };
  }

  // ---------- IMPERSONATION / PREVIEW ROLE ----------

  function canUserImpersonate(user) {
    if (!user || typeof user !== 'object') return false;
    var role = normalizeStr(user.baseRole || user.role);
    return role === ROLES.DEVELOPER || role === ROLES.GENERAL_MANAGER || role === ROLES.SUPERVISOR;
  }

  function getAllowedPreviewRoles(actorUser) {
    if (!canUserImpersonate(actorUser)) return [];
    var role = normalizeStr(actorUser.baseRole || actorUser.role);
    if (role === ROLES.DEVELOPER) {
      return [ROLES.AGENT, ROLES.SUPERVISOR, ROLES.GENERAL_MANAGER, ROLES.DEVELOPER];
    }
    if (role === ROLES.GENERAL_MANAGER) {
      return [ROLES.AGENT, ROLES.SUPERVISOR, ROLES.GENERAL_MANAGER];
    }
    return [ROLES.AGENT, ROLES.SUPERVISOR];
  }

  function resolvePreviewUserSession(realUser, previewSpec, employeesList, rolePresets) {
    if (!canUserImpersonate(realUser) || !previewSpec || typeof previewSpec !== 'object') {
      return null;
    }
    var allowedRoles = getAllowedPreviewRoles(realUser);
    var emps = Array.isArray(employeesList) ? employeesList : [];
    var targetEmp = null;
    if (previewSpec.employeeId) {
      var eid = normalizeStr(previewSpec.employeeId);
      for (var i = 0; i < emps.length; i++) {
        if (emps[i] && normalizeStr(emps[i].id) === eid) {
          targetEmp = emps[i];
          break;
        }
      }
    }
    var targetRole = targetEmp
      ? normalizeStr(targetEmp.role)
      : normalizeStr(previewSpec.role || ROLES.AGENT);
    if (allowedRoles.indexOf(targetRole) === -1) {
      return null;
    }

    var perms = null;
    if (Array.isArray(previewSpec.customPermissions)) {
      perms = sanitizePresetPermissions(targetRole, previewSpec.customPermissions);
    } else if (targetEmp) {
      perms = resolveEffectivePermissions(targetEmp);
    } else if (previewSpec.presetId && Array.isArray(rolePresets)) {
      var pid = normalizeStr(previewSpec.presetId);
      for (var j = 0; j < rolePresets.length; j++) {
        if (rolePresets[j] && rolePresets[j].id === pid && allowedRoles.indexOf(rolePresets[j].role) !== -1) {
          targetRole = rolePresets[j].role;
          perms = sanitizePresetPermissions(targetRole, rolePresets[j].permissions);
          break;
        }
      }
    }
    if (!perms) {
      perms = (ROLE_PERMISSION_MATRIX[targetRole] || ROLE_PERMISSION_MATRIX.agent).slice();
    }

    var labelAr = (ROLE_LABELS.ar && ROLE_LABELS.ar[targetRole]) || targetRole;
    var customLbl = normalizeStr(previewSpec.customLabel);
    var previewDisplayName = targetEmp
      ? targetEmp.name
      : (customLbl ? ('معاينة: ' + customLbl) : ('معاينة: ' + labelAr));
    return {
      id: targetEmp ? targetEmp.id : (realUser.id || 'PREVIEW_USER'),
      name: previewDisplayName,
      username: targetEmp ? targetEmp.username : ('preview_' + targetRole),
      jobTitle: targetEmp ? targetEmp.jobTitle : (customLbl || labelAr),
      role: targetRole,
      permissions: perms,
      status: 'active',
      isPreviewSession: true,
      previewMode: targetEmp ? 'employee' : 'role',
      previewTargetEmployeeId: targetEmp ? targetEmp.id : '',
      previewTargetRole: targetRole,
      realActorId: realUser.id,
      realActorName: realUser.name,
      realActorRole: realUser.role
    };
  }

  // ---------- DEVELOPER STATS CONTROL CONFIG ----------

  var DEFAULT_STATS_CONTROL_CONFIG = {
    excludedFromStatsEmployeeIds: [],
    updatedAt: '',
    updatedBy: ''
  };

  var STATS_VIEW_PERMISSION_KEYS = [
    'view_reports',
    'sub_view_rep_charts',
    'sub_view_prb_rates',
    'dash_view_charts_grid',
    'dash_view_leaderboard',
    'dash_view_heatmap',
    'dash_view_daily_chart'
  ];

  function normalizeStatsControlConfig(raw) {
    var parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_e) {
        parsed = {};
      }
    }
    var src = (parsed && typeof parsed === 'object') ? parsed : {};
    var rawIds = Array.isArray(src.excludedFromStatsEmployeeIds)
      ? src.excludedFromStatsEmployeeIds
      : (Array.isArray(src.excludedEmployeeIds) ? src.excludedEmployeeIds : []);
    var seen = {};
    var excludedIds = [];
    for (var i = 0; i < rawIds.length; i++) {
      var id = normalizeStr(rawIds[i]);
      if (id && !seen[id]) {
        seen[id] = true;
        excludedIds.push(id);
      }
    }
    return {
      excludedFromStatsEmployeeIds: excludedIds,
      updatedAt: normalizeStr(src.updatedAt),
      updatedBy: normalizeStr(src.updatedBy)
    };
  }

  function isEmployeeIncludedInStats(empOrId, config) {
    if (!empOrId) return false;
    var empId = typeof empOrId === 'string' ? normalizeStr(empOrId) : normalizeStr(empOrId.id);
    if (!empId) return false;
    if (typeof empOrId === 'object' && empOrId.status === 'disabled') return false;
    var norm = normalizeStatsControlConfig(config);
    return norm.excludedFromStatsEmployeeIds.indexOf(empId) === -1;
  }

  function filterEmployeesForStats(employees, config) {
    var norm = normalizeStatsControlConfig(config);
    var excludedMap = {};
    for (var i = 0; i < norm.excludedFromStatsEmployeeIds.length; i++) {
      excludedMap[norm.excludedFromStatsEmployeeIds[i]] = true;
    }
    return (Array.isArray(employees) ? employees : []).filter(function (e) {
      return e && e.status !== 'disabled' && !excludedMap[e.id];
    });
  }

  function canEmployeeViewStatistics(empOrUser) {
    if (!empOrUser) return false;
    if (empOrUser.role === ROLES.DEVELOPER) return true;
    var canReports = canUserViewRoute(empOrUser, 'reports');
    var canCharts = canUserViewDashboardSection(empOrUser, 'dash_view_charts_grid') ||
      canUserViewDashboardSection(empOrUser, 'dash_view_leaderboard');
    return Boolean(canReports || canCharts);
  }

  function applyEmployeeStatsViewToggle(role, currentPerms, canViewStats) {
    return setEmployeeSectionGroupVisibility(role, currentPerms, STATS_VIEW_PERMISSION_KEYS, Boolean(canViewStats));
  }

  // ---------- DASHBOARD EMPLOYEE LEADERBOARD ----------

  function computeEmployeeLeaderboard(employees, reservations, followUps, problems, options) {
    var opts = options || {};
    var excludedList = Array.isArray(opts.excludedEmployeeIds)
      ? opts.excludedEmployeeIds
      : (opts.statsControlConfig && Array.isArray(opts.statsControlConfig.excludedFromStatsEmployeeIds)
        ? opts.statsControlConfig.excludedFromStatsEmployeeIds
        : []);
    var excludedMap = {};
    for (var ex = 0; ex < excludedList.length; ex++) {
      var exKey = normalizeStr(excludedList[ex]);
      if (exKey) excludedMap[exKey] = true;
    }
    var emps = (Array.isArray(employees) ? employees : []).filter(function (e) {
      return e && e.status !== 'disabled' && !excludedMap[e.id];
    });
    var resList = Array.isArray(reservations) ? reservations : [];
    var fuList = Array.isArray(followUps) ? followUps : [];
    var prbList = Array.isArray(problems) ? problems : [];
    var limit = Math.max(1, Math.min(50, Math.round(toNum(opts.limit, 10))));

    var fuByEmpId = {};
    var fuByEmpName = {};
    for (var f = 0; f < fuList.length; f++) {
      var fu = fuList[f];
      if (!fu) continue;
      if (fu.employeeId) fuByEmpId[fu.employeeId] = (fuByEmpId[fu.employeeId] || 0) + 1;
      if (fu.employeeName) fuByEmpName[fu.employeeName] = (fuByEmpName[fu.employeeName] || 0) + 1;
    }

    var assignedByEmpId = {};
    var closedByEmpId = {};
    for (var r = 0; r < resList.length; r++) {
      var rec = resList[r];
      if (!rec) continue;
      var ids = Array.isArray(rec.assignedEmployeeIds) ? rec.assignedEmployeeIds : [];
      var isClosed = isReservationClosedStatus(rec);
      for (var k = 0; k < ids.length; k++) {
        var eid = ids[k];
        if (!eid) continue;
        assignedByEmpId[eid] = (assignedByEmpId[eid] || 0) + 1;
        if (isClosed) closedByEmpId[eid] = (closedByEmpId[eid] || 0) + 1;
      }
    }

    var resolvedPrbByEmpId = {};
    for (var p = 0; p < prbList.length; p++) {
      var prb = prbList[p];
      if (!prb || !isProblemClosedStatus(prb.status)) continue;
      var pIds = Array.isArray(prb.assignedEmployeeIds) ? prb.assignedEmployeeIds : [];
      var targetIds = pIds.length ? pIds : (prb.createdById ? [prb.createdById] : []);
      for (var q = 0; q < targetIds.length; q++) {
        var peid = targetIds[q];
        if (peid) resolvedPrbByEmpId[peid] = (resolvedPrbByEmpId[peid] || 0) + 1;
      }
    }

    var entries = emps.map(function (emp) {
      var followUpsCount = fuByEmpId[emp.id] !== undefined ? fuByEmpId[emp.id] : (fuByEmpName[emp.name] || 0);
      var assignedCount = assignedByEmpId[emp.id] || 0;
      var closedCount = closedByEmpId[emp.id] || 0;
      var resolvedProblemsCount = resolvedPrbByEmpId[emp.id] || 0;
      var score = (followUpsCount * 3) + (closedCount * 4) + (resolvedProblemsCount * 5) + assignedCount;
      var completionRate = assignedCount > 0 ? Math.min(100, Math.round((closedCount / assignedCount) * 100)) : (followUpsCount > 0 ? 100 : 0);
      return {
        employeeId: emp.id,
        name: emp.name || emp.username || emp.id,
        role: emp.role || ROLES.AGENT,
        jobTitle: emp.jobTitle || '',
        followUpsCount: followUpsCount,
        assignedCount: assignedCount,
        closedCount: closedCount,
        closedBookingsCount: closedCount,
        resolvedProblemsCount: resolvedProblemsCount,
        completionRate: completionRate,
        score: score
      };
    });

    entries.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.followUpsCount !== a.followUpsCount) return b.followUpsCount - a.followUpsCount;
      if (b.closedCount !== a.closedCount) return b.closedCount - a.closedCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return entries.slice(0, limit).map(function (entry, idx) {
      return Object.assign({}, entry, { rank: idx + 1 });
    });
  }

  // ---------- ANTI-SPAM & DUPLICATE ACTION GUARD ----------

  var SPAM_GUARD_EXEMPT_ACTIONS = {
    ping: true,
    login: true,
    logout: true,
    getMe: true,
    getAppBootstrap: true,
    getDashboard: true,
    getTodayAndRadar: true,
    getReservations: true,
    getInactiveReservations: true,
    searchCustomerByNationalId: true,
    getReservationDetails: true,
    getMyFollowUps: true,
    getTeamFollowUps: true,
    getFollowUpHistory: true,
    getProblems: true,
    getProblemDetails: true,
    getNotifications: true,
    getActivityLogs: true,
    getReports: true,
    getSettings: true,
    getSyncStatus: true,
    getTriggerStatus: true,
    getAnnouncements: true,
    getDelegations: true,
    getReservationLocks: true,
    getDeltaSync: true,
    heartbeatReservationLock: true,
    releaseReservationLock: true,
    saveUserLayoutPrefs: true
  };

  function evaluateSpamGuard(stateObj, action, signature, opts) {
    var act = normalizeStr(action);
    if (!act || SPAM_GUARD_EXEMPT_ACTIONS[act]) {
      return { allowed: true, reason: '', waitMs: 0 };
    }
    var o = opts || {};
    var nowMs = (typeof o.nowMs === 'number' && isFinite(o.nowMs)) ? o.nowMs : Date.now();
    var dupWindowMs = Math.max(200, toNum(o.duplicateWindowMs, 1500));
    var burstWindowMs = Math.max(1000, toNum(o.burstWindowMs, 10000));
    var maxBurst = Math.max(3, Math.round(toNum(o.maxBurst, 18)));

    var store = (stateObj && typeof stateObj === 'object') ? stateObj : {};
    if (!Array.isArray(store.timestamps)) store.timestamps = [];
    if (!store.signatures || typeof store.signatures !== 'object') store.signatures = {};

    // Prune expired records
    store.timestamps = store.timestamps.filter(function (ts) {
      return (nowMs - ts) < burstWindowMs;
    });
    var sigKeys = Object.keys(store.signatures);
    for (var i = 0; i < sigKeys.length; i++) {
      if ((nowMs - store.signatures[sigKeys[i]]) >= dupWindowMs) {
        delete store.signatures[sigKeys[i]];
      }
    }

    var sig = normalizeStr(signature) || act;
    if (store.signatures[sig] !== undefined) {
      var waitDup = Math.max(100, dupWindowMs - (nowMs - store.signatures[sig]));
      return {
        allowed: false,
        reason: 'DUPLICATE_SUBMISSION',
        waitMs: waitDup,
        message: 'تم إرسال نفس العملية قبل لحظات، تم منع التكرار التلقائي (مانع Spam).'
      };
    }

    if (store.timestamps.length >= maxBurst) {
      var oldest = store.timestamps[0] || nowMs;
      var waitBurst = Math.max(250, burstWindowMs - (nowMs - oldest));
      return {
        allowed: false,
        reason: 'RATE_LIMITED',
        waitMs: waitBurst,
        message: 'تم إرسال عدد كبير من الطلبات المتتالية بسرعة. يرجى الانتظار لحظة ثم المحاولة.'
      };
    }

    store.timestamps.push(nowMs);
    store.signatures[sig] = nowMs;
    return { allowed: true, reason: '', waitMs: 0 };
  }

  function formatDirectCallTelHref(phone, prefix) {
    var ascii = convertEasternDigitsToAscii(phone === undefined || phone === null ? '' : String(phone));
    var digitsOnly = ascii.replace(/\D/g, '');
    if (!digitsOnly) return '';

    var pfx = convertEasternDigitsToAscii(prefix === undefined || prefix === null ? '9' : String(prefix)).replace(/\D/g, '');
    if (!pfx) pfx = '9';

    var local = digitsOnly;
    if (local.indexOf('00966') === 0 && local.length >= 14) {
      local = local.slice(5);
    } else if (local.indexOf('966') === 0 && local.length >= 11) {
      local = local.slice(3);
    }

    if (/^5\d{8}$/.test(local)) {
      local = '0' + local;
    }

    if (!local) return '';
    return 'tel:' + pfx + local;
  }

  function formatDirectCallDisplayNumber(phone, prefix) {
    var href = formatDirectCallTelHref(phone, prefix);
    return href ? href.replace(/^tel:/, '') : '';
  }

  function formatBookingSummaryText(reservation, lang, options) {
    var r = (reservation && typeof reservation === 'object') ? reservation : {};
    var isEn = lang === 'en';
    var timeFmt = normalizeTimeFormat(options && options.timeFormat);
    var tzMode = normalizeTimezoneMode(options && options.timezoneMode);
    var resNum = normalizeStr(r.reservationNumber || r.id) || '-';
    var customer = normalizeStr(r.customerName) || '-';
    var phone = normalizeStr(r.customerPhone) || '-';
    var car = normalizeStr(r.carName) || '-';
    var plate = normalizeStr(r.plateNumber) || '-';
    var company = normalizeStr(r.companyName) || '-';
    var branch = normalizeStr(r.branchName) || '-';

    function fmtEndpoint(dateVal, timeVal) {
      if (!dateVal && !timeVal) return '-';
      if (!timeVal) return formatDisplayDate(dateVal) || '-';
      var disp = buildBookingTimezoneDisplay(dateVal, timeVal, {
        lang: lang,
        timeFormat: timeFmt,
        timezoneMode: tzMode,
        compact: false
      });
      if (!disp.entries || !disp.entries.length) return formatDisplayDate(dateVal) || '-';
      return disp.entries.map(function (e) {
        return e.valueText + ' (' + e.label + ')';
      }).join(' / ');
    }

    var startD = fmtEndpoint(r.startDate, r.startTime);
    var endD = fmtEndpoint(r.extendedUntilDate || r.endDate, r.extendedUntilTime || r.endTime);
    var totalAmt = Number(r.totalAmount || 0);
    var status = normalizeStr(r.internalStatus || r.originalStatusAr) || '-';

    if (isEn) {
      return [
        'Booking #: ' + resNum,
        'Customer: ' + customer + (phone !== '-' ? (' (' + phone + ')') : ''),
        'Vehicle: ' + car + (plate !== '-' ? (' | Plate: ' + plate) : ''),
        'Company / Branch: ' + company + ' — ' + branch,
        'Dates: ' + startD + ' → ' + endD,
        'Status: ' + status + ' | Total: ' + totalAmt + ' SAR'
      ].join('\n');
    }

    return [
      'رقم الحجز: ' + resNum,
      'العميل: ' + customer + (phone !== '-' ? (' (' + phone + ')') : ''),
      'السيارة: ' + car + (plate !== '-' ? (' | اللوحة: ' + plate) : ''),
      'الشركة / الفرع: ' + company + ' — ' + branch,
      'الفترة: ' + startD + ' إلى ' + endD,
      'الحالة: ' + status + ' | الإجمالي: ' + totalAmt + ' ر.س'
    ].join('\n');
  }

  function buildNoAnswerActionText(attemptNumber, lang) {
    var n = Math.max(1, Math.floor(Number(attemptNumber || 1)));
    return lang === 'en'
      ? ('Call attempt — No Answer (Attempt #' + n + ')')
      : ('محاولة اتصال — لم يرد (المحاولة #' + n + ')');
  }

  function computeSharedAssignmentInfo(assignedIds, assignedNames, currentEmpId, lang) {
    var rawIds = Array.isArray(assignedIds) ? assignedIds : [];
    var rawNames = Array.isArray(assignedNames) ? assignedNames : [];
    var seen = {};
    var ids = [];
    var names = [];
    for (var i = 0; i < rawIds.length; i++) {
      var idVal = normalizeStr(rawIds[i]);
      if (!idVal || seen[idVal]) continue;
      seen[idVal] = true;
      ids.push(idVal);
      names.push(normalizeStr(rawNames[i]) || idVal);
    }

    var curId = normalizeStr(currentEmpId);
    if (ids.length === 0) {
      return {
        status: 'unassigned',
        isAssignedToCurrent: false,
        totalAssignees: 0,
        colleagueIds: [],
        colleagueNames: [],
        colleagueCount: 0,
        badgeAr: 'غير مستلم بعد',
        badgeEn: 'Unassigned',
        badge: lang === 'en' ? 'Unassigned' : 'غير مستلم بعد'
      };
    }

    var isMine = Boolean(curId && ids.indexOf(curId) !== -1);
    var colleagueIds = [];
    var colleagueNames = [];
    for (var j = 0; j < ids.length; j++) {
      if (!curId || ids[j] !== curId) {
        colleagueIds.push(ids[j]);
        colleagueNames.push(names[j]);
      }
    }

    if (isMine && ids.length === 1) {
      return {
        status: 'exclusive',
        isAssignedToCurrent: true,
        totalAssignees: 1,
        colleagueIds: [],
        colleagueNames: [],
        colleagueCount: 0,
        badgeAr: 'حصري لك',
        badgeEn: 'Exclusive to you',
        badge: lang === 'en' ? 'Exclusive to you' : 'حصري لك'
      };
    }

    if (isMine && ids.length > 1) {
      var cCount = colleagueIds.length;
      var badgeArShared = cCount === 1
        ? ('مشترك مع ' + colleagueNames[0])
        : ('مشترك مع ' + cCount + ' زملاء');
      var badgeEnShared = cCount === 1
        ? ('Shared with ' + colleagueNames[0])
        : ('Shared with ' + cCount + ' colleagues');
      return {
        status: 'shared',
        isAssignedToCurrent: true,
        totalAssignees: ids.length,
        colleagueIds: colleagueIds,
        colleagueNames: colleagueNames,
        colleagueCount: cCount,
        badgeAr: badgeArShared,
        badgeEn: badgeEnShared,
        badge: lang === 'en' ? badgeEnShared : badgeArShared
      };
    }

    if (!isMine && ids.length === 1) {
      var ownerName = names[0] || ids[0];
      return {
        status: 'exclusive_other',
        isAssignedToCurrent: false,
        totalAssignees: 1,
        colleagueIds: colleagueIds,
        colleagueNames: colleagueNames,
        colleagueCount: 1,
        badgeAr: 'حصري لـ ' + ownerName,
        badgeEn: 'Exclusive: ' + ownerName,
        badge: lang === 'en' ? ('Exclusive: ' + ownerName) : ('حصري لـ ' + ownerName)
      };
    }

    var sharedOthersAr = 'مشترك (' + ids.length + ' موظفين)';
    var sharedOthersEn = 'Shared (' + ids.length + ' staff)';
    return {
      status: 'shared',
      isAssignedToCurrent: false,
      totalAssignees: ids.length,
      colleagueIds: colleagueIds,
      colleagueNames: colleagueNames,
      colleagueCount: colleagueIds.length,
      badgeAr: sharedOthersAr,
      badgeEn: sharedOthersEn,
      badge: lang === 'en' ? sharedOthersEn : sharedOthersAr
    };
  }

  function classifyProblemRateSeverity(ratePer100) {
    var rate = Number(ratePer100 || 0);
    if (rate >= 15) return 'danger';
    if (rate >= 5) return 'warning';
    return 'normal';
  }

  function computeProblemsPer100Bookings(reservations, problems) {
    var resList = Array.isArray(reservations) ? reservations : [];
    var prbList = Array.isArray(problems) ? problems : [];

    var resById = {};
    var resByNum = {};
    var companyMap = {};
    var branchMap = {};

    function ensureCompany(comp) {
      var name = normalizeStr(comp) || 'غير محدد';
      if (!companyMap[name]) {
        companyMap[name] = {
          companyName: name,
          totalBookings: 0,
          problemsCount: 0,
          openProblemsCount: 0,
          resolvedProblemsCount: 0,
          ratePer100: 0,
          severity: 'normal'
        };
      }
      return companyMap[name];
    }

    function ensureBranch(comp, br) {
      var cName = normalizeStr(comp) || 'غير محدد';
      var bName = normalizeStr(br) || 'الفرع الرئيسي';
      var key = cName + '||' + bName;
      if (!branchMap[key]) {
        branchMap[key] = {
          key: key,
          companyName: cName,
          branchName: bName,
          totalBookings: 0,
          problemsCount: 0,
          openProblemsCount: 0,
          resolvedProblemsCount: 0,
          ratePer100: 0,
          severity: 'normal'
        };
      }
      return branchMap[key];
    }

    for (var i = 0; i < resList.length; i++) {
      var r = resList[i];
      if (!r || typeof r !== 'object') continue;
      if (r.id) resById[String(r.id)] = r;
      if (r.reservationNumber) resByNum[String(r.reservationNumber)] = r;
      ensureCompany(r.companyName).totalBookings += 1;
      ensureBranch(r.companyName, r.branchName).totalBookings += 1;
    }

    var totalOpen = 0;
    var totalResolved = 0;
    for (var j = 0; j < prbList.length; j++) {
      var p = prbList[j];
      if (!p || typeof p !== 'object') continue;
      var matchedRes = (p.reservationId && resById[String(p.reservationId)]) ||
        (p.reservationNumber && resByNum[String(p.reservationNumber)]) ||
        null;
      var cName = normalizeStr(p.companyName || (matchedRes && matchedRes.companyName)) || 'غير محدد';
      var bName = normalizeStr(p.branchName || (matchedRes && matchedRes.branchName)) || 'الفرع الرئيسي';
      var closed = isProblemClosedStatus(p.status);
      if (closed) totalResolved += 1;
      else totalOpen += 1;

      var cBucket = ensureCompany(cName);
      cBucket.problemsCount += 1;
      if (closed) cBucket.resolvedProblemsCount += 1;
      else cBucket.openProblemsCount += 1;

      var bBucket = ensureBranch(cName, bName);
      bBucket.problemsCount += 1;
      if (closed) bBucket.resolvedProblemsCount += 1;
      else bBucket.openProblemsCount += 1;
    }

    function finalizeBucket(bucket) {
      var rate = bucket.totalBookings > 0
        ? Math.round((bucket.problemsCount / bucket.totalBookings) * 1000) / 10
        : (bucket.problemsCount > 0 ? 100 : 0);
      bucket.ratePer100 = rate;
      bucket.severity = classifyProblemRateSeverity(rate);
      return bucket;
    }

    var byCompany = Object.keys(companyMap).map(function (k) {
      return finalizeBucket(companyMap[k]);
    }).sort(function (a, b) {
      if (b.ratePer100 !== a.ratePer100) return b.ratePer100 - a.ratePer100;
      if (b.problemsCount !== a.problemsCount) return b.problemsCount - a.problemsCount;
      return b.totalBookings - a.totalBookings;
    });

    var byBranch = Object.keys(branchMap).map(function (k) {
      return finalizeBucket(branchMap[k]);
    }).sort(function (a, b) {
      if (b.ratePer100 !== a.ratePer100) return b.ratePer100 - a.ratePer100;
      if (b.problemsCount !== a.problemsCount) return b.problemsCount - a.problemsCount;
      return b.totalBookings - a.totalBookings;
    });

    var overallRate = resList.length > 0
      ? Math.round((prbList.length / resList.length) * 1000) / 10
      : (prbList.length > 0 ? 100 : 0);

    return {
      overall: {
        totalBookings: resList.length,
        problemsCount: prbList.length,
        openProblemsCount: totalOpen,
        resolvedProblemsCount: totalResolved,
        ratePer100: overallRate,
        severity: classifyProblemRateSeverity(overallRate)
      },
      byCompany: byCompany,
      byBranch: byBranch
    };
  }

  function filterMentionFollowUps(followUps, currentUser, allEmployees) {
    var list = Array.isArray(followUps) ? followUps : [];
    var me = (currentUser && typeof currentUser === 'object') ? currentUser : {};
    var myId = normalizeStr(me.id);
    if (!myId && !normalizeStr(me.name) && !normalizeStr(me.username)) return [];

    var pool = Array.isArray(allEmployees) ? allEmployees.slice() : [];
    if (myId && !pool.some(function (e) { return e && e.id === myId; })) {
      pool.push({
        id: myId,
        name: normalizeStr(me.name),
        username: normalizeStr(me.username),
        status: 'active'
      });
    }

    var matches = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || typeof f !== 'object') continue;
      var combined = [normalizeStr(f.action), normalizeStr(f.notes)].filter(Boolean).join('\n');
      if (!combined || combined.indexOf('@') === -1) continue;
      var mentioned = extractMentionedEmployees(combined, pool, {});
      var hitsMe = mentioned.some(function (m) {
        return (myId && m.id === myId) ||
          (me.username && m.username && m.username.toLowerCase() === String(me.username).toLowerCase());
      });
      if (hitsMe) {
        matches.push(f);
      }
    }

    matches.sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return matches;
  }

  var PROBLEM_RATE_VISIBILITY_STORAGE_KEY = 'rg_crm_problems_rate_visible_v1';

  function normalizeProblemRateVisibility(raw) {
    if (raw === false || raw === 0) return false;
    var s = normalizeStr(raw).toLowerCase();
    if (s === 'false' || s === '0' || s === 'hidden' || s === 'off' || s === 'no') {
      return false;
    }
    return true;
  }

  function formatProblemRateToggleLabel(isVisible, lang) {
    var visible = Boolean(isVisible);
    if (lang === 'en') {
      return visible ? 'Hide Problems / 100 Rate' : 'Show Problems / 100 Rate';
    }
    return visible ? 'إخفاء مؤشر نسبة المشكلات' : 'إظهار مؤشر نسبة المشكلات';
  }

  var NAV_ROUTE_IDS = ['dashboard', 'customers', 'reservations', 'my-followups', 'team-followups', 'problems', 'reports', 'employees', 'activity', 'settings'];
  var PROTECTED_NAV_ROUTES = ['dashboard', 'settings'];

  var DASHBOARD_SECTION_DEFS = [
    { id: 'hero_kpis', domId: 'dash-kpis-hero', permKey: 'dash_view_hero_kpis', uiSimpKey: 'hideDashHeroKpis', labelAr: 'المؤشرات الرئيسية (Hero KPIs)', labelEn: 'Hero KPIs' },
    { id: 'strip_kpis', domId: 'dash-kpis-strip', permKey: 'dash_view_strip_kpis', uiSimpKey: 'hideDashStripKpis', labelAr: 'شريط مؤشرات الحالات التفصيلية', labelEn: 'Status Strip KPIs' },
    { id: 'daily_chart', domId: 'dash-daily-chart-card', permKey: 'dash_view_daily_chart', uiSimpKey: 'hideDashDailyChart', labelAr: 'رسم المتابعات اليومية', labelEn: 'Daily Follow-Ups Chart' },
    { id: 'recent_activity', domId: 'dash-recent-activity-card', permKey: 'dash_view_recent_activity', uiSimpKey: 'hideDashRecentActivity', labelAr: 'بطاقة أحدث النشاطات', labelEn: 'Recent Activity Feed' },
    { id: 'charts_grid', domId: 'dash-charts-grid', permKey: 'dash_view_charts_grid', uiSimpKey: 'hideDashChartsGrid', labelAr: 'شبكة الرسوم البيانية التحليلية', labelEn: 'Analytics Charts Grid' },
    { id: 'expiry_radar', domId: 'dash-expiry-radar-section', permKey: 'dash_view_radar', uiSimpKey: 'hideDashboardRadar', labelAr: 'رادار انتهاء الحجوزات (24 ساعة)', labelEn: '24h Expiry Radar' },
    { id: 'peak_heatmap', domId: 'dash-peak-heatmap-section', permKey: 'dash_view_heatmap', uiSimpKey: 'hideDashboardHeatmap', labelAr: 'مصفوفة ساعات الذروة', labelEn: 'Peak Hours Heatmap' },
    { id: 'leaderboard', domId: 'dash-leaderboard-section', permKey: 'dash_view_leaderboard', uiSimpKey: 'hideDashLeaderboard', labelAr: 'لوحة صدارة الموظفين (Leaderboard)', labelEn: 'Team Leaderboard' },
    { id: 'bottom_bento', domId: 'dash-bottom-bento', permKey: 'dash_view_bottom_bento', uiSimpKey: 'hideDashBottomBento', labelAr: 'أحدث الحجوزات والمشكلات والإجراءات', labelEn: 'Recent Bookings, Problems & Actions' }
  ];

  function normalizePermutationList(rawList, canonicalIds) {
    var seen = {};
    var out = [];
    var allowed = {};
    for (var i = 0; i < canonicalIds.length; i++) {
      allowed[canonicalIds[i]] = true;
    }
    var src = Array.isArray(rawList) ? rawList : [];
    for (var j = 0; j < src.length; j++) {
      var id = normalizeStr(src[j]);
      if (!id || !allowed[id] || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    for (var k = 0; k < canonicalIds.length; k++) {
      if (!seen[canonicalIds[k]]) {
        out.push(canonicalIds[k]);
      }
    }
    return out;
  }

  function normalizeUserLayoutPrefs(raw) {
    var input = raw;
    if (typeof raw === 'string') {
      try {
        input = JSON.parse(raw);
      } catch (_e) {
        input = {};
      }
    }
    var obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    var dashIds = DASHBOARD_SECTION_DEFS.map(function (d) { return d.id; });
    var navOrder = normalizePermutationList(obj.navOrder, NAV_ROUTE_IDS);
    var dashOrder = normalizePermutationList(obj.dashOrder, dashIds);

    var hiddenNavSeen = {};
    var hiddenRoutes = (Array.isArray(obj.hiddenRoutes) ? obj.hiddenRoutes : []).map(normalizeStr).filter(function (id) {
      if (!id || NAV_ROUTE_IDS.indexOf(id) === -1 || PROTECTED_NAV_ROUTES.indexOf(id) !== -1 || hiddenNavSeen[id]) return false;
      hiddenNavSeen[id] = true;
      return true;
    });

    var hiddenDashSeen = {};
    var dashHidden = (Array.isArray(obj.dashHidden) ? obj.dashHidden : []).map(normalizeStr).filter(function (id) {
      if (!id || dashIds.indexOf(id) === -1 || hiddenDashSeen[id]) return false;
      hiddenDashSeen[id] = true;
      return true;
    });

    var rawTheme = normalizeStr(obj.theme).toLowerCase();
    var theme = (rawTheme === 'dark' || rawTheme === 'light') ? rawTheme : '';
    var rawLang = normalizeStr(obj.lang).toLowerCase();
    var lang = (rawLang === 'ar' || rawLang === 'en') ? rawLang : '';
    var sidebarCollapsed = obj.sidebarCollapsed === true || obj.sidebarCollapsed === 'true';

    return {
      navOrder: navOrder,
      hiddenRoutes: hiddenRoutes,
      dashOrder: dashOrder,
      dashHidden: dashHidden,
      timeFormat: normalizeTimeFormat(obj.timeFormat),
      sidebarPosition: normalizeSidebarPosition(obj.sidebarPosition),
      timezoneMode: normalizeTimezoneMode(obj.timezoneMode),
      reservationsDisplayMode: normalizeReservationsDisplayMode(obj.reservationsDisplayMode),
      calendarGranularity: normalizeCalendarGranularity(obj.calendarGranularity),
      theme: theme,
      lang: lang,
      sidebarCollapsed: Boolean(sidebarCollapsed)
    };
  }

  function reorderListByDragDrop(orderList, draggedId, targetId) {
    var list = Array.isArray(orderList) ? orderList.slice() : [];
    var fromId = normalizeStr(draggedId);
    var toId = normalizeStr(targetId);
    if (!fromId || !toId || fromId === toId) return list;
    var fromIdx = list.indexOf(fromId);
    var toIdx = list.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return list;
    list.splice(fromIdx, 1);
    list.splice(toIdx, 0, fromId);
    return list;
  }

  function moveOrderItem(orderList, itemId, direction) {
    var list = Array.isArray(orderList) ? orderList.slice() : [];
    var id = normalizeStr(itemId);
    var idx = list.indexOf(id);
    if (idx === -1) return list;
    var step = (direction === 'up' || direction === -1) ? -1 : 1;
    var nextIdx = idx + step;
    if (nextIdx < 0 || nextIdx >= list.length) return list;
    list.splice(idx, 1);
    list.splice(nextIdx, 0, id);
    return list;
  }

  function computeDashboardSectionSpans(visibleIds) {
    var list = Array.isArray(visibleIds) ? visibleIds.map(normalizeStr).filter(Boolean) : [];
    var idxDaily = list.indexOf('daily_chart');
    var idxActivity = list.indexOf('recent_activity');
    var adjacentTopBento = idxDaily !== -1 && idxActivity !== -1 && Math.abs(idxDaily - idxActivity) === 1;
    var spans = {};
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (adjacentTopBento && id === 'daily_chart') {
        spans[id] = 'dash-sec-half-wide';
      } else if (adjacentTopBento && id === 'recent_activity') {
        spans[id] = 'dash-sec-half-narrow';
      } else {
        spans[id] = 'dash-sec-full';
      }
    }
    return spans;
  }

  function getFirstAllowedRoute(user, layoutPrefs, candidateOrder, uiContext) {
    var lp = normalizeUserLayoutPrefs(layoutPrefs);
    var hiddenSet = {};
    for (var h = 0; h < lp.hiddenRoutes.length; h++) {
      hiddenSet[lp.hiddenRoutes[h]] = true;
    }

    function isAllowed(routeId) {
      if (!user || !routeId) return false;
      return canUserViewRoute(user, routeId, uiContext);
    }

    var searchOrder = [];
    var seed = Array.isArray(candidateOrder) && candidateOrder.length ? candidateOrder : lp.navOrder;
    var seen = {};
    for (var i = 0; i < seed.length; i++) {
      var r1 = normalizeStr(seed[i]);
      if (r1 && !seen[r1]) { seen[r1] = true; searchOrder.push(r1); }
    }
    for (var j = 0; j < NAV_ROUTE_IDS.length; j++) {
      var r2 = NAV_ROUTE_IDS[j];
      if (!seen[r2]) { seen[r2] = true; searchOrder.push(r2); }
    }

    for (var k = 0; k < searchOrder.length; k++) {
      var cid = searchOrder[k];
      if (!isAllowed(cid)) continue;
      if (cid !== 'settings' && hiddenSet[cid]) continue;
      return cid;
    }
    for (var m = 0; m < searchOrder.length; m++) {
      if (isAllowed(searchOrder[m])) return searchOrder[m];
    }
    return '';
  }

  function normalizeExcelCellDate(val) {
    if (val === undefined || val === null || val === '') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString().slice(0, 10);
    }
    if (typeof val === 'number' && isFinite(val) && val > 20000 && val < 90000) {
      var utcMs = Math.round((val - 25569) * 86400 * 1000);
      var dt = new Date(utcMs);
      if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    }
    var raw = convertEasternDigitsToAscii(String(val)).trim();
    if (!raw || raw === '-') return '';
    if (/^\d{4,5}$/.test(raw)) {
      var serial = Number(raw);
      if (serial > 20000 && serial < 90000) {
        var utcMs2 = Math.round((serial - 25569) * 86400 * 1000);
        var dt2 = new Date(utcMs2);
        if (!isNaN(dt2.getTime())) return dt2.toISOString().slice(0, 10);
      }
    }
    var slashDmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(raw);
    if (slashDmy) {
      return slashDmy[3] + '-' + String(Number(slashDmy[2])).padStart(2, '0') + '-' + String(Number(slashDmy[1])).padStart(2, '0');
    }
    var slashYmd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.exec(raw);
    if (slashYmd) {
      return slashYmd[1] + '-' + String(Number(slashYmd[2])).padStart(2, '0') + '-' + String(Number(slashYmd[3])).padStart(2, '0');
    }
    return formatDisplayDate(raw) || '';
  }

  function normalizeImportHeaderName(h) {
    return convertEasternDigitsToAscii(String(h || ''))
      .trim()
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\s_\-#().\/]+/g, '');
  }

  var EXCEL_IMPORT_HEADER_MAP = (function () {
    var specs = {
      reservationNumber: ['رقم الحجز', 'رقم العقد', 'reservationNumber', 'reservation_number', 'Reservation #', 'Reservation No', 'Booking #', 'Booking Number', 'Res No', 'المرجع'],
      customerName: ['اسم العميل', 'العميل', 'customerName', 'customer_name', 'Customer Name', 'Customer', 'Client Name', 'Client'],
      customerPhone: ['الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف', 'customerPhone', 'customer_phone', 'Phone', 'Mobile', 'Client Mobile', 'Phone Number'],
      customerEmail: ['البريد الإلكتروني', 'البريد الالكتروني', 'الإيميل', 'الايميل', 'customerEmail', 'customer_email', 'Email'],
      customerIdNumber: ['رقم الهوية', 'الهوية', 'رقم الهوية الوطنية', 'customerIdNumber', 'customer_id_number', 'ID Number', 'National ID'],
      companyName: ['الشركة', 'اسم الشركة', 'شركة التأجير', 'companyName', 'company_name', 'Company', 'Company Name'],
      branchName: ['الفرع', 'فرع الاستلام', 'branchName', 'branch_name', 'Branch', 'Pickup Branch'],
      deliverBranchName: ['فرع التسليم', 'deliverBranchName', 'deliver_branch_name', 'Return Branch', 'Deliver Branch'],
      carName: ['السيارة', 'اسم السيارة', 'المركبة', 'carName', 'car_name', 'Vehicle', 'Car', 'Car Name'],
      plateNumber: ['اللوحة', 'رقم اللوحة', 'plateNumber', 'plate_number', 'Plate', 'Plate Number'],
      carCategory: ['الفئة', 'فئة السيارة', 'carCategory', 'car_category', 'Category', 'Car Category'],
      startDate: ['بداية الحجز', 'تاريخ البداية', 'تاريخ الاستلام', 'startDate', 'start_date', 'Start Date', 'Pickup Date'],
      startTime: ['وقت البداية', 'وقت الاستلام', 'startTime', 'start_time', 'Start Time'],
      endDate: ['نهاية الحجز', 'تاريخ النهاية', 'تاريخ التسليم', 'endDate', 'end_date', 'End Date', 'Return Date'],
      endTime: ['وقت النهاية', 'وقت التسليم', 'endTime', 'end_time', 'End Time'],
      extendedUntilDate: ['التمديد لحد', 'تاريخ التمديد', 'نهاية التمديد', 'extendedUntilDate', 'extended_until_date', 'Extended Until'],
      extensionsCount: ['مرات التمديد', 'عدد التمديدات', 'extensionsCount', 'extensions_count', 'Extensions #', 'Extensions Count'],
      extensionsAmount: ['سعر التمديد', 'مبلغ التمديد', 'قيمة التمديد', 'extensionsAmount', 'extensions_amount', 'Ext. Amount', 'Extensions Amount'],
      daysCount: ['الأيام', 'عدد الأيام', 'daysCount', 'days_count', 'Days', 'Days Count'],
      dailyPrice: ['السعر اليومي', 'الإيجار اليومي', 'dailyPrice', 'daily_price', 'Daily Price'],
      discountAmount: ['الخصم', 'مبلغ الخصم', 'discountAmount', 'discount_amount', 'Discount'],
      vatAmount: ['الضريبة', 'ضريبة القيمة المضافة', 'vatAmount', 'vat_amount', 'VAT', 'Tax'],
      baseAmount: ['المبلغ الأساسي', 'السعر الأساسي', 'baseAmount', 'base_amount', 'Base Amount'],
      totalAmount: ['الإجمالي', 'المبلغ الإجمالي', 'إجمالي المبلغ', 'totalAmount', 'total_amount', 'Total (SAR)', 'Total', 'Total Amount'],
      originalStatusAr: ['حالة الحجز الأصلية', 'الحالة الأصلية', 'originalStatusAr', 'original_status_ar', 'Original Status'],
      internalStatus: ['حالة المتابعة الداخلية', 'المتابعة الداخلية', 'الحالة', 'حالة الحجز', 'internalStatus', 'internal_status', 'Internal Status', 'Status'],
      priority: ['الأولوية', 'الاولوية', 'priority', 'Priority'],
      paymentMethod: ['طريقة الدفع', 'paymentMethod', 'payment_method', 'Payment Method'],
      paymentStatus: ['حالة الدفع', 'paymentStatus', 'payment_status', 'Payment Status'],
      lastUpdateText: ['آخر تحديث', 'ملاحظات', 'الوصف', 'lastUpdateText', 'last_update_text', 'Last Update', 'Notes']
    };
    var map = {};
    Object.keys(specs).forEach(function (fieldKey) {
      specs[fieldKey].forEach(function (alias) {
        map[normalizeImportHeaderName(alias)] = fieldKey;
      });
    });
    return map;
  })();

  function parseImportedReservationRows(rawRows, existingReservations, actor) {
    var rows = Array.isArray(rawRows) ? rawRows : [];
    var existingList = Array.isArray(existingReservations) ? existingReservations : [];
    var existingByNumber = {};
    for (var e = 0; e < existingList.length; e++) {
      var ex = existingList[e];
      if (ex && ex.reservationNumber) {
        existingByNumber[String(ex.reservationNumber).trim().toLowerCase()] = ex;
      }
    }

    var nowIso = new Date().toISOString();
    var actorId = normalizeStr(actor && actor.id) || 'SYSTEM';
    var actorName = normalizeStr(actor && actor.name) || 'النظام';
    var seenBatchNums = {};
    var validRows = [];
    var errors = [];
    var skippedRows = 0;
    var newCount = 0;
    var updateCount = 0;

    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i];
      if (!raw || typeof raw !== 'object') {
        skippedRows += 1;
        continue;
      }

      var mapped = {};
      var keys = Object.keys(raw);
      for (var k = 0; k < keys.length; k++) {
        var rawKey = keys[k];
        var canonField = EXCEL_IMPORT_HEADER_MAP[normalizeImportHeaderName(rawKey)];
        if (canonField && raw[rawKey] !== undefined && raw[rawKey] !== null && String(raw[rawKey]).trim() !== '') {
          mapped[canonField] = raw[rawKey];
        }
      }

      var customerName = normalizeStr(mapped.customerName);
      var resNum = convertEasternDigitsToAscii(normalizeStr(mapped.reservationNumber));
      var carName = normalizeStr(mapped.carName);
      var startDate = normalizeExcelCellDate(mapped.startDate);
      var endDate = normalizeExcelCellDate(mapped.endDate);
      var extUntilDate = normalizeExcelCellDate(mapped.extendedUntilDate);

      if (!resNum && !customerName && !carName && !startDate) {
        skippedRows += 1;
        continue;
      }
      if (!customerName && !resNum) {
        skippedRows += 1;
        errors.push({ rowIndex: i + 2, reason: 'الصف يفتقد اسم العميل ورقم الحجز.' });
        continue;
      }

      if (!resNum) {
        resNum = 'RG-XLS-' + nowIso.slice(0, 10).replace(/-/g, '') + '-' + String(i + 1).padStart(3, '0');
      }

      var dedupeKey = resNum.toLowerCase();
      var existing = existingByNumber[dedupeKey] || null;
      var effectiveStart = startDate || (existing && existing.startDate) || nowIso.slice(0, 10);
      var effectiveEnd = endDate || (existing && existing.endDate) || effectiveStart;
      var effectiveExtUntil = extUntilDate || (existing && existing.extendedUntilDate) || effectiveEnd;

      var daysCount = Math.max(1, Math.round(toNum(mapped.daysCount, 0)));
      if (mapped.daysCount === undefined && effectiveStart && effectiveEnd) {
        var sMs = Date.parse(effectiveStart + 'T00:00:00Z');
        var eMs = Date.parse(effectiveEnd + 'T00:00:00Z');
        if (!isNaN(sMs) && !isNaN(eMs) && eMs >= sMs) {
          daysCount = Math.max(1, Math.round((eMs - sMs) / 86400000) || 1);
        }
      }

      var extCount = Math.max(0, Math.round(toNum(mapped.extensionsCount, existing ? existing.extensionsCount : 0)));
      var extAmount = Math.max(0, Math.round(toNum(mapped.extensionsAmount, existing ? existing.extensionsAmount : 0) * 100) / 100);
      var dailyPrice = Math.max(0, Math.round(toNum(mapped.dailyPrice, existing ? existing.dailyPrice : 0) * 100) / 100);
      var discountAmount = Math.max(0, Math.round(toNum(mapped.discountAmount, existing ? existing.discountAmount : 0) * 100) / 100);
      var vatAmount = Math.max(0, Math.round(toNum(mapped.vatAmount, existing ? existing.vatAmount : 0) * 100) / 100);
      var totalRaw = mapped.totalAmount !== undefined ? toNum(mapped.totalAmount, 0) : (existing ? toNum(existing.totalAmount, 0) : 0);
      var baseAmount = mapped.baseAmount !== undefined
        ? Math.max(0, Math.round(toNum(mapped.baseAmount, 0) * 100) / 100)
        : Math.max(0, Math.round((totalRaw - extAmount) * 100) / 100);
      var totalAmount = totalRaw > 0
        ? Math.round(totalRaw * 100) / 100
        : Math.round((baseAmount + extAmount) * 100) / 100;

      var rawInternal = normalizeStr(mapped.internalStatus);
      var internalStatus = isValidWorkflowStatus(rawInternal)
        ? rawInternal
        : (existing ? normalizeStr(existing.internalStatus) : 'جديد');
      var rawOrig = normalizeStr(mapped.originalStatusAr);
      var originalStatusAr = (rawOrig && rawOrig !== '-')
        ? rawOrig
        : (existing ? normalizeStr(existing.originalStatusAr) : internalStatus);
      var rawPrio = normalizeStr(mapped.priority);
      var priority = PROBLEM_PRIORITIES.indexOf(rawPrio) !== -1
        ? rawPrio
        : (existing ? normalizeStr(existing.priority, 'عادي') : 'عادي');

      var cleanPhone = convertEasternDigitsToAscii(normalizeStr(mapped.customerPhone));
      if (cleanPhone === '-') cleanPhone = '';
      if (!cleanPhone && existing) cleanPhone = normalizeStr(existing.customerPhone);

      var cleanNote = normalizeStr(mapped.lastUpdateText);
      if (cleanNote === '-') cleanNote = '';

      var rec = {
        id: existing ? existing.id : ('RES_IMP_' + Date.now().toString(36).toUpperCase() + '_' + String(i + 1)),
        sourceReservationId: existing ? normalizeStr(existing.sourceReservationId) : '',
        reservationNumber: resNum,
        sourceCreatedAt: existing ? normalizeStr(existing.sourceCreatedAt) : (effectiveStart + 'T09:00:00Z'),
        customerName: customerName || (existing && existing.customerName) || 'عميل مستورد',
        customerPhone: cleanPhone,
        customerEmail: normalizeStr(mapped.customerEmail) !== '-' ? (normalizeStr(mapped.customerEmail) || (existing && existing.customerEmail) || '') : '',
        customerIdNumber: normalizeStr(mapped.customerIdNumber) !== '-' ? (normalizeStr(mapped.customerIdNumber) || (existing && existing.customerIdNumber) || '') : '',
        companyName: normalizeStr(mapped.companyName) !== '-' ? (normalizeStr(mapped.companyName) || (existing && existing.companyName) || 'مستورد من Excel') : 'مستورد من Excel',
        branchName: normalizeStr(mapped.branchName) !== '-' ? (normalizeStr(mapped.branchName) || (existing && existing.branchName) || 'الفرع الرئيسي') : 'الفرع الرئيسي',
        deliverBranchName: normalizeStr(mapped.deliverBranchName) !== '-' ? (normalizeStr(mapped.deliverBranchName) || (existing && existing.deliverBranchName) || normalizeStr(mapped.branchName) || 'الفرع الرئيسي') : 'الفرع الرئيسي',
        carName: (carName && carName !== '-') ? carName : ((existing && existing.carName) || 'غير محدد'),
        plateNumber: normalizeStr(mapped.plateNumber) !== '-' ? (normalizeStr(mapped.plateNumber) || (existing && existing.plateNumber) || '') : '',
        carCategory: normalizeStr(mapped.carCategory) !== '-' ? (normalizeStr(mapped.carCategory) || (existing && existing.carCategory) || '') : '',
        startDate: effectiveStart,
        startTime: normalizeStr(mapped.startTime) || (existing && existing.startTime) || '10:00',
        originalEndDate: existing ? normalizeStr(existing.originalEndDate || effectiveEnd) : effectiveEnd,
        originalEndTime: (existing && existing.originalEndTime) || normalizeStr(mapped.endTime) || '10:00',
        endDate: effectiveEnd,
        endTime: normalizeStr(mapped.endTime) || (existing && existing.endTime) || '10:00',
        extendedUntilDate: effectiveExtUntil,
        extendedUntilTime: (existing && existing.extendedUntilTime) || normalizeStr(mapped.endTime) || '10:00',
        daysCount: daysCount,
        extendedDaysCount: existing ? Number(existing.extendedDaysCount || 0) : 0,
        totalDaysCount: daysCount + (existing ? Number(existing.extendedDaysCount || 0) : 0),
        originalStatusCode: (existing && existing.originalStatusCode) || 'excel_import',
        originalStatusAr: originalStatusAr,
        pickupTypeAr: (existing && existing.pickupTypeAr) || 'الفرع',
        returnTypeAr: (existing && existing.returnTypeAr) || 'الفرع',
        paymentMethod: normalizeStr(mapped.paymentMethod) !== '-' ? (normalizeStr(mapped.paymentMethod) || (existing && existing.paymentMethod) || '') : '',
        paymentStatus: normalizeStr(mapped.paymentStatus) !== '-' ? (normalizeStr(mapped.paymentStatus) || (existing && existing.paymentStatus) || '') : '',
        dailyPrice: dailyPrice,
        discountAmount: discountAmount,
        vatAmount: vatAmount,
        baseAmount: baseAmount,
        extensionsCount: extCount,
        extensionsAmount: extAmount,
        totalAmount: totalAmount,
        hasExtensions: extCount > 0 || extAmount > 0 || (effectiveExtUntil > effectiveEnd),
        internalStatus: internalStatus,
        priority: priority,
        assignedEmployeeIds: existing && Array.isArray(existing.assignedEmployeeIds) ? existing.assignedEmployeeIds.slice() : [],
        assignedEmployeeNames: existing && Array.isArray(existing.assignedEmployeeNames) ? existing.assignedEmployeeNames.slice() : [],
        lastUpdateText: cleanNote || (existing ? normalizeStr(existing.lastUpdateText) : ('تم الاستيراد من ملف Excel بواسطة ' + actorName)),
        lastUpdatedById: actorId,
        lastUpdatedByName: actorName,
        lastUpdatedAt: nowIso,
        statusHistory: existing && Array.isArray(existing.statusHistory) && existing.statusHistory.length
          ? existing.statusHistory.slice()
          : [{ status: internalStatus, originalStatusAr: originalStatusAr, source: 'excel_import', updatedById: actorId, updatedByName: actorName, at: nowIso }],
        hasProblem: existing ? Boolean(existing.hasProblem) : false,
        pinnedNote: existing ? normalizeStr(existing.pinnedNote) : '',
        pinnedNoteBy: existing ? normalizeStr(existing.pinnedNoteBy) : '',
        pinnedNoteAt: existing ? normalizeStr(existing.pinnedNoteAt) : '',
        noAnswerCount: existing ? Number(existing.noAnswerCount || 0) : 0,
        createdAt: existing ? normalizeStr(existing.createdAt || nowIso) : nowIso,
        updatedAt: nowIso,
        _isUpdate: Boolean(existing || seenBatchNums[dedupeKey])
      };

      if (rec._isUpdate) updateCount += 1;
      else newCount += 1;
      seenBatchNums[dedupeKey] = true;
      existingByNumber[dedupeKey] = rec;
      validRows.push(rec);
    }

    return {
      totalRead: rows.length,
      validRows: validRows,
      skippedRows: skippedRows,
      newCount: newCount,
      updateCount: updateCount,
      errors: errors
    };
  }

  // ---------- TIME RANGE, OVERDUE TRACKER, DELEGATION, AUDIT DIFF, ICS, WRAP-UP ----------

  function isTimeInRange(timeStr, timeFrom, timeTo) {
    var fromClean = normalizeTimeHHmm(timeFrom, '');
    var toClean = normalizeTimeHHmm(timeTo, '');
    if (!fromClean && !toClean) return true;
    var valMins = parseMinutesOfDay(timeStr);
    if (valMins === null) return false;
    var fromMins = fromClean ? parseMinutesOfDay(fromClean) : 0;
    var toMins = toClean ? parseMinutesOfDay(toClean) : 1439;
    if (fromMins === null) fromMins = 0;
    if (toMins === null) toMins = 1439;
    if (fromMins <= toMins) {
      return valMins >= fromMins && valMins <= toMins;
    }
    return valMins >= fromMins || valMins <= toMins;
  }

  function formatOverdueDurationLabel(overdueMinutes, lang) {
    var mins = Math.max(0, Math.round(Number(overdueMinutes || 0)));
    var hrs = Math.floor(mins / 60);
    var rem = mins % 60;
    if (lang === 'en') {
      if (hrs >= 24) {
        var d = Math.floor(hrs / 24);
        var rh = hrs % 24;
        return 'Overdue ' + d + 'd' + (rh ? (' ' + rh + 'h') : '');
      }
      if (hrs > 0) return 'Overdue ' + hrs + 'h ' + (rem ? rem + 'm' : '');
      return 'Overdue ' + mins + 'm';
    }
    if (hrs >= 24) {
      var days = Math.floor(hrs / 24);
      var remH = hrs % 24;
      return 'متأخر ' + days + ' ي' + (remH ? (' ' + remH + ' س') : '');
    }
    if (hrs > 0) return 'متأخر ' + hrs + ' س' + (rem ? (' ' + rem + ' د') : '');
    return 'متأخر ' + mins + ' د';
  }

  function isReservationOverdueUnpaid(reservation, extensions, nowMs) {
    var r = (reservation && typeof reservation === 'object') ? reservation : {};
    var empty = {
      isOverdueUnpaid: false,
      overdueMinutes: 0,
      effectiveEndDate: '',
      effectiveEndTime: '',
      labelAr: '',
      labelEn: ''
    };
    if (!r.id && !r.reservationNumber) return empty;
    if (isReservationClosedStatus(r) || isExcludedMovementStatus(r)) return empty;

    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var extList = Array.isArray(extensions) ? extensions : (Array.isArray(r.extensions) ? r.extensions : []);
    var hasPaidExtensionCoveringNow = false;

    for (var i = 0; i < extList.length; i++) {
      var ex = extList[i];
      if (!ex || !isExtensionAcceptedAndPaid(ex)) continue;
      var exEndD = formatDisplayDate(ex.endDate || ex.newEndDate || ex.actualEndDate);
      var exEndT = normalizeTimeHHmm(ex.endTime || r.endTime, '23:59');
      var exEndMs = exEndD ? parseReservationEndTimestampMs(exEndD, exEndT) : null;
      if (exEndMs !== null && exEndMs >= now) {
        hasPaidExtensionCoveringNow = true;
        break;
      }
    }

    if (r.isAcceptedAndPaid === true) {
      var effAlt = resolveReservationEffectiveEnd(r);
      if (effAlt.timestampMs !== null && effAlt.timestampMs >= now) {
        hasPaidExtensionCoveringNow = true;
      }
    }

    if (hasPaidExtensionCoveringNow) return empty;

    var eff = resolveReservationEffectiveEnd(r);
    if (eff.timestampMs === null || !isFinite(eff.timestampMs)) return empty;

    var hasExplicitUnpaidExt = extList.some(function (ex) { return ex && !isExtensionAcceptedAndPaid(ex); }) || r.isAcceptedAndPaid === false;
    var checkTs = eff.timestampMs;
    if (hasExplicitUnpaidExt && r.endDate) {
      var baseEndMs = parseReservationEndTimestampMs(formatDisplayDate(r.endDate), normalizeTimeHHmm(r.endTime, '23:59'));
      if (baseEndMs !== null && baseEndMs < checkTs) {
        checkTs = baseEndMs;
      }
    }

    if (checkTs >= now) return empty;
    var overdueMinutes = Math.max(1, Math.round((now - checkTs) / 60000));
    return {
      isOverdueUnpaid: true,
      overdueMinutes: overdueMinutes,
      effectiveEndDate: eff.date,
      effectiveEndTime: eff.time,
      labelAr: formatOverdueDurationLabel(overdueMinutes, 'ar'),
      labelEn: formatOverdueDurationLabel(overdueMinutes, 'en')
    };
  }

  function isDelegationActive(delegation, nowMs) {
    if (!delegation || typeof delegation !== 'object') return false;
    var status = normalizeStr(delegation.status || 'active').toLowerCase();
    if (status === 'revoked' || normalizeStr(delegation.revokedAt)) return false;
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var startMs = parseTimestampLooseMs(delegation.startsAt);
    var endMs = parseTimestampLooseMs(delegation.expiresAt);
    if (endMs === null) return false;
    if (startMs !== null && now < startMs) return false;
    return now < endMs;
  }

  function applyActiveDelegationsToUser(user, delegations, nowMs) {
    if (!user || typeof user !== 'object') return user;
    var list = Array.isArray(delegations) ? delegations : [];
    var userId = normalizeStr(user.id || user.employeeId);
    var baseRole = normalizeStr(user.baseRole || user.role) || ROLES.AGENT;
    var basePerms = Array.isArray(user.basePermissions)
      ? user.basePermissions.slice()
      : (Array.isArray(user.permissions) ? user.permissions.slice() : []);

    var activeDel = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue;
      if (normalizeStr(d.delegateEmployeeId) === userId && isDelegationActive(d, nowMs)) {
        activeDel = d;
        break;
      }
    }

    if (!activeDel || baseRole === ROLES.GENERAL_MANAGER || baseRole === ROLES.DEVELOPER) {
      return Object.assign({}, user, {
        role: baseRole,
        baseRole: baseRole,
        permissions: resolveEffectivePermissions({ role: baseRole, permissions: basePerms }),
        activeDelegation: null
      });
    }

    var targetRole = normalizeStr(activeDel.delegatedRole).toLowerCase() === ROLES.SUPERVISOR
      ? ROLES.SUPERVISOR
      : ROLES.SUPERVISOR;
    var mergedPerms = resolveEffectivePermissions({ role: targetRole, permissions: basePerms });
    var supDefaults = ROLE_PERMISSION_MATRIX[targetRole] || [];
    for (var j = 0; j < supDefaults.length; j++) {
      if (mergedPerms.indexOf(supDefaults[j]) === -1) {
        mergedPerms.push(supDefaults[j]);
      }
    }

    return Object.assign({}, user, {
      baseRole: baseRole,
      basePermissions: basePerms,
      role: targetRole,
      permissions: mergedPerms,
      activeDelegation: {
        id: normalizeStr(activeDel.id),
        delegateEmployeeId: userId,
        delegateEmployeeName: normalizeStr(activeDel.delegateEmployeeName || user.name),
        delegatedRole: targetRole,
        grantedById: normalizeStr(activeDel.grantedById),
        grantedByName: normalizeStr(activeDel.grantedByName),
        startsAt: normalizeStr(activeDel.startsAt),
        expiresAt: normalizeStr(activeDel.expiresAt),
        reason: normalizeStr(activeDel.reason)
      }
    });
  }

  function formatAuditDiffValue(val) {
    if (val === undefined || val === null || val === '') return '-';
    if (Array.isArray(val)) return val.length ? val.join('، ') : '-';
    if (typeof val === 'boolean') return val ? 'نعم' : 'لا';
    return String(val);
  }

  function computeAuditFieldDiffs(beforeObj, afterObj, fieldDefs) {
    var b = (beforeObj && typeof beforeObj === 'object') ? beforeObj : {};
    var a = (afterObj && typeof afterObj === 'object') ? afterObj : {};
    var defs = Array.isArray(fieldDefs) ? fieldDefs : [];
    var diffs = [];
    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (!def || !def.field) continue;
      var beforeVal = formatAuditDiffValue(b[def.field]);
      var afterVal = formatAuditDiffValue(a[def.field]);
      if (beforeVal !== afterVal) {
        diffs.push({
          field: def.field,
          label: normalizeStr(def.label || def.labelAr || def.field),
          before: beforeVal,
          after: afterVal
        });
      }
    }
    return diffs;
  }

  function formatIcsUtcStamp(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) d = new Date();
    return d.getUTCFullYear() +
      padTwoDigits(d.getUTCMonth() + 1) +
      padTwoDigits(d.getUTCDate()) + 'T' +
      padTwoDigits(d.getUTCHours()) +
      padTwoDigits(d.getUTCMinutes()) +
      padTwoDigits(d.getUTCSeconds()) + 'Z';
  }

  function formatIcsDateTimeUtc(dateStr, timeStr, tzOffsetHours) {
    var parsed = parseIsoDateStrict(dateStr);
    if (!parsed) return '';
    var hm = normalizeTimeHHmm(timeStr, '09:00').split(':');
    var hh = parseInt(hm[0], 10) || 9;
    var mm = parseInt(hm[1], 10) || 0;
    var offset = (typeof tzOffsetHours === 'number' && isFinite(tzOffsetHours)) ? tzOffsetHours : 3;
    var utcMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hh - offset, mm, 0);
    return formatIcsUtcStamp(utcMs);
  }

  function escapeIcsText(val) {
    return normalizeStr(val)
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function buildIcsCalendarContent(events, calName) {
    var evs = Array.isArray(events) ? events : [];
    var nowStamp = formatIcsUtcStamp(Date.now());
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Rental Gate CRM//Shift & Operations//AR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapeIcsText(calName || 'Rental Gate CRM')
    ];

    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (!ev || !ev.startDate) continue;
      var dtStart = formatIcsDateTimeUtc(ev.startDate, ev.startTime || '09:00', 3);
      if (!dtStart) continue;
      var endDateStr = ev.endDate || ev.startDate;
      var endTimeStr = ev.endTime || '';
      var dtEnd = '';
      if (endTimeStr) {
        dtEnd = formatIcsDateTimeUtc(endDateStr, endTimeStr, 3);
      } else {
        var parsedStart = parseIsoDateStrict(ev.startDate);
        var hm = normalizeTimeHHmm(ev.startTime, '09:00').split(':');
        var endMs = Date.UTC(parsedStart.year, parsedStart.month - 1, parsedStart.day, (parseInt(hm[0], 10) || 9) - 3 + 1, parseInt(hm[1], 10) || 0, 0);
        dtEnd = formatIcsUtcStamp(endMs);
      }
      var uid = escapeIcsText(ev.uid || ('rg-' + (i + 1) + '-' + dtStart + '@rentalgate.crm'));
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + nowStamp);
      lines.push('DTSTART:' + dtStart);
      if (dtEnd) lines.push('DTEND:' + dtEnd);
      lines.push('SUMMARY:' + escapeIcsText(ev.summary || 'Rental Gate Task'));
      if (ev.description) lines.push('DESCRIPTION:' + escapeIcsText(ev.description));
      if (ev.location) lines.push('LOCATION:' + escapeIcsText(ev.location));
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function buildReservationIcsEvents(reservation, lang) {
    var r = (reservation && typeof reservation === 'object') ? reservation : {};
    var isEn = lang === 'en';
    var resNum = normalizeStr(r.reservationNumber || r.id) || 'BOOKING';
    var cust = normalizeStr(r.customerName) || (isEn ? 'Customer' : 'عميل');
    var phone = normalizeStr(r.customerPhone);
    var car = normalizeStr(r.carName) || '-';
    var plate = normalizeStr(r.plateNumber);
    var loc = [normalizeStr(r.companyName), normalizeStr(r.branchName)].filter(Boolean).join(' — ');
    var desc = (isEn ? 'Customer: ' : 'العميل: ') + cust +
      (phone ? (' | ' + phone) : '') +
      '\n' + (isEn ? 'Vehicle: ' : 'السيارة: ') + car + (plate ? (' (' + plate + ')') : '') +
      '\n' + (isEn ? 'Status: ' : 'الحالة: ') + (r.internalStatus || r.originalStatusAr || '-');

    var events = [];
    var sDate = formatDisplayDate(r.startDate);
    if (sDate) {
      events.push({
        uid: 'rg-pickup-' + resNum + '-' + sDate + '@rentalgate.crm',
        startDate: sDate,
        startTime: normalizeTimeHHmm(r.startTime, '09:00'),
        summary: (isEn ? 'Pickup #' : 'تسليم حجز #') + resNum + ' — ' + cust,
        description: desc,
        location: loc
      });
    }
    var eff = resolveReservationEffectiveEnd(r);
    if (eff.date) {
      events.push({
        uid: 'rg-return-' + resNum + '-' + eff.date + '@rentalgate.crm',
        startDate: eff.date,
        startTime: normalizeTimeHHmm(eff.time, '12:00'),
        summary: (isEn ? 'Return #' : 'استلام / نهاية حجز #') + resNum + ' — ' + cust,
        description: desc,
        location: normalizeStr(r.deliverBranchName) || loc
      });
    }
    return events;
  }

  function buildTodayScheduleIcsEvents(movementsSummary, lang) {
    var isEn = lang === 'en';
    var items = (movementsSummary && Array.isArray(movementsSummary.items)) ? movementsSummary.items : [];
    return items.map(function (it, idx) {
      var r = it.reservation || {};
      var resNum = normalizeStr(r.reservationNumber || r.id) || String(idx + 1);
      var cust = normalizeStr(r.customerName) || '-';
      var kindLabel = it.movementType === 'pickup'
        ? (isEn ? 'Pickup' : 'تسليم')
        : (isEn ? 'Return' : 'استلام');
      return {
        uid: 'rg-today-' + it.movementType + '-' + resNum + '-' + it.scheduledDate + '@rentalgate.crm',
        startDate: it.scheduledDate,
        startTime: it.scheduledTime || '09:00',
        summary: '[' + kindLabel + '] #' + resNum + ' — ' + cust,
        description: (r.carName || '-') + (r.customerPhone ? (' | ' + r.customerPhone) : '') + ' | ' + (r.internalStatus || '-'),
        location: [r.companyName, it.movementType === 'return' ? (r.deliverBranchName || r.branchName) : r.branchName].filter(Boolean).join(' — ')
      };
    });
  }

  var DEFAULT_CALL_WRAPUP_OUTCOMES = [
    {
      key: 'confirmed',
      labelAr: 'تم الرد وتأكيد الحجز',
      labelEn: 'Answered & Confirmed',
      suggestedStatus: 'تم الحجز',
      actionTextAr: 'نتيجة المكالمة: تم الرد وتأكيد الحجز',
      isNoAnswer: false,
      variant: 'primary'
    },
    {
      key: 'no_answer',
      labelAr: 'لم يرد',
      labelEn: 'No Answer',
      suggestedStatus: '',
      actionTextAr: 'محاولة اتصال — لم يرد',
      isNoAnswer: true,
      variant: 'danger'
    },
    {
      key: 'extending_24h',
      labelAr: 'بيمدد خلال 24 ساعة القادمة',
      labelEn: 'Extending Within 24 Hours',
      suggestedStatus: 'تم التمديد',
      actionTextAr: 'نتيجة المكالمة: العميل بيمدد خلال 24 ساعة القادمة',
      isNoAnswer: false,
      variant: 'primary'
    },
    {
      key: 'returning_on_time',
      labelAr: 'ما بيمدد وبيسلم في الموعد',
      labelEn: 'Not Extending — Returning On Time',
      suggestedStatus: 'نشط الآن',
      actionTextAr: 'نتيجة المكالمة: العميل ما بيمدد وبيسلم في الموعد',
      isNoAnswer: false,
      variant: 'neutral'
    },
    {
      key: 'callback_later',
      labelAr: 'إعادة الاتصال لاحقاً',
      labelEn: 'Call Back Later',
      suggestedStatus: '',
      actionTextAr: 'نتيجة المكالمة: طلب إعادة الاتصال لاحقاً',
      isNoAnswer: false,
      variant: 'neutral'
    }
  ];

  var CALL_WRAPUP_OUTCOMES = DEFAULT_CALL_WRAPUP_OUTCOMES.slice();

  function cloneCallWrapupOutcomeItem(item) {
    var src = (item && typeof item === 'object') ? item : {};
    var labelAr = normalizeStr(src.labelAr).slice(0, 80);
    var labelEn = normalizeStr(src.labelEn).slice(0, 80) || labelAr;
    var rawStatus = normalizeStr(src.suggestedStatus);
    var suggestedStatus = rawStatus && isValidWorkflowStatus(rawStatus) ? rawStatus : '';
    var isNoAnswer = Boolean(src.isNoAnswer);
    var variant = normalizeStr(src.variant).toLowerCase();
    if (variant !== 'primary' && variant !== 'danger' && variant !== 'neutral') {
      variant = isNoAnswer ? 'danger' : 'neutral';
    }
    var rawKey = normalizeStr(src.key)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!rawKey) {
      rawKey = 'sc_' + Math.random().toString(36).slice(2, 8);
    }
    var actionTextAr = normalizeStr(src.actionTextAr).slice(0, 140) || ('نتيجة المكالمة: ' + labelAr);
    return {
      key: rawKey,
      labelAr: labelAr,
      labelEn: labelEn,
      suggestedStatus: isNoAnswer ? '' : suggestedStatus,
      actionTextAr: actionTextAr,
      isNoAnswer: isNoAnswer,
      variant: variant
    };
  }

  function normalizeCallWrapupShortcutsConfig(raw) {
    var input = raw;
    if (typeof input === 'string') {
      var trimmed = input.trim();
      if (!trimmed) {
        input = null;
      } else {
        try {
          input = JSON.parse(trimmed);
        } catch (_eParse) {
          input = null;
        }
      }
    }

    var defaultItems = DEFAULT_CALL_WRAPUP_OUTCOMES.map(cloneCallWrapupOutcomeItem);
    if (!input || typeof input !== 'object') {
      return {
        items: defaultItems,
        customized: false,
        updatedAt: '',
        updatedBy: ''
      };
    }

    var rawItems = null;
    var customized = false;
    var updatedAt = '';
    var updatedBy = '';

    if (Array.isArray(input)) {
      rawItems = input;
      customized = true;
    } else {
      updatedAt = normalizeStr(input.updatedAt);
      updatedBy = normalizeStr(input.updatedBy);
      if (input.customized === true) {
        customized = true;
        rawItems = Array.isArray(input.items) ? input.items : [];
      } else if (Array.isArray(input.items) && input.customized !== false) {
        customized = true;
        rawItems = input.items;
      } else {
        return {
          items: defaultItems,
          customized: false,
          updatedAt: updatedAt,
          updatedBy: updatedBy
        };
      }
    }

    var seenKeys = {};
    var cleanItems = [];
    for (var i = 0; i < rawItems.length && cleanItems.length < 20; i++) {
      var row = rawItems[i];
      if (!row || typeof row !== 'object') continue;
      if (!normalizeStr(row.labelAr)) continue;
      var normItem = cloneCallWrapupOutcomeItem(row);
      if (seenKeys[normItem.key]) {
        normItem.key = normItem.key.slice(0, 32) + '_' + (cleanItems.length + 1);
      }
      seenKeys[normItem.key] = true;
      cleanItems.push(normItem);
    }

    return {
      items: cleanItems,
      customized: customized,
      updatedAt: updatedAt,
      updatedBy: updatedBy
    };
  }

  function getActiveCallWrapupShortcuts(rawConfig) {
    return normalizeCallWrapupShortcutsConfig(rawConfig).items;
  }

  function upsertCallWrapupShortcut(rawConfig, shortcutInput) {
    var cfg = normalizeCallWrapupShortcutsConfig(rawConfig);
    var src = (shortcutInput && typeof shortcutInput === 'object') ? shortcutInput : {};
    var labelAr = normalizeStr(src.labelAr).slice(0, 80);
    if (!labelAr) {
      throw new Error('VALIDATION_ERROR: اسم الاختصار بالعربية مطلوب.');
    }
    var baseList = cfg.items.slice();
    var targetKey = normalizeStr(src.key);
    var existingIdx = -1;
    if (targetKey) {
      for (var i = 0; i < baseList.length; i++) {
        if (baseList[i].key === targetKey) {
          existingIdx = i;
          break;
        }
      }
    }
    var nextItem = cloneCallWrapupOutcomeItem(Object.assign({}, src, {
      key: existingIdx !== -1 ? targetKey : (src.key || ('custom_' + Date.now().toString(36)))
    }));
    if (existingIdx !== -1) {
      baseList[existingIdx] = nextItem;
    } else {
      if (baseList.some(function (x) { return x.key === nextItem.key; })) {
        nextItem.key = nextItem.key.slice(0, 32) + '_' + Math.random().toString(36).slice(2, 6);
      }
      baseList.push(nextItem);
    }
    return normalizeCallWrapupShortcutsConfig({
      items: baseList,
      customized: true,
      updatedAt: new Date().toISOString(),
      updatedBy: cfg.updatedBy
    });
  }

  function removeCallWrapupShortcut(rawConfig, key) {
    var cfg = normalizeCallWrapupShortcutsConfig(rawConfig);
    var targetKey = normalizeStr(key);
    var nextItems = cfg.items.filter(function (x) { return x && x.key !== targetKey; });
    return normalizeCallWrapupShortcutsConfig({
      items: nextItems,
      customized: true,
      updatedAt: new Date().toISOString(),
      updatedBy: cfg.updatedBy
    });
  }

  function resetCallWrapupShortcutsConfig() {
    return normalizeCallWrapupShortcutsConfig({
      items: DEFAULT_CALL_WRAPUP_OUTCOMES.map(cloneCallWrapupOutcomeItem),
      customized: false,
      updatedAt: new Date().toISOString(),
      updatedBy: ''
    });
  }

  function parseDeltaRecordTimestampMs(rec) {
    if (!rec || typeof rec !== 'object') return NaN;
    var raw = rec.updatedAt || rec.lastUpdatedAt || rec.createdAt || '';
    if (!raw) return NaN;
    var ms = Date.parse(String(raw));
    return isFinite(ms) ? ms : NaN;
  }

  function mergeDeltaRecords(existingList, changedList, idField) {
    var base = Array.isArray(existingList) ? existingList.slice() : [];
    var updates = Array.isArray(changedList) ? changedList : [];
    if (!updates.length) return base;
    var keyName = normalizeStr(idField) || 'id';
    var indexById = {};
    for (var i = 0; i < base.length; i++) {
      var rec = base[i];
      if (rec && rec[keyName] !== undefined && rec[keyName] !== null) {
        indexById[String(rec[keyName])] = i;
      }
    }
    var prepends = [];
    for (var j = 0; j < updates.length; j++) {
      var upd = updates[j];
      if (!upd || typeof upd !== 'object') continue;
      var k = (upd[keyName] !== undefined && upd[keyName] !== null) ? String(upd[keyName]) : '';
      if (k && indexById[k] !== undefined && indexById[k] >= 0) {
        var idx = indexById[k];
        var prevMs = parseDeltaRecordTimestampMs(base[idx]);
        var updMs = parseDeltaRecordTimestampMs(upd);
        if (!isNaN(prevMs) && !isNaN(updMs) && updMs < prevMs) {
          continue;
        }
        base[idx] = Object.assign({}, base[idx], upd);
      } else {
        if (k) indexById[k] = -1;
        prepends.push(upd);
      }
    }
    return prepends.length ? prepends.concat(base) : base;
  }

  function mergeRecordsMonotonic(existingList, changedList, idField) {
    return mergeDeltaRecords(existingList, changedList, idField);
  }

  function extractRadarCountsTuple(rc) {
    if (!rc || typeof rc !== 'object') return null;
    return [
      Number(rc.todayTotal || 0),
      Number(rc.pickupCount || 0),
      Number(rc.returnCount || 0),
      Number(rc.pendingPickupCount || 0),
      Number(rc.pendingReturnCount || 0),
      Number(rc.overdueTodayCount || 0),
      Number(rc.radarTotal || 0),
      Number(rc.upcoming24hCount || 0),
      Number(rc.critical6hCount || 0),
      Number(rc.soon24hCount || 0),
      Number(rc.expiredUnclosedCount || 0),
      Number(rc.extendedInRadarCount || 0),
      Number(rc.radarCount || 0),
      Number(rc.todayCount || 0),
      Number(rc.criticalCount || 0)
    ].join('|');
  }

  function hasMeaningfulDeltaChanges(delta, prevState) {
    var d = (delta && typeof delta === 'object') ? delta : {};
    if (
      (Array.isArray(d.changedReservations) && d.changedReservations.length > 0) ||
      (Array.isArray(d.deletedReservationIds) && d.deletedReservationIds.length > 0) ||
      (Array.isArray(d.changedFollowUps) && d.changedFollowUps.length > 0) ||
      (Array.isArray(d.deletedFollowUpIds) && d.deletedFollowUpIds.length > 0) ||
      (Array.isArray(d.changedProblems) && d.changedProblems.length > 0) ||
      (Array.isArray(d.deletedProblemIds) && d.deletedProblemIds.length > 0) ||
      (Array.isArray(d.changedEmployees) && d.changedEmployees.length > 0) ||
      (Array.isArray(d.deletedEmployeeIds) && d.deletedEmployeeIds.length > 0) ||
      (Array.isArray(d.deletedAnnouncementIds) && d.deletedAnnouncementIds.length > 0) ||
      Boolean(d.deletedAllReservationsBefore) ||
      Boolean(d.changedSettings) ||
      Boolean(d.changedDelegations) ||
      Boolean(d.changedRoles)
    ) {
      return true;
    }
    var prev = (prevState && typeof prevState === 'object') ? prevState : null;
    if (prev && prev.todayRadarCounts && d.todayRadarCounts) {
      if (extractRadarCountsTuple(prev.todayRadarCounts) !== extractRadarCountsTuple(d.todayRadarCounts)) {
        return true;
      }
    }
    if (prev && prev.announcementsFp !== undefined && Array.isArray(d.announcements)) {
      if (computeDataFingerprint(d.announcements) !== prev.announcementsFp) {
        return true;
      }
    }
    return false;
  }

  function haveDashboardSnapshotsChanged(prevDash, nextDash) {
    if (!prevDash || typeof prevDash !== 'object' || !prevDash.kpis) return true;
    if (!nextDash || typeof nextDash !== 'object' || !nextDash.kpis) return false;
    var norm = function (obj) {
      return {
        kpis: obj.kpis || {},
        charts: obj.charts || {},
        leaderboard: Array.isArray(obj.leaderboard)
          ? obj.leaderboard.map(function (r) {
              return r ? [r.id || r.employeeId || '', r.name || '', r.score || 0, r.followUpsCount || 0, r.completedCount || 0] : null;
            })
          : [],
        todayRadarCounts: extractRadarCountsTuple(obj.todayRadarCounts)
      };
    };
    return computeDataFingerprint(norm(prevDash)) !== computeDataFingerprint(norm(nextDash));
  }

  function resolveSwrSnapshot(prevValid, nextData, isValidFn) {
    var hasPrev = Boolean(prevValid && typeof prevValid === 'object');
    var validNext = Boolean(nextData && typeof nextData === 'object' && (!isValidFn || isValidFn(nextData)));
    if (!validNext) {
      return hasPrev ? prevValid : null;
    }
    if (!hasPrev) return nextData;
    var merged = Object.assign({}, prevValid, nextData);
    if (prevValid.kpis && typeof prevValid.kpis === 'object' && nextData.kpis && typeof nextData.kpis === 'object') {
      var safeKpis = Object.assign({}, prevValid.kpis);
      Object.keys(nextData.kpis).forEach(function (k) {
        var val = nextData.kpis[k];
        if (val !== null && val !== undefined && !(typeof val === 'number' && !isFinite(val))) {
          safeKpis[k] = val;
        }
      });
      merged.kpis = safeKpis;
    }
    if (prevValid.charts && typeof prevValid.charts === 'object' && (!nextData.charts || typeof nextData.charts !== 'object')) {
      merged.charts = prevValid.charts;
    }
    return merged;
  }

  function resolveAsyncViewState(opts) {
    var cfg = (opts && typeof opts === 'object') ? opts : {};
    var items = Array.isArray(cfg.items) ? cfg.items : [];
    var hasLoaded = Boolean(cfg.hasLoaded);
    var loading = Boolean(cfg.loading);
    var error = normalizeStr(cfg.error);
    if (loading && (!hasLoaded || items.length === 0)) {
      return 'loading';
    }
    if (items.length > 0) {
      return 'ready';
    }
    if (error) {
      return 'error';
    }
    return 'empty';
  }

  var CALENDAR_WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var CALENDAR_WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CALENDAR_MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var CALENDAR_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CALENDAR_MONTHS_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function addDaysIso(isoDate, deltaDays) {
    var clean = formatDisplayDate(isoDate);
    if (!clean) return '';
    var parts = clean.split('-');
    var dt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    if (isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + Math.trunc(Number(deltaDays) || 0));
    return dt.toISOString().substring(0, 10);
  }

  function buildCalendarDayMeta(iso, todayIso, isCurrentMonth) {
    var dParts = iso.split('-');
    var yr = parseInt(dParts[0], 10);
    var mo = parseInt(dParts[1], 10);
    var dy = parseInt(dParts[2], 10);
    var utcDt = new Date(Date.UTC(yr, mo - 1, dy));
    var wIdx = utcDt.getUTCDay();
    return {
      iso: iso,
      year: yr,
      month: mo,
      day: dy,
      weekdayIndex: wIdx,
      weekdayAr: CALENDAR_WEEKDAYS_AR[wIdx] || '',
      weekdayEn: CALENDAR_WEEKDAYS_EN[wIdx] || '',
      shortDateAr: dy + ' ' + (CALENDAR_MONTHS_AR[mo - 1] || ''),
      shortDateEn: (CALENDAR_MONTHS_EN[mo - 1] || '') + ' ' + dy,
      isToday: iso === todayIso,
      isCurrentMonth: isCurrentMonth !== false
    };
  }

  function buildCalendarPeriodWindow(anchorIso, granularity, options) {
    var opts = options || {};
    var gran = normalizeCalendarGranularity(granularity);
    var todayIso = formatDisplayDate(opts.todayIso) || getRiyadhTodayDateStr(opts.nowMs);
    var cleanAnchor = formatDisplayDate(anchorIso) || todayIso;
    var weekStartsOn = typeof opts.weekStartsOn === 'number' ? opts.weekStartsOn : 6; // Saturday default

    var weekdayHeaders = [];
    for (var wh = 0; wh < 7; wh++) {
      var wIdxH = (weekStartsOn + wh) % 7;
      weekdayHeaders.push({
        weekdayIndex: wIdxH,
        weekdayAr: CALENDAR_WEEKDAYS_AR[wIdxH] || '',
        weekdayEn: CALENDAR_WEEKDAYS_EN[wIdxH] || ''
      });
    }

    if (gran === 'month') {
      var mParts = cleanAnchor.split('-');
      var mYear = parseInt(mParts[0], 10);
      var mMonth = parseInt(mParts[1], 10);
      var gridCells = buildCalendarMonthGrid(mYear, mMonth, {
        weekStartsOn: weekStartsOn === 6 ? 6 : 0,
        todayIso: todayIso
      });
      var lastRowOutside = gridCells.length >= 42 && gridCells.slice(35, 42).every(function (c) { return !c.isCurrentMonth; });
      var trimmedCells = lastRowOutside ? gridCells.slice(0, 35) : gridCells;
      var monthDays = trimmedCells.map(function (c) {
        return buildCalendarDayMeta(c.iso, todayIso, c.isCurrentMonth);
      });
      var prevYM = shiftCalendarMonth(mYear, mMonth, -1);
      var nextYM = shiftCalendarMonth(mYear, mMonth, 1);
      var firstOfMonth = formatIsoDateParts(mYear, mMonth, 1);
      var lastOfMonth = formatIsoDateParts(mYear, mMonth, getDaysInMonth(mYear, mMonth));
      return {
        granularity: 'month',
        anchorIso: cleanAnchor,
        todayIso: todayIso,
        year: mYear,
        month: mMonth,
        monthNameAr: CALENDAR_MONTHS_AR[mMonth - 1] || '',
        monthNameEn: CALENDAR_MONTHS_FULL_EN[mMonth - 1] || '',
        monthStartIso: firstOfMonth,
        monthEndIso: lastOfMonth,
        startIso: monthDays.length ? monthDays[0].iso : firstOfMonth,
        endIso: monthDays.length ? monthDays[monthDays.length - 1].iso : lastOfMonth,
        prevAnchorIso: formatIsoDateParts(prevYM.year, prevYM.month, 1),
        nextAnchorIso: formatIsoDateParts(nextYM.year, nextYM.month, 1),
        weekdayHeaders: weekdayHeaders,
        days: monthDays
      };
    }

    var startIso = cleanAnchor;
    var endIso = cleanAnchor;
    var stepDays = 1;

    if (gran === 'week') {
      var aParts = cleanAnchor.split('-');
      var aDt = new Date(Date.UTC(parseInt(aParts[0], 10), parseInt(aParts[1], 10) - 1, parseInt(aParts[2], 10)));
      var dow = aDt.getUTCDay();
      var diffToStart = (dow - weekStartsOn + 7) % 7;
      startIso = addDaysIso(cleanAnchor, -diffToStart);
      endIso = addDaysIso(startIso, 6);
      stepDays = 7;
    }

    var days = [];
    var totalDays = gran === 'week' ? 7 : 1;
    for (var i = 0; i < totalDays; i++) {
      var iso = i === 0 ? startIso : addDaysIso(startIso, i);
      days.push(buildCalendarDayMeta(iso, todayIso, true));
    }

    return {
      granularity: gran,
      anchorIso: cleanAnchor,
      todayIso: todayIso,
      startIso: startIso,
      endIso: endIso,
      prevAnchorIso: addDaysIso(startIso, -stepDays),
      nextAnchorIso: addDaysIso(startIso, stepDays),
      weekdayHeaders: weekdayHeaders,
      days: days
    };
  }

  function extractReservationCalendarEvents(reservations, startIso, endIso, options) {
    var list = Array.isArray(reservations) ? reservations : [];
    var opts = options || {};
    var sIso = formatDisplayDate(startIso) || '0000-01-01';
    var eIso = formatDisplayDate(endIso) || '9999-12-31';
    var typeFilter = normalizeStr(opts.eventType || opts.typeFilter || 'all').toLowerCase();
    var searchTerm = normalizeStr(opts.search);
    var includeCancelled = Boolean(opts.includeCancelled);
    var now = (typeof opts.nowMs === 'number' && isFinite(opts.nowMs)) ? opts.nowMs : Date.now();

    var events = [];
    var seenKeys = {};
    var counts = { total: 0, pickup: 0, return: 0, extension: 0, completed: 0, overdue: 0 };

    function pushEv(ev) {
      if (!ev || !ev.dateIso) return;
      if (ev.dateIso < sIso || ev.dateIso > eIso) return;
      if (seenKeys[ev.eventKey]) return;
      if (searchTerm && !matchesSearchFields([
        ev.reservationNumber,
        ev.customerName,
        ev.customerPhone,
        ev.carName,
        ev.plateNumber,
        ev.companyName,
        ev.branchName,
        ev.extensionNumber
      ], searchTerm)) {
        return;
      }
      seenKeys[ev.eventKey] = true;
      counts.total += 1;
      if (ev.type === 'pickup') counts.pickup += 1;
      else if (ev.type === 'return') counts.return += 1;
      else if (ev.type === 'extension') counts.extension += 1;
      if (ev.isCompleted) counts.completed += 1;
      if (ev.isOverdue) counts.overdue += 1;
      if (typeFilter && typeFilter !== 'all' && ev.type !== typeFilter) return;
      events.push(ev);
    }

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      if (!includeCancelled && isExcludedMovementStatus(r)) continue;

      var rid = String(r.id || r.reservationNumber || i);
      var resNum = normalizeStr(r.reservationNumber || r.id) || rid;
      var cust = normalizeStr(r.customerName) || '-';
      var phone = normalizeStr(r.customerPhone);
      var car = normalizeStr(r.carName) || '-';
      var plate = normalizeStr(r.plateNumber);
      var comp = normalizeStr(r.companyName);
      var branch = normalizeStr(r.branchName);
      var statusTxt = normalizeStr(r.internalStatus || r.originalStatusAr) || '-';
      var resPriority = normalizeStr(r.priority || 'عادي') || 'عادي';
      var extCount = Number(r.extensionsCount || 0);
      var hasExt = Boolean(r.hasExtensions || extCount > 0 || Number(r.extendedDaysCount || 0) > 0);
      var pickupDone = isPickupCompletedStatus(r);
      var closedDone = isReservationClosedStatus(r);

      var pInfo = resolveReservationStartInfo(r);
      if (pInfo.date) {
        var pickupOverdue = !pickupDone && pInfo.timestampMs !== null && pInfo.timestampMs < now;
        pushEv({
          eventKey: rid + ':pickup:' + pInfo.date,
          type: 'pickup',
          dateIso: pInfo.date,
          timeStr: pInfo.time || '09:00',
          minutesOfDay: pInfo.minutesOfDay !== null ? pInfo.minutesOfDay : 540,
          hourSlot: Math.floor((pInfo.minutesOfDay !== null ? pInfo.minutesOfDay : 540) / 60),
          reservationId: r.id || rid,
          reservationNumber: resNum,
          customerName: cust,
          customerPhone: phone,
          carName: car,
          plateNumber: plate,
          companyName: comp,
          branchName: branch,
          status: statusTxt,
          priority: resPriority,
          isCompleted: pickupDone,
          isOverdue: pickupOverdue,
          isExtended: hasExt,
          extensionDays: 0,
          extensionNumber: '',
          amount: Number(r.baseAmount || r.totalAmount || 0)
        });
      }

      var effEnd = resolveReservationEffectiveEnd(r);
      var returnDate = effEnd.date || formatDisplayDate(r.originalEndDate || r.endDate || '');
      var returnTime = normalizeTimeHHmm(effEnd.time || r.endTime || r.originalEndTime, '12:00');
      var returnMins = parseMinutesOfDay(returnTime);
      if (returnDate) {
        var returnTsMs = parseReservationEndTimestampMs(returnDate, returnTime || '23:59');
        var returnOverdue = !closedDone && returnTsMs !== null && returnTsMs < now;
        pushEv({
          eventKey: rid + ':return:' + returnDate,
          type: 'return',
          dateIso: returnDate,
          timeStr: returnTime || '12:00',
          minutesOfDay: returnMins !== null ? returnMins : 720,
          hourSlot: Math.floor((returnMins !== null ? returnMins : 720) / 60),
          reservationId: r.id || rid,
          reservationNumber: resNum,
          customerName: cust,
          customerPhone: phone,
          carName: car,
          plateNumber: plate,
          companyName: comp,
          branchName: normalizeStr(r.deliverBranchName) || branch,
          status: statusTxt,
          priority: resPriority,
          isCompleted: closedDone,
          isOverdue: returnOverdue,
          isExtended: Boolean(effEnd.isExtended || hasExt),
          extensionDays: Number(r.extendedDaysCount || 0),
          extensionNumber: '',
          amount: Number(r.totalAmount || 0)
        });
      }

      var exts = Array.isArray(r.extensions) ? r.extensions : [];
      var emittedExt = false;
      for (var j = 0; j < exts.length; j++) {
        var ext = exts[j];
        if (!ext || typeof ext !== 'object') continue;
        var extDate = formatDisplayDate(ext.endDate || ext.extendedUntilDate || ext.end_date || ext.startDate || r.extendedUntilDate || r.endDate);
        if (!extDate) continue;
        var extTime = normalizeTimeHHmm(ext.endTime || ext.extendedUntilTime || r.extendedUntilTime || returnTime, '12:00');
        var extMins = parseMinutesOfDay(extTime);
        var extTsMs = parseReservationEndTimestampMs(extDate, extTime || '23:59');
        var extOverdue = !closedDone && extTsMs !== null && extTsMs < now;
        emittedExt = true;
        pushEv({
          eventKey: rid + ':extension:' + String(ext.id || ext.extensionNumber || (j + 1)) + ':' + extDate,
          type: 'extension',
          dateIso: extDate,
          timeStr: extTime || '12:00',
          minutesOfDay: extMins !== null ? extMins : 720,
          hourSlot: Math.floor((extMins !== null ? extMins : 720) / 60),
          reservationId: r.id || rid,
          reservationNumber: resNum,
          customerName: cust,
          customerPhone: phone,
          carName: car,
          plateNumber: plate,
          companyName: comp,
          branchName: branch,
          status: statusTxt,
          priority: resPriority,
          isCompleted: closedDone,
          isOverdue: extOverdue,
          isExtended: true,
          extensionDays: Number(ext.extendDays || ext.daysCount || r.extendedDaysCount || 0),
          extensionNumber: normalizeStr(ext.extensionNumber || ext.code || ('#' + (j + 1))),
          amount: Number(ext.amount || ext.totalAmount || r.extensionsAmount || 0)
        });
      }

      if (!emittedExt && hasExt) {
        var sumExtDate = formatDisplayDate(r.extendedUntilDate || r.endDate || returnDate);
        var sumExtTime = normalizeTimeHHmm(r.extendedUntilTime || returnTime, '12:00');
        var sumExtMins = parseMinutesOfDay(sumExtTime);
        if (sumExtDate) {
          var sumExtTsMs = parseReservationEndTimestampMs(sumExtDate, sumExtTime || '23:59');
          var sumExtOverdue = !closedDone && sumExtTsMs !== null && sumExtTsMs < now;
          pushEv({
            eventKey: rid + ':extension:summary:' + sumExtDate,
            type: 'extension',
            dateIso: sumExtDate,
            timeStr: sumExtTime || '12:00',
            minutesOfDay: sumExtMins !== null ? sumExtMins : 720,
            hourSlot: Math.floor((sumExtMins !== null ? sumExtMins : 720) / 60),
            reservationId: r.id || rid,
            reservationNumber: resNum,
            customerName: cust,
            customerPhone: phone,
            carName: car,
            plateNumber: plate,
            companyName: comp,
            branchName: branch,
            status: statusTxt,
            priority: resPriority,
            isCompleted: closedDone,
            isOverdue: sumExtOverdue,
            isExtended: true,
            extensionDays: Number(r.extendedDaysCount || 0),
            extensionNumber: extCount > 1 ? ('×' + extCount) : '#1',
            amount: Number(r.extensionsAmount || 0)
          });
        }
      }
    }

    var typeOrder = { pickup: 0, extension: 1, return: 2 };
    events.sort(function (a, b) {
      if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
      if (a.minutesOfDay !== b.minutesOfDay) return a.minutesOfDay - b.minutesOfDay;
      var ta = typeOrder[a.type] !== undefined ? typeOrder[a.type] : 9;
      var tb = typeOrder[b.type] !== undefined ? typeOrder[b.type] : 9;
      if (ta !== tb) return ta - tb;
      return a.reservationNumber < b.reservationNumber ? -1 : (a.reservationNumber > b.reservationNumber ? 1 : 0);
    });

    var byDate = {};
    for (var k = 0; k < events.length; k++) {
      var item = events[k];
      if (!byDate[item.dateIso]) byDate[item.dateIso] = [];
      byDate[item.dateIso].push(item);
    }

    return {
      events: events,
      byDate: byDate,
      counts: counts
    };
  }

  function normalizeVersionManifest(raw) {
    var obj = (raw && typeof raw === 'object') ? raw : {};
    var ver = normalizeStr(obj.version || obj.buildId || obj.appVersion || obj.release);
    var buildId = normalizeStr(obj.buildId || ver);
    var builtAt = normalizeStr(obj.builtAt || obj.timestamp || '');
    return {
      version: ver,
      buildId: buildId,
      builtAt: builtAt
    };
  }

  function compareAppVersions(currentVer, remoteVer) {
    var cur = normalizeStr(currentVer);
    var rem = normalizeStr(remoteVer);
    if (!cur || !rem) return false;
    if (cur === 'dev' || rem === 'dev' || cur === 'local' || rem === 'local') return false;
    return cur !== rem;
  }

  function shouldTriggerAutoUpdateReload(options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var cur = normalizeStr(opts.currentVersion);
    var rem = normalizeStr(opts.remoteVersion);
    if (!compareAppVersions(cur, rem)) {
      return { shouldReload: false, reason: 'up_to_date', targetVersion: cur || rem };
    }
    if (opts.isUpdating) {
      return { shouldReload: false, reason: 'already_updating', targetVersion: rem };
    }
    var nowMs = typeof opts.nowMs === 'number' && isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    var lastVer = normalizeStr(opts.lastAttemptVer);
    var lastAt = toNum(opts.lastAttemptAt, 0);
    var cooldownMs = Math.max(5000, toNum(opts.cooldownMs, 30000));
    if (lastVer && lastVer === rem && lastAt > 0 && (nowMs - lastAt) < cooldownMs) {
      return { shouldReload: false, reason: 'cooldown_antiloop', targetVersion: rem, waitMs: cooldownMs - (nowMs - lastAt) };
    }
    if (opts.hasInFlightMutations) {
      return { shouldReload: false, reason: 'inflight_mutations', deferMs: 800, targetVersion: rem };
    }
    if (opts.hasUnsavedChanges && !opts.ignoreUnsaved) {
      return { shouldReload: false, reason: 'unsaved_changes', deferMs: 2500, targetVersion: rem };
    }
    return { shouldReload: true, reason: 'new_version_detected', targetVersion: rem };
  }

  function computeAdaptiveSyncDelay(options) {
    var opts = (options && typeof options === 'object') ? options : {};
    if (opts.isOnline === false) return 0;
    if (opts.isVisible === false) return 0;
    var errs = Math.max(0, Math.min(5, Math.floor(toNum(opts.consecutiveErrors, 0))));
    if (opts.sseConnected) {
      var sseBase = Math.max(8000, toNum(opts.sseHeartbeatMs, 15000));
      return errs > 0 ? Math.min(30000, Math.round(sseBase * Math.pow(1.4, Math.min(3, errs)))) : sseBase;
    }
    var fallbackBase = Math.max(2000, toNum(opts.fallbackPollMs, 3000));
    if (errs === 0) return fallbackBase;
    return Math.min(15000, Math.round(fallbackBase * Math.pow(1.5, Math.min(4, errs))));
  }

  function appendSyncDiagnosticLog(list, entry, maxEntries) {
    var cap = Math.max(10, Math.min(200, Math.floor(toNum(maxEntries, 80))));
    var src = Array.isArray(list) ? list : [];
    var e = (entry && typeof entry === 'object') ? entry : {};
    var msg = normalizeStr(e.message || e.msg || '');
    if (!msg) return src.slice(0, cap);
    var item = {
      id: normalizeStr(e.id) || ('LOG_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
      time: normalizeStr(e.time) || new Date().toISOString(),
      kind: normalizeStr(e.kind) || 'sync',
      level: normalizeStr(e.level) || 'info',
      message: msg.slice(0, 260),
      detail: normalizeStr(e.detail || '').slice(0, 300)
    };
    var next = [item].concat(src);
    if (next.length > cap) next.length = cap;
    return next;
  }

  function filterDeletedNotificationsPayload(payload, deletedIdsMap, deletedAllBeforeMs) {
    var src = (payload && typeof payload === 'object') ? payload : {};
    var items = Array.isArray(src.items) ? src.items : [];
    var delMap = (deletedIdsMap && typeof deletedIdsMap === 'object') ? deletedIdsMap : null;
    var clearMs = (typeof deletedAllBeforeMs === 'number' && isFinite(deletedAllBeforeMs) && deletedAllBeforeMs > 0)
      ? deletedAllBeforeMs
      : 0;
    var filtered = [];
    var unread = 0;
    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      if (!n || typeof n !== 'object') continue;
      if (n.deletedAt) continue;
      var nid = normalizeStr(n.id);
      if (!nid) continue;
      if (delMap && delMap[nid]) continue;
      if (clearMs > 0 && n.createdAt) {
        var createdMs = Date.parse(String(n.createdAt));
        if (!isNaN(createdMs) && createdMs <= clearMs) continue;
      }
      filtered.push(n);
      if (!n.isRead) unread++;
    }
    return Object.assign({}, src, {
      items: filtered,
      unreadCount: unread
    });
  }

  /* ============================================================================
   * CUSTOMER NOTES ENTERPRISE ENGINE (Statuses, 14 Buttons, Rules, Settings)
   * ============================================================================ */

  var CUSTOMER_NOTE_TYPES = ['ملاحظة', 'مكالمة', 'واتساب', 'بريد إلكتروني', 'متابعة', 'زيارة'];

  var CUSTOMER_NOTE_DEFAULT_STATUSES = [
    { id: 'CNS_NEW', name: 'جديدة', description: 'ملاحظة عميل مسجلة حديثاً وتحتاج فرزاً أو مراجعة', color: '#3b82f6', sortOrder: 10, isActive: true, isDefault: true, allowAgentSelect: true, isClosedStatus: false },
    { id: 'CNS_REVIEW', name: 'قيد المراجعة', description: 'جاري فحص تفاصيل الملاحظة والتحقق من الحجز', color: '#8b5cf6', sortOrder: 20, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: false },
    { id: 'CNS_WAIT_CUST', name: 'بانتظار رد العميل', description: 'تم التواصل وبانتظار إفادة أو رد العميل', color: '#f59e0b', sortOrder: 30, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: false },
    { id: 'CNS_WAIT_COMP', name: 'بانتظار شركة التأجير', description: 'بانتظار رد أو إجراء من شركة التأجير الشريكة', color: '#f97316', sortOrder: 40, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: false },
    { id: 'CNS_PROGRESS', name: 'قيد المعالجة', description: 'يجري العمل على تنفيذ متطلبات الملاحظة', color: '#06b6d4', sortOrder: 50, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: false },
    { id: 'CNS_RESOLVED', name: 'تم الحل', description: 'تمت معالجة الملاحظة وحلها بالكامل', color: '#10b981', sortOrder: 60, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: true },
    { id: 'CNS_CLOSED', name: 'مغلقة', description: 'ملاحظة منتهية ومؤرشفة', color: '#64748b', sortOrder: 70, isActive: true, isDefault: false, allowAgentSelect: true, isClosedStatus: true },
    { id: 'CNS_CANCELLED', name: 'ملغاة', description: 'ملاحظة ملغاة أو مكررة لا تتطلب إجراءً', color: '#ef4444', sortOrder: 80, isActive: true, isDefault: false, allowAgentSelect: false, isClosedStatus: true }
  ];

  var CUSTOMER_NOTES_BUTTON_CATALOG = [
    { key: 'add_note', labelAr: 'إضافة ملاحظة', labelEn: 'Add Note', requiredPermission: 'add_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'edit_note', labelAr: 'تعديل ملاحظة', labelEn: 'Edit Note', requiredPermission: 'edit_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false },
    { key: 'delete_note', labelAr: 'حذف ملاحظة', labelEn: 'Delete Note', requiredPermission: 'delete_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: true },
    { key: 'change_status', labelAr: 'تغيير الحالة', labelEn: 'Change Status', requiredPermission: 'change_customer_note_status', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false },
    { key: 'search_notes', labelAr: 'البحث', labelEn: 'Search', requiredPermission: 'view_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'filter_notes', labelAr: 'الفلاتر', labelEn: 'Filters', requiredPermission: 'view_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'view_details', labelAr: 'عرض التفاصيل', labelEn: 'View Details', requiredPermission: 'view_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'attach_file', labelAr: 'إرفاق ملف', labelEn: 'Attach File', requiredPermission: 'add_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'delete_attachment', labelAr: 'حذف مرفق', labelEn: 'Delete Attachment', requiredPermission: 'edit_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: true },
    { key: 'assign_note', labelAr: 'إسناد لموظف', labelEn: 'Assign Note Task', requiredPermission: 'assign_customer_note', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false },
    { key: 'export_notes', labelAr: 'تصدير الملاحظات', labelEn: 'Export Notes', requiredPermission: 'export_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false },
    { key: 'print_notes', labelAr: 'طباعة', labelEn: 'Print Notes', requiredPermission: 'export_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false },
    { key: 'refresh_notes', labelAr: 'تحديث البيانات', labelEn: 'Refresh Data', requiredPermission: 'view_customer_notes', defaultRoles: ['developer', 'general_manager', 'supervisor', 'agent'], defaultConfirm: false },
    { key: 'view_history', labelAr: 'عرض سجل التعديلات', labelEn: 'View Audit History', requiredPermission: 'view_customer_note_history', defaultRoles: ['developer', 'general_manager', 'supervisor'], defaultConfirm: false }
  ];

  function createDefaultButtonsMap() {
    var out = {};
    for (var i = 0; i < CUSTOMER_NOTES_BUTTON_CATALOG.length; i++) {
      var def = CUSTOMER_NOTES_BUTTON_CATALOG[i];
      out[def.key] = {
        key: def.key,
        labelAr: def.labelAr,
        visible: true,
        enabled: true,
        allowedRoles: def.defaultRoles.slice(),
        requiredPermission: def.requiredPermission,
        requireConfirmation: Boolean(def.defaultConfirm),
        logActivity: true,
        showSuccessNotification: true,
        allowEditAfterClose: false,
        allowDeleteAfterClose: false,
        allowAgentEditOther: false
      };
    }
    return out;
  }

  var DEFAULT_CUSTOMER_NOTES_CONFIG = {
    general: {
      sectionTitle: 'ملاحظات العملاء',
      enabled: true,
      pageSize: 20,
      defaultSort: 'newest',
      maxResults: 200,
      enableSearch: true,
      enableFilters: true,
      retentionDays: 0
    },
    addNote: {
      requiredTitle: false,
      requiredReservation: false,
      requiredType: true,
      requiredStatus: true,
      allowStandalone: true,
      allowReservationLinked: true,
      allowCustomerOnly: true,
      allowProblemLinked: true,
      maxLength: 4000,
      allowedAttachmentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'],
      maxAttachmentSizeMb: 5,
      allowInternalNotes: true,
      editableAfterSave: true
    },
    notifications: {
      onAdd: true,
      onStatusChange: true,
      onAssign: true,
      onReplyUpdate: true,
      onClose: true,
      notifyRoles: ['supervisor', 'general_manager'],
      notifyEmployeeIds: []
    },
    activityLog: {
      trackAdd: true,
      trackEdit: true,
      trackDelete: true,
      trackStatusChange: true,
      trackAssign: true,
      trackAttachments: true,
      includeOldNewValues: true,
      includeSourceSection: true
    },
    buttons: createDefaultButtonsMap(),
    customersSection: {
      enableView: true,
      enableAddCustomer: true,
      enableEditCustomer: true,
      showSensitiveIds: true,
      showBookingsTab: true,
      showExtensionsTab: true,
      showProblemsTab: true,
      enableSearch: true,
      enableFilters: true,
      enableInternalNotes: true,
      enableActivityLog: true,
      enableExport: true,
      enablePrint: true,
      enableStatusManagement: true
    }
  };

  function normalizeCustomerNotesConfig(raw) {
    var src = raw;
    if (typeof raw === 'string') {
      try { src = JSON.parse(raw); } catch (_e) { src = {}; }
    }
    if (!src || typeof src !== 'object') src = {};
    var def = DEFAULT_CUSTOMER_NOTES_CONFIG;
    var g = Object.assign({}, def.general, (src.general && typeof src.general === 'object') ? src.general : {});
    g.sectionTitle = normalizeStr(g.sectionTitle) || def.general.sectionTitle;
    g.enabled = g.enabled !== false;
    g.pageSize = Math.max(5, Math.min(100, Math.floor(toNum(g.pageSize, def.general.pageSize))));
    g.defaultSort = (g.defaultSort === 'oldest' || g.defaultSort === 'updated' || g.defaultSort === 'status') ? g.defaultSort : 'newest';
    g.maxResults = Math.max(20, Math.min(1000, Math.floor(toNum(g.maxResults, def.general.maxResults))));
    g.enableSearch = g.enableSearch !== false;
    g.enableFilters = g.enableFilters !== false;
    g.retentionDays = Math.max(0, Math.min(3650, Math.floor(toNum(g.retentionDays, 0))));

    var a = Object.assign({}, def.addNote, (src.addNote && typeof src.addNote === 'object') ? src.addNote : {});
    a.requiredTitle = Boolean(a.requiredTitle);
    a.requiredReservation = Boolean(a.requiredReservation);
    a.requiredType = a.requiredType !== false;
    a.requiredStatus = a.requiredStatus !== false;
    a.allowStandalone = a.allowStandalone !== false;
    a.allowReservationLinked = a.allowReservationLinked !== false;
    a.allowCustomerOnly = a.allowCustomerOnly !== false;
    a.allowProblemLinked = a.allowProblemLinked !== false;
    a.maxLength = Math.max(50, Math.min(20000, Math.floor(toNum(a.maxLength, def.addNote.maxLength))));
    a.maxAttachmentSizeMb = Math.max(1, Math.min(25, Math.floor(toNum(a.maxAttachmentSizeMb, def.addNote.maxAttachmentSizeMb))));
    a.allowedAttachmentTypes = Array.isArray(a.allowedAttachmentTypes)
      ? a.allowedAttachmentTypes.map(normalizeStr).filter(Boolean)
      : def.addNote.allowedAttachmentTypes.slice();
    a.allowInternalNotes = a.allowInternalNotes !== false;
    a.editableAfterSave = a.editableAfterSave !== false;

    var n = Object.assign({}, def.notifications, (src.notifications && typeof src.notifications === 'object') ? src.notifications : {});
    n.onAdd = n.onAdd !== false;
    n.onStatusChange = n.onStatusChange !== false;
    n.onAssign = n.onAssign !== false;
    n.onReplyUpdate = n.onReplyUpdate !== false;
    n.onClose = n.onClose !== false;
    n.notifyRoles = Array.isArray(n.notifyRoles) ? n.notifyRoles.map(normalizeStr).filter(Boolean) : def.notifications.notifyRoles.slice();
    n.notifyEmployeeIds = Array.isArray(n.notifyEmployeeIds) ? n.notifyEmployeeIds.map(normalizeStr).filter(Boolean) : [];

    var act = Object.assign({}, def.activityLog, (src.activityLog && typeof src.activityLog === 'object') ? src.activityLog : {});
    act.trackAdd = act.trackAdd !== false;
    act.trackEdit = act.trackEdit !== false;
    act.trackDelete = act.trackDelete !== false;
    act.trackStatusChange = act.trackStatusChange !== false;
    act.trackAssign = act.trackAssign !== false;
    act.trackAttachments = act.trackAttachments !== false;
    act.includeOldNewValues = act.includeOldNewValues !== false;
    act.includeSourceSection = act.includeSourceSection !== false;

    var rawBtns = (src.buttons && typeof src.buttons === 'object') ? src.buttons : {};
    var defBtns = createDefaultButtonsMap();
    var buttons = {};
    for (var i = 0; i < CUSTOMER_NOTES_BUTTON_CATALOG.length; i++) {
      var meta = CUSTOMER_NOTES_BUTTON_CATALOG[i];
      var curB = (rawBtns[meta.key] && typeof rawBtns[meta.key] === 'object') ? rawBtns[meta.key] : {};
      var mergedB = Object.assign({}, defBtns[meta.key], curB, { key: meta.key, labelAr: meta.labelAr });
      mergedB.visible = mergedB.visible !== false;
      mergedB.enabled = mergedB.enabled !== false;
      mergedB.allowedRoles = Array.isArray(curB.allowedRoles)
        ? curB.allowedRoles.map(normalizeStr).filter(Boolean)
        : defBtns[meta.key].allowedRoles.slice();
      mergedB.requiredPermission = normalizeStr(mergedB.requiredPermission) || meta.requiredPermission;
      mergedB.requireConfirmation = Boolean(mergedB.requireConfirmation);
      mergedB.logActivity = mergedB.logActivity !== false;
      mergedB.showSuccessNotification = mergedB.showSuccessNotification !== false;
      mergedB.allowEditAfterClose = Boolean(mergedB.allowEditAfterClose);
      mergedB.allowDeleteAfterClose = Boolean(mergedB.allowDeleteAfterClose);
      mergedB.allowAgentEditOther = Boolean(mergedB.allowAgentEditOther);
      buttons[meta.key] = mergedB;
    }

    var cs = Object.assign({}, def.customersSection, (src.customersSection && typeof src.customersSection === 'object') ? src.customersSection : {});
    Object.keys(def.customersSection).forEach(function (ck) {
      cs[ck] = cs[ck] !== false;
    });

    return {
      general: g,
      addNote: a,
      notifications: n,
      activityLog: act,
      buttons: buttons,
      customersSection: cs
    };
  }

  function normalizeCustomerNoteStatusRecord(raw) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    return {
      id: normalizeStr(r.id) || ('CNS_' + Date.now().toString(36)),
      name: normalizeStr(r.name),
      description: normalizeStr(r.description),
      color: /^#[0-9a-fA-F]{3,8}$/.test(normalizeStr(r.color)) ? normalizeStr(r.color) : '#3b82f6',
      sortOrder: Math.max(0, Math.min(9999, Math.floor(toNum(r.sortOrder !== undefined ? r.sortOrder : r.sort_order, 100)))),
      isActive: r.isActive !== undefined ? Boolean(r.isActive) : (r.is_active !== undefined ? Boolean(r.is_active) : true),
      isDefault: Boolean(r.isDefault !== undefined ? r.isDefault : r.is_default),
      allowAgentSelect: r.allowAgentSelect !== undefined ? Boolean(r.allowAgentSelect) : (r.allow_agent_select !== undefined ? Boolean(r.allow_agent_select) : true),
      isClosedStatus: Boolean(r.isClosedStatus !== undefined ? r.isClosedStatus : r.is_closed_status),
      notesCount: Math.max(0, Math.floor(toNum(r.notesCount !== undefined ? r.notesCount : r.notes_count, 0))),
      createdAt: normalizeStr(r.createdAt || r.created_at),
      updatedAt: normalizeStr(r.updatedAt || r.updated_at)
    };
  }

  function evaluateCustomerNoteButtonAccess(user, buttonKey, noteObj, rawConfig, options) {
    var cfg = normalizeCustomerNotesConfig(rawConfig);
    var opts = (options && typeof options === 'object') ? options : {};
    var rule = cfg.buttons[buttonKey] || createDefaultButtonsMap()[buttonKey];
    if (!rule) {
      return { allowed: false, reason: 'BUTTON_NOT_FOUND', message: 'الإجراء غير معروف.', rule: null };
    }
    if (!cfg.general.enabled && buttonKey !== 'refresh_notes' && buttonKey !== 'view_details') {
      return { allowed: false, reason: 'SECTION_DISABLED', message: 'قسم ملاحظات العملاء معطل حالياً من الإعدادات.', rule: rule };
    }
    var role = user && user.role ? normalizeStr(user.role) : '';
    var isDev = role === ROLES.DEVELOPER;
    if (!rule.visible && !isDev) {
      return { allowed: false, reason: 'BUTTON_HIDDEN', message: 'هذا الإجراء مخفي من إعدادات النظام.', rule: rule };
    }
    if (!rule.enabled) {
      return { allowed: false, reason: 'BUTTON_DISABLED', message: 'هذا الإجراء معطل حالياً من لوحة التحكم.', rule: rule };
    }
    if (!isDev && Array.isArray(rule.allowedRoles) && rule.allowedRoles.length > 0 && rule.allowedRoles.indexOf(role) === -1) {
      return { allowed: false, reason: 'ROLE_FORBIDDEN', message: 'دورك الوظيفي غير مخول لتنفيذ هذا الإجراء.', rule: rule };
    }
    if (!isDev && rule.requiredPermission) {
      var okPerm = canUserPerform(user, rule.requiredPermission);
      // Backward compatibility: view_customer_notes allowed when user has view_customers + add_customer_note if not explicitly restricted
      if (!okPerm && rule.requiredPermission === 'view_customer_notes') {
        okPerm = canUserPerform(user, 'view_customers') && (canUserPerform(user, 'add_customer_note') || canUserPerform(user, 'view_customer_notes'));
      }
      if (!okPerm) {
        return { allowed: false, reason: 'PERM_FORBIDDEN', message: 'ليس لديك الصلاحية اللازمة لتنفيذ هذا الإجراء.', rule: rule };
      }
    }

    if (noteObj && typeof noteObj === 'object') {
      var isClosed = Boolean(noteObj.isClosed);
      if ((buttonKey === 'edit_note' || buttonKey === 'attach_file' || buttonKey === 'delete_attachment') && !cfg.addNote.editableAfterSave && !isDev) {
        return { allowed: false, reason: 'LOCKED_AFTER_SAVE', message: 'تم تعطيل تعديل الملاحظات بعد الحفظ من الإعدادات.', rule: rule };
      }
      if ((buttonKey === 'edit_note' || buttonKey === 'attach_file' || buttonKey === 'delete_attachment') && isClosed && !rule.allowEditAfterClose && !isDev) {
        return { allowed: false, reason: 'CLOSED_LOCKED', message: 'لا يمكن تعديل ملاحظة مغلقة.', rule: rule };
      }
      if (buttonKey === 'delete_note' && isClosed && !rule.allowDeleteAfterClose && !isDev) {
        return { allowed: false, reason: 'CLOSED_LOCKED', message: 'لا يمكن حذف ملاحظة مغلقة.', rule: rule };
      }
      if (role === ROLES.AGENT && (buttonKey === 'edit_note' || buttonKey === 'delete_note' || buttonKey === 'delete_attachment')) {
        var authorId = normalizeStr(noteObj.createdById || noteObj.created_by_id);
        var uid = normalizeStr(user && (user.id || user.employeeId));
        if (authorId && uid && authorId !== uid && !rule.allowAgentEditOther) {
          return { allowed: false, reason: 'OTHER_AUTHOR_FORBIDDEN', message: 'لا يمكنك تعديل أو حذف ملاحظة أنشأها موظف آخر.', rule: rule };
        }
      }
    }

    if (opts.checkConfirm && rule.requireConfirmation && !opts.confirmed) {
      return { allowed: false, reason: 'CONFIRMATION_REQUIRED', message: 'يرجى تأكيد تنفيذ هذا الإجراء.', rule: rule };
    }

    return { allowed: true, reason: 'OK', message: '', rule: rule };
  }

  function validateCustomerNotePayload(payload, config, statusesList, user) {
    var p = (payload && typeof payload === 'object') ? payload : {};
    var cfg = normalizeCustomerNotesConfig(config);
    var statuses = Array.isArray(statusesList) && statusesList.length ? statusesList.map(normalizeCustomerNoteStatusRecord) : CUSTOMER_NOTE_DEFAULT_STATUSES.slice();
    var content = normalizeStr(p.content || p.note);
    var title = normalizeStr(p.title);
    var noteType = normalizeStr(p.noteType) || 'ملاحظة';
    var customerId = normalizeStr(p.customerId);
    var reservationId = normalizeStr(p.reservationId);
    var problemId = normalizeStr(p.problemId);
    var isInternal = Boolean(p.isInternal);

    if (!customerId && !cfg.addNote.allowStandalone && !reservationId && !problemId) {
      return { valid: false, message: 'إضافة ملاحظة مستقلة غير متاحة؛ يجب ربط الملاحظة بعميل أو حجز أو مشكلة.' };
    }
    if (customerId && !reservationId && !problemId && !cfg.addNote.allowCustomerOnly) {
      return { valid: false, message: 'إضافة ملاحظة على العميل فقط غير مسموح به حالياً.' };
    }
    if (reservationId && !cfg.addNote.allowReservationLinked) {
      return { valid: false, message: 'تم تعطيل ربط الملاحظات بالحجوزات من الإعدادات.' };
    }
    if (problemId && !cfg.addNote.allowProblemLinked) {
      return { valid: false, message: 'تم تعطيل ربط الملاحظات بالمشكلات من الإعدادات.' };
    }
    if (cfg.addNote.requiredReservation && !reservationId) {
      return { valid: false, message: 'يجب ربط الملاحظة برقم حجز محدد.' };
    }
    if (cfg.addNote.requiredTitle && !title) {
      return { valid: false, message: 'عنوان الملاحظة مطلوب حسب قواعد الإضافة.' };
    }
    if (!content) {
      return { valid: false, message: 'نص الملاحظة مطلوب.' };
    }
    if (content.length > cfg.addNote.maxLength) {
      return { valid: false, message: 'نص الملاحظة يتجاوز الحد الأقصى المسموح (' + cfg.addNote.maxLength + ' حرف).' };
    }
    if (isInternal && !cfg.addNote.allowInternalNotes) {
      return { valid: false, message: 'الملاحظات الداخلية معطلة حالياً.' };
    }
    if (CUSTOMER_NOTE_TYPES.indexOf(noteType) === -1) {
      noteType = 'ملاحظة';
    }

    var reqStatusId = normalizeStr(p.statusId);
    var reqStatusName = normalizeStr(p.statusName || p.status);
    var resolvedStatus = null;
    if (reqStatusId || reqStatusName) {
      resolvedStatus = statuses.find(function (s) {
        return (reqStatusId && s.id === reqStatusId) || (reqStatusName && s.name === reqStatusName);
      }) || null;
      if (!resolvedStatus) {
        return { valid: false, message: 'حالة الملاحظة المختارة غير موجودة.' };
      }
      if (!resolvedStatus.isActive) {
        return { valid: false, message: 'لا يمكن اختيار حالة معطلة لملاحظة جديدة أو محدثة: ' + resolvedStatus.name };
      }
      if (user && user.role === ROLES.AGENT && resolvedStatus.allowAgentSelect === false) {
        return { valid: false, message: 'الحالة المختارة غير متاحة للاختيار بواسطة الموظف: ' + resolvedStatus.name };
      }
    } else {
      resolvedStatus = statuses.find(function (s) { return s.isActive && s.isDefault; })
        || statuses.find(function (s) { return s.isActive; })
        || CUSTOMER_NOTE_DEFAULT_STATUSES[0];
    }

    return {
      valid: true,
      noteType: noteType,
      title: title,
      content: content,
      status: resolvedStatus,
      isInternal: isInternal
    };
  }

  /* ============================================================================
   * DEVELOPER-ONLY DATA INTEGRITY MONITOR PURE HELPERS
   * ============================================================================ */

  var DATA_INTEGRITY_DISCREPANCY_TYPES = {
    missing_in_neon: { key: 'missing_in_neon', labelAr: 'مفقود في Neon وموجود في RG', severity: 'high' },
    missing_in_rg: { key: 'missing_in_rg', labelAr: 'مفقود في Rental Gate وموجود في Neon', severity: 'high' },
    status_mismatch: { key: 'status_mismatch', labelAr: 'اختلاف حالة الحجز', severity: 'high' },
    customer_mismatch: { key: 'customer_mismatch', labelAr: 'اختلاف بيانات العميل', severity: 'medium' },
    dates_mismatch: { key: 'dates_mismatch', labelAr: 'اختلاف مواعيد الاستلام أو الإرجاع', severity: 'high' },
    vehicle_company_mismatch: { key: 'vehicle_company_mismatch', labelAr: 'اختلاف السيارة أو شركة التأجير', severity: 'medium' },
    duplicate_record: { key: 'duplicate_record', labelAr: 'سجل مكرر في قاعدة البيانات', severity: 'high' },
    incomplete_fields: { key: 'incomplete_fields', labelAr: 'حقول أساسية ناقصة أو غير مكتملة', severity: 'low' },
    stale_record: { key: 'stale_record', labelAr: 'سجل متأخر عن آخر تحديث', severity: 'low' },
    sync_error: { key: 'sync_error', labelAr: 'خطأ مزامنة في المصدر', severity: 'high' }
  };

  var DEFAULT_DATA_INTEGRITY_SETTINGS = {
    mode: 'manual',
    intervalMinutes: 60,
    scopes: ['reservations', 'extensions', 'cancelled', 'company_changes'],
    dateFrom: '',
    dateTo: '',
    batchSize: 100,
    paused: false
  };

  function normalizeDataIntegritySettings(raw) {
    var src = raw;
    if (typeof raw === 'string') {
      try { src = JSON.parse(raw); } catch (_e) { src = {}; }
    }
    if (!src || typeof src !== 'object') src = {};
    var allowedScopes = ['reservations', 'extensions', 'cancelled', 'company_changes'];
    var scopes = Array.isArray(src.scopes)
      ? src.scopes.map(normalizeStr).filter(function (s) { return allowedScopes.indexOf(s) !== -1; })
      : DEFAULT_DATA_INTEGRITY_SETTINGS.scopes.slice();
    if (!scopes.length) scopes = ['reservations'];
    return {
      mode: src.mode === 'scheduled' ? 'scheduled' : 'manual',
      intervalMinutes: Math.max(5, Math.min(1440, Math.floor(toNum(src.intervalMinutes, 60)))),
      scopes: scopes,
      dateFrom: formatDisplayDate(src.dateFrom || ''),
      dateTo: formatDisplayDate(src.dateTo || ''),
      batchSize: Math.max(20, Math.min(500, Math.floor(toNum(src.batchSize, 100)))),
      paused: Boolean(src.paused)
    };
  }

  function buildIntegrityRecordProjection(raw, isRgSource) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    var id = normalizeStr(r.id || (isRgSource ? extractSourceReservationId(r) : r.source_id));
    var num = normalizeStr(r.reservationNumber || r.reservation_number || (isRgSource ? extractReservationNumber(r) : '') || id);
    var statusCode = isRgSource
      ? normalizeStr(extractReservationStatusCode(r, true) || r.status || r.statusCode || '')
      : normalizeStr(r.originalStatusCode || r.original_status_code || r.internalStatus || r.internal_status);
    var statusAr = isRgSource
      ? resolveSourceWorkflowStatus(r)
      : normalizeStr(r.internalStatus || r.internal_status || r.originalStatusAr || r.original_status_ar || translateOriginalStatus(statusCode));
    return {
      id: id,
      reservationNumber: num,
      statusCode: statusCode,
      statusAr: statusAr,
      customerName: normalizeStr(r.customerName || r.customer_name || (r.customer && r.customer.name) || (r.user && r.user.name)),
      customerPhone: normalizeStr(r.customerPhone || r.customer_phone || (r.customer && r.customer.phone) || (r.user && r.user.phone)),
      startDate: formatDisplayDate(r.startDate || r.start_date || r.pickup_date),
      startTime: normalizeStr(r.startTime || r.start_time || extractTimeOnly(r.startDate || r.start_date)),
      endDate: formatDisplayDate(r.actualEndDate || r.extendedUntilDate || r.extended_until_date || r.endDate || r.end_date || r.return_date),
      endTime: normalizeStr(r.endTime || r.end_time || extractTimeOnly(r.actualEndDate || r.endDate || r.end_date)),
      carName: normalizeStr(r.carName || r.car_name || (r.car && (r.car.name || r.car.model))),
      companyName: normalizeStr(r.companyName || r.company_name || (r.company && r.company.name) || r.newCompanyName || r.new_company_name),
      extensionsCount: Math.floor(toNum(r.extensionsCount !== undefined ? r.extensionsCount : r.extensions_count, 0)),
      updatedAt: normalizeStr(r.lastUpdatedAt || r.updatedAt || r.updated_at)
    };
  }

  function compareRgAndNeonReservations(rgList, neonList) {
    var rgArr = Array.isArray(rgList) ? rgList : [];
    var neonArr = Array.isArray(neonList) ? neonList : [];
    var rgByKey = {};
    var neonByKey = {};
    var neonKeyCounts = {};
    var issues = [];

    for (var ni = 0; ni < neonArr.length; ni++) {
      var nProj = buildIntegrityRecordProjection(neonArr[ni], false);
      var nKey = normalizeStr(nProj.reservationNumber || nProj.id);
      if (!nKey) continue;
      neonKeyCounts[nKey] = (neonKeyCounts[nKey] || 0) + 1;
      if (!neonByKey[nKey]) {
        neonByKey[nKey] = nProj;
      } else {
        issues.push({
          discrepancyType: 'duplicate_record',
          severity: 'high',
          sourceScope: 'reservations',
          reservationId: nProj.id,
          reservationNumber: nKey,
          fieldName: 'reservation_number',
          rgValue: 'سجل فريد واحد',
          neonValue: 'مكرر (' + neonKeyCounts[nKey] + ' سجلات)',
          rgSnapshot: rgByKey[nKey] || {},
          neonSnapshot: nProj
        });
      }
    }

    for (var ri = 0; ri < rgArr.length; ri++) {
      var rProj = buildIntegrityRecordProjection(rgArr[ri], true);
      var rKey = normalizeStr(rProj.reservationNumber || rProj.id);
      if (!rKey) continue;
      rgByKey[rKey] = rProj;

      var nMatch = neonByKey[rKey] || null;
      if (!nMatch) {
        issues.push({
          discrepancyType: 'missing_in_neon',
          severity: 'high',
          sourceScope: 'reservations',
          reservationId: rProj.id,
          reservationNumber: rKey,
          fieldName: 'record',
          rgValue: rProj.statusAr || rProj.statusCode || 'موجود في RG',
          neonValue: 'غير موجود في Neon',
          rgSnapshot: rgArr[ri],
          neonSnapshot: {}
        });
        continue;
      }

      // Incomplete required fields check
      if (!nMatch.customerName || !nMatch.customerPhone || !nMatch.startDate || !nMatch.endDate) {
        var missingCols = [];
        if (!nMatch.customerName) missingCols.push('اسم العميل');
        if (!nMatch.customerPhone) missingCols.push('رقم الجوال');
        if (!nMatch.startDate) missingCols.push('تاريخ الاستلام');
        if (!nMatch.endDate) missingCols.push('تاريخ الإرجاع');
        issues.push({
          discrepancyType: 'incomplete_fields',
          severity: 'low',
          sourceScope: 'reservations',
          reservationId: nMatch.id,
          reservationNumber: rKey,
          fieldName: 'required_fields',
          rgValue: [rProj.customerName, rProj.customerPhone, rProj.startDate, rProj.endDate].filter(Boolean).join(' · '),
          neonValue: 'ناقص: ' + missingCols.join('، '),
          rgSnapshot: rgArr[ri],
          neonSnapshot: nMatch
        });
      }

      // Status mismatch check (compare semantic lifecycle or explicit translated code)
      var rgStatusLc = getReservationLifecycleKind({ originalStatusCode: rProj.statusCode, internalStatus: rProj.statusAr });
      var neonStatusLc = getReservationLifecycleKind({ originalStatusCode: nMatch.statusCode, internalStatus: nMatch.statusAr });
      var rgOrigNorm = normalizeStr(rProj.statusCode).toLowerCase();
      var neonOrigNorm = normalizeStr(nMatch.statusCode).toLowerCase();
      if (rgStatusLc !== neonStatusLc || (rgOrigNorm && neonOrigNorm && rgOrigNorm !== neonOrigNorm && translateOriginalStatus(rgOrigNorm) !== translateOriginalStatus(neonOrigNorm))) {
        issues.push({
          discrepancyType: 'status_mismatch',
          severity: 'high',
          sourceScope: 'reservations',
          reservationId: nMatch.id,
          reservationNumber: rKey,
          fieldName: 'status',
          rgValue: rProj.statusAr + (rProj.statusCode ? (' (' + rProj.statusCode + ')') : ''),
          neonValue: nMatch.statusAr + (nMatch.statusCode ? (' (' + nMatch.statusCode + ')') : ''),
          rgSnapshot: rgArr[ri],
          neonSnapshot: nMatch
        });
      }

      // Customer mismatch check
      var rgPhoneDigits = normalizeEmployeePhone(rProj.customerPhone);
      var neonPhoneDigits = normalizeEmployeePhone(nMatch.customerPhone);
      if ((rgPhoneDigits && neonPhoneDigits && rgPhoneDigits !== neonPhoneDigits) ||
          (rProj.customerName && nMatch.customerName && normalizeSearchText(rProj.customerName) !== normalizeSearchText(nMatch.customerName))) {
        issues.push({
          discrepancyType: 'customer_mismatch',
          severity: 'medium',
          sourceScope: 'reservations',
          reservationId: nMatch.id,
          reservationNumber: rKey,
          fieldName: 'customer',
          rgValue: [rProj.customerName, rProj.customerPhone].filter(Boolean).join(' / '),
          neonValue: [nMatch.customerName, nMatch.customerPhone].filter(Boolean).join(' / '),
          rgSnapshot: rgArr[ri],
          neonSnapshot: nMatch
        });
      }

      // Pickup / return date mismatch check
      if ((rProj.startDate && nMatch.startDate && rProj.startDate !== nMatch.startDate) ||
          (rProj.endDate && nMatch.endDate && rProj.endDate !== nMatch.endDate)) {
        issues.push({
          discrepancyType: 'dates_mismatch',
          severity: 'high',
          sourceScope: 'reservations',
          reservationId: nMatch.id,
          reservationNumber: rKey,
          fieldName: 'dates',
          rgValue: (rProj.startDate || '-') + ' → ' + (rProj.endDate || '-'),
          neonValue: (nMatch.startDate || '-') + ' → ' + (nMatch.endDate || '-'),
          rgSnapshot: rgArr[ri],
          neonSnapshot: nMatch
        });
      }

      // Car / rental company mismatch check
      if ((rProj.companyName && nMatch.companyName && normalizeSearchText(rProj.companyName) !== normalizeSearchText(nMatch.companyName)) ||
          (rProj.carName && nMatch.carName && normalizeSearchText(rProj.carName) !== normalizeSearchText(nMatch.carName))) {
        issues.push({
          discrepancyType: 'vehicle_company_mismatch',
          severity: 'medium',
          sourceScope: 'reservations',
          reservationId: nMatch.id,
          reservationNumber: rKey,
          fieldName: 'vehicle_company',
          rgValue: [rProj.companyName, rProj.carName].filter(Boolean).join(' — '),
          neonValue: [nMatch.companyName, nMatch.carName].filter(Boolean).join(' — '),
          rgSnapshot: rgArr[ri],
          neonSnapshot: nMatch
        });
      }
    }

    var neonKeys = Object.keys(neonByKey);
    for (var nki = 0; nki < neonKeys.length; nki++) {
      var k = neonKeys[nki];
      if (!rgByKey[k]) {
        issues.push({
          discrepancyType: 'missing_in_rg',
          severity: 'high',
          sourceScope: 'reservations',
          reservationId: neonByKey[k].id,
          reservationNumber: k,
          fieldName: 'record',
          rgValue: 'غير موجود في استجابة Rental Gate',
          neonValue: neonByKey[k].statusAr || neonByKey[k].statusCode || 'موجود في Neon',
          rgSnapshot: {},
          neonSnapshot: neonByKey[k]
        });
      }
    }

    return {
      rgTotalCount: rgArr.length,
      neonTotalCount: neonArr.length,
      reviewedCount: Math.max(rgArr.length, neonArr.length),
      discrepanciesCount: issues.length,
      issues: issues
    };
  }

  return {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    DASHBOARD_PERMISSION_KEYS: DASHBOARD_PERMISSION_KEYS,
    SECTION_VIEW_PERMISSION_KEYS: SECTION_VIEW_PERMISSION_KEYS,
    ROUTE_PERMISSION_MAP: ROUTE_PERMISSION_MAP,
    ROLE_PERMISSION_MATRIX: ROLE_PERMISSION_MATRIX,
    PERMISSIONS_CATALOG: PERMISSIONS_CATALOG,
    JOB_ROLE_PRESETS: JOB_ROLE_PRESETS,
    FOLLOWUP_STATUSES: FOLLOWUP_STATUSES,
    WORKFLOW_STATUS_OPTIONS: WORKFLOW_STATUS_OPTIONS,
    MANUAL_WORKFLOW_STATUS_OPTIONS: MANUAL_WORKFLOW_STATUS_OPTIONS,
    isManualBlockedWorkflowStatus: isManualBlockedWorkflowStatus,
    PULL_DURATION_PRESETS: PULL_DURATION_PRESETS,
    PROBLEM_PRIORITIES: PROBLEM_PRIORITIES,
    PROBLEM_STATUSES: PROBLEM_STATUSES,
    REPORT_COLUMNS_BY_TYPE: REPORT_COLUMNS_BY_TYPE,
    translateOriginalStatus: translateOriginalStatus,
    extractSourceReservationId: extractSourceReservationId,
    extractCustomerNationalId: extractCustomerNationalId,
    extractReservationNumber: extractReservationNumber,
    extractReservationStatusCode: extractReservationStatusCode,
    shouldAutoReconcileSyncedStatus: shouldAutoReconcileSyncedStatus,
    resolveSourceWorkflowStatus: resolveSourceWorkflowStatus,
    isValidWorkflowStatus: isValidWorkflowStatus,
    getWorkflowStatusOptions: getWorkflowStatusOptions,
    normalizeStatusHistory: normalizeStatusHistory,
    appendStatusStageEntry: appendStatusStageEntry,
    formatStatusStageSourceLabel: formatStatusStageSourceLabel,
    resolvePullDateRange: resolvePullDateRange,
    filterSourceReservationsByPullRange: filterSourceReservationsByPullRange,
    CUSTOMER_STATUS_LIST: CUSTOMER_STATUS_LIST,
    CUSTOMER_RESERVATION_STATUS_OPTIONS: CUSTOMER_RESERVATION_STATUS_OPTIONS,
    classifyReservationStatusBucket: classifyReservationStatusBucket,
    doesReservationMatchStatusFilter: doesReservationMatchStatusFilter,
    CUSTOMER_NOTE_TYPES: CUSTOMER_NOTE_TYPES,
    CUSTOMER_NOTE_DEFAULT_STATUSES: CUSTOMER_NOTE_DEFAULT_STATUSES,
    CUSTOMER_NOTES_BUTTON_CATALOG: CUSTOMER_NOTES_BUTTON_CATALOG,
    DEFAULT_CUSTOMER_NOTES_CONFIG: DEFAULT_CUSTOMER_NOTES_CONFIG,
    normalizeCustomerNotesConfig: normalizeCustomerNotesConfig,
    normalizeCustomerNoteStatusRecord: normalizeCustomerNoteStatusRecord,
    evaluateCustomerNoteButtonAccess: evaluateCustomerNoteButtonAccess,
    validateCustomerNotePayload: validateCustomerNotePayload,
    DATA_INTEGRITY_DISCREPANCY_TYPES: DATA_INTEGRITY_DISCREPANCY_TYPES,
    DEFAULT_DATA_INTEGRITY_SETTINGS: DEFAULT_DATA_INTEGRITY_SETTINGS,
    normalizeDataIntegritySettings: normalizeDataIntegritySettings,
    buildIntegrityRecordProjection: buildIntegrityRecordProjection,
    compareRgAndNeonReservations: compareRgAndNeonReservations,
    extractPhoneCountryCode: extractPhoneCountryCode,
    detectCustomerIdType: detectCustomerIdType,
    buildCustomerCanonicalKey: buildCustomerCanonicalKey,
    computeCustomerLifecycleStatus: computeCustomerLifecycleStatus,
    redactCustomerSensitiveFields: redactCustomerSensitiveFields,
    buildCustomersAggregateFromData: buildCustomersAggregateFromData,
    buildCustomersIndexFromReservations: buildCustomersIndexFromReservations,
    mergeReservationBatch: mergeReservationBatch,
    translateDeliveryType: translateDeliveryType,
    translateExtensionType: translateExtensionType,
    isExtensionAcceptedAndPaid: isExtensionAcceptedAndPaid,
    summarizeReservationExtensions: summarizeReservationExtensions,
    computeTotalAmount: computeTotalAmount,
    mergeSyncedReservation: mergeSyncedReservation,
    isPrivilegedRole: isPrivilegedRole,
    resolveEffectivePermissions: resolveEffectivePermissions,
    canAccessApi: canAccessApi,
    canUserPerform: canUserPerform,
    canUserViewDashboardSection: canUserViewDashboardSection,
    canUserViewRoute: canUserViewRoute,
    mergePermissionsCatalog: mergePermissionsCatalog,
    normalizeRolePresets: normalizeRolePresets,
    upsertRolePreset: upsertRolePreset,
    removeRolePreset: removeRolePreset,
    upsertPermissionDefinition: upsertPermissionDefinition,
    removePermissionDefinition: removePermissionDefinition,
    claimReservationRecord: claimReservationRecord,
    unclaimReservationRecord: unclaimReservationRecord,
    filterReservations: filterReservations,
    buildReservationQueryPayload: buildReservationQueryPayload,
    hasActiveReservationFilters: hasActiveReservationFilters,
    doesReservationMatchFilters: doesReservationMatchFilters,
    reapplyReservationDeltaToFilteredList: reapplyReservationDeltaToFilteredList,
    filterProblemsList: filterProblemsList,
    reapplyProblemDeltaToFilteredList: reapplyProblemDeltaToFilteredList,
    filterTeamFollowUpsList: filterTeamFollowUpsList,
    reapplyFollowUpDeltaToFilteredList: reapplyFollowUpDeltaToFilteredList,
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
    parseBackendResponseText: parseBackendResponseText,
    getApiCachePolicy: getApiCachePolicy,
    buildApiCacheKey: buildApiCacheKey,
    getCacheInvalidationScopes: getCacheInvalidationScopes,
    formatDisplayDate: formatDisplayDate,
    formatDisplayDateTime: formatDisplayDateTime,
    extractTimeOnly: extractTimeOnly,
    TIME_FORMATS: TIME_FORMATS,
    SIDEBAR_POSITIONS: SIDEBAR_POSITIONS,
    TIMEZONE_DISPLAY_MODES: TIMEZONE_DISPLAY_MODES,
    RESERVATIONS_DISPLAY_MODES: RESERVATIONS_DISPLAY_MODES,
    CALENDAR_GRANULARITIES: CALENDAR_GRANULARITIES,
    normalizeTimeFormat: normalizeTimeFormat,
    normalizeSidebarPosition: normalizeSidebarPosition,
    normalizeTimezoneMode: normalizeTimezoneMode,
    normalizeReservationsDisplayMode: normalizeReservationsDisplayMode,
    normalizeCalendarGranularity: normalizeCalendarGranularity,
    formatTimePreference: formatTimePreference,
    formatDateTimePreference: formatDateTimePreference,
    convertKsaDateTimeToEgypt: convertKsaDateTimeToEgypt,
    buildBookingTimezoneDisplay: buildBookingTimezoneDisplay,
    normalizeLoginUsername: normalizeLoginUsername,
    getReportColumns: getReportColumns,
    formatReportCellValue: formatReportCellValue,
    computePdfColumnWidths: computePdfColumnWidths,
    wrapTextPreservingNewlines: wrapTextPreservingNewlines,
    isPureLtrText: isPureLtrText,
    formatBidiPdfText: formatBidiPdfText,
    buildCompressedExcelSheets: buildCompressedExcelSheets,
    buildMutationLockKey: buildMutationLockKey,
    isProblemClosedStatus: isProblemClosedStatus,
    resolveNotificationTarget: resolveNotificationTarget,
    applyOptimisticProblemPatch: applyOptimisticProblemPatch,
    computeDataFingerprint: computeDataFingerprint,
    shouldAutoRefreshNow: shouldAutoRefreshNow,
    DELETE_ALL_RESERVATIONS_PHRASE: DELETE_ALL_RESERVATIONS_PHRASE,
    normalizeAutoSyncInterval: normalizeAutoSyncInterval,
    formatAutoSyncIntervalAr: formatAutoSyncIntervalAr,
    normalizeDeleteReservationsScope: normalizeDeleteReservationsScope,
    matchesReservationDeleteScope: matchesReservationDeleteScope,
    filterReservationsForDeleteScope: filterReservationsForDeleteScope,
    validateDeleteAllReservationsConfirmation: validateDeleteAllReservationsConfirmation,
    formatIsoDateParts: formatIsoDateParts,
    getDaysInMonth: getDaysInMonth,
    convertEasternDigitsToAscii: convertEasternDigitsToAscii,
    sanitizeManualDateInput: sanitizeManualDateInput,
    parseIsoDateStrict: parseIsoDateStrict,
    validateIsoDateInput: validateIsoDateInput,
    shiftCalendarMonth: shiftCalendarMonth,
    buildCalendarMonthGrid: buildCalendarMonthGrid,
    resolveRangeSelectionClick: resolveRangeSelectionClick,
    clampPdfPage: clampPdfPage,
    clampPdfZoom: clampPdfZoom,
    computePdfZoom: computePdfZoom,
    PDF_BRAND_IDENTITY: PDF_BRAND_IDENTITY,
    PDF_ARABIC_FONTS: PDF_ARABIC_FONTS,
    PDF_DESIGN_STYLES: PDF_DESIGN_STYLES,
    PDF_MARGIN_PRESETS_MM: PDF_MARGIN_PRESETS_MM,
    PDF_FONT_SIZE_SCALES: PDF_FONT_SIZE_SCALES,
    normalizePdfHexColor: normalizePdfHexColor,
    PDF_LAYOUT_PRESETS: PDF_LAYOUT_PRESETS,
    PDF_QUALITY_PROFILES: PDF_QUALITY_PROFILES,
    clampPdfTargetPages: clampPdfTargetPages,
    resolvePdfExportSettings: resolvePdfExportSettings,
    resolvePdfMarginsMm: resolvePdfMarginsMm,
    resolveAdvancedPdfSettings: resolveAdvancedPdfSettings,
    applyPdfColumnSelectionAndOrder: applyPdfColumnSelectionAndOrder,
    getUserPdfPrefsStorageKey: getUserPdfPrefsStorageKey,
    getPaperDimensionsMm: getPaperDimensionsMm,
    simulatePdfPagination: simulatePdfPagination,
    estimatePdfFileSizeBytes: estimatePdfFileSizeBytes,
    computePdfLayoutPlan: computePdfLayoutPlan,
    parseReservationEndTimestampMs: parseReservationEndTimestampMs,
    resolveReservationEffectiveEnd: resolveReservationEffectiveEnd,
    isReservationClosedStatus: isReservationClosedStatus,
    classifyExpiryRadarItem: classifyExpiryRadarItem,
    computeExpiryRadarSummary: computeExpiryRadarSummary,
    normalizeWhatsappPhone: normalizeWhatsappPhone,
    buildExtensionOfferMessage: buildExtensionOfferMessage,
    SHIFT_HANDOVER_PRESETS: SHIFT_HANDOVER_PRESETS,
    HANDOVER_SETTINGS_DEFAULTS: HANDOVER_SETTINGS_DEFAULTS,
    normalizeHandoverSettings: normalizeHandoverSettings,
    HANDOVER_PDF_VISIBILITY_DEFAULTS: HANDOVER_PDF_VISIBILITY_DEFAULTS,
    normalizeHandoverPdfVisibility: normalizeHandoverPdfVisibility,
    resolveShiftWindow: resolveShiftWindow,
    computeShiftHandoverSummary: computeShiftHandoverSummary,
    buildShiftHandoverPdfPayload: buildShiftHandoverPdfPayload,
    parseMinutesOfDay: parseMinutesOfDay,
    normalizeTimeHHmm: normalizeTimeHHmm,
    isTimeInRange: isTimeInRange,
    resolveReservationStartInfo: resolveReservationStartInfo,
    computeTodayMovementsSummary: computeTodayMovementsSummary,
    isReservationOverdueUnpaid: isReservationOverdueUnpaid,
    formatOverdueDurationLabel: formatOverdueDurationLabel,
    isDelegationActive: isDelegationActive,
    applyActiveDelegationsToUser: applyActiveDelegationsToUser,
    computeAuditFieldDiffs: computeAuditFieldDiffs,
    formatIcsDateTimeUtc: formatIcsDateTimeUtc,
    buildIcsCalendarContent: buildIcsCalendarContent,
    buildReservationIcsEvents: buildReservationIcsEvents,
    buildTodayScheduleIcsEvents: buildTodayScheduleIcsEvents,
    CALL_WRAPUP_OUTCOMES: CALL_WRAPUP_OUTCOMES,
    DEFAULT_CALL_WRAPUP_OUTCOMES: DEFAULT_CALL_WRAPUP_OUTCOMES,
    normalizeCallWrapupShortcutsConfig: normalizeCallWrapupShortcutsConfig,
    getActiveCallWrapupShortcuts: getActiveCallWrapupShortcuts,
    upsertCallWrapupShortcut: upsertCallWrapupShortcut,
    removeCallWrapupShortcut: removeCallWrapupShortcut,
    resetCallWrapupShortcutsConfig: resetCallWrapupShortcutsConfig,
    computeExtensionComparisonSummary: computeExtensionComparisonSummary,
    HEATMAP_DAY_ORDER: HEATMAP_DAY_ORDER,
    computePeakHoursHeatmap: computePeakHoursHeatmap,
    findMentionSegments: findMentionSegments,
    extractMentionedEmployees: extractMentionedEmployees,
    MAX_PINNED_CRITICAL_RESERVATIONS: MAX_PINNED_CRITICAL_RESERVATIONS,
    UI_SIMPLIFICATION_GROUPS: UI_SIMPLIFICATION_GROUPS,
    UI_SIMPLIFICATION_OPTIONS: UI_SIMPLIFICATION_OPTIONS,
    TEAM_UI_PRESETS: TEAM_UI_PRESETS,
    normalizeUiSimplificationSettings: normalizeUiSimplificationSettings,
    DEFAULT_RESERVATIONS_VISIBLE_COLS: DEFAULT_RESERVATIONS_VISIBLE_COLS,
    normalizeRoleUiDefaults: normalizeRoleUiDefaults,
    resolveRoleUiDefaultsForUser: resolveRoleUiDefaultsForUser,
    canUserImpersonate: canUserImpersonate,
    getAllowedPreviewRoles: getAllowedPreviewRoles,
    resolvePreviewUserSession: resolvePreviewUserSession,
    computeEmployeeLeaderboard: computeEmployeeLeaderboard,
    SPAM_GUARD_EXEMPT_ACTIONS: SPAM_GUARD_EXEMPT_ACTIONS,
    evaluateSpamGuard: evaluateSpamGuard,
    formatDirectCallTelHref: formatDirectCallTelHref,
    formatDirectCallDisplayNumber: formatDirectCallDisplayNumber,
    formatBookingSummaryText: formatBookingSummaryText,
    buildNoAnswerActionText: buildNoAnswerActionText,
    computeSharedAssignmentInfo: computeSharedAssignmentInfo,
    computeProblemsPer100Bookings: computeProblemsPer100Bookings,
    filterMentionFollowUps: filterMentionFollowUps,
    PROBLEM_RATE_VISIBILITY_STORAGE_KEY: PROBLEM_RATE_VISIBILITY_STORAGE_KEY,
    normalizeProblemRateVisibility: normalizeProblemRateVisibility,
    formatProblemRateToggleLabel: formatProblemRateToggleLabel,
    NAV_ROUTE_IDS: NAV_ROUTE_IDS,
    SUBSECTION_VIEW_PERMISSION_KEYS: SUBSECTION_VIEW_PERMISSION_KEYS,
    EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS: EXTRA_SUBSECTION_VIEW_PERMISSION_KEYS,
    canUserViewSubSection: canUserViewSubSection,
    ACTION_BUTTON_PERMISSION_KEYS: ACTION_BUTTON_PERMISSION_KEYS,
    canUserUseActionButton: canUserUseActionButton,
    canUserViewCustomerId: canUserViewCustomerId,
    normalizeNationalId: normalizeNationalId,
    EXPLICIT_ACTIVE_STATUS_VALUES: EXPLICIT_ACTIVE_STATUS_VALUES,
    REJECTED_STATUS_VALUES: REJECTED_STATUS_VALUES,
    CANCELLED_STATUS_VALUES: CANCELLED_STATUS_VALUES,
    isExplicitActiveStatusToken: isExplicitActiveStatusToken,
    isRejectedToken: isRejectedToken,
    isCancelledToken: isCancelledToken,
    REJECTION_REASONS_LIST: REJECTION_REASONS_LIST,
    CANCELLATION_REASONS_LIST: CANCELLATION_REASONS_LIST,
    CAR_STATUS_AT_REQUEST_OPTIONS: CAR_STATUS_AT_REQUEST_OPTIONS,
    isRejectedStatus: isRejectedStatus,
    isInRejectedTab: isInRejectedTab,
    isCancelledStatus: isCancelledStatus,
    isInactiveReservation: isInactiveReservation,
    classifyReservationLifecycle: classifyReservationLifecycle,
    getReservationLifecycleKind: getReservationLifecycleKind,
    redactReservationSensitiveFields: redactReservationSensitiveFields,
    groupCustomerLookupResults: groupCustomerLookupResults,
    normalizeUiOverrides: normalizeUiOverrides,
    EMPLOYEE_SECTION_GROUPS: EMPLOYEE_SECTION_GROUPS,
    ensureSectionPermissionSentinels: ensureSectionPermissionSentinels,
    applyEmployeeSectionToggle: applyEmployeeSectionToggle,
    setEmployeeSectionGroupVisibility: setEmployeeSectionGroupVisibility,
    getEmployeeSectionVisibilitySummary: getEmployeeSectionVisibilitySummary,
    DEFAULT_STATS_CONTROL_CONFIG: DEFAULT_STATS_CONTROL_CONFIG,
    STATS_VIEW_PERMISSION_KEYS: STATS_VIEW_PERMISSION_KEYS,
    normalizeStatsControlConfig: normalizeStatsControlConfig,
    isEmployeeIncludedInStats: isEmployeeIncludedInStats,
    filterEmployeesForStats: filterEmployeesForStats,
    canEmployeeViewStatistics: canEmployeeViewStatistics,
    applyEmployeeStatsViewToggle: applyEmployeeStatsViewToggle,
    PROTECTED_NAV_ROUTES: PROTECTED_NAV_ROUTES,
    DASHBOARD_SECTION_DEFS: DASHBOARD_SECTION_DEFS,
    normalizeUserLayoutPrefs: normalizeUserLayoutPrefs,
    reorderListByDragDrop: reorderListByDragDrop,
    moveOrderItem: moveOrderItem,
    computeDashboardSectionSpans: computeDashboardSectionSpans,
    getFirstAllowedRoute: getFirstAllowedRoute,
    normalizeExcelCellDate: normalizeExcelCellDate,
    parseImportedReservationRows: parseImportedReservationRows,
    mergeDeltaRecords: mergeDeltaRecords,
    mergeRecordsMonotonic: mergeRecordsMonotonic,
    hasMeaningfulDeltaChanges: hasMeaningfulDeltaChanges,
    haveDashboardSnapshotsChanged: haveDashboardSnapshotsChanged,
    resolveSwrSnapshot: resolveSwrSnapshot,
    resolveAsyncViewState: resolveAsyncViewState,
    getRiyadhTodayDateStr: getRiyadhTodayDateStr,
    addDaysIso: addDaysIso,
    buildCalendarPeriodWindow: buildCalendarPeriodWindow,
    extractReservationCalendarEvents: extractReservationCalendarEvents,
    resolveAssetUrl: resolveAssetUrl,
    buildCacheBustedUrl: buildCacheBustedUrl,
    normalizeVersionManifest: normalizeVersionManifest,
    compareAppVersions: compareAppVersions,
    shouldTriggerAutoUpdateReload: shouldTriggerAutoUpdateReload,
    computeAdaptiveSyncDelay: computeAdaptiveSyncDelay,
    appendSyncDiagnosticLog: appendSyncDiagnosticLog,
    normalizeSearchText: normalizeSearchText,
    tokenizeSearchQuery: tokenizeSearchQuery,
    matchesSearchFields: matchesSearchFields,
    sanitizeReasonText: sanitizeReasonText,
    extractRejectionReason: extractRejectionReason,
    extractCancellationReason: extractCancellationReason,
    extractReservationStatusCode: extractReservationStatusCode,
    extractExplicitReferenceNumber: extractExplicitReferenceNumber,
    isProtectedRejectedOrCancelledItem: isProtectedRejectedOrCancelledItem,
    UI_ROUTE_HIDE_KEYS: UI_ROUTE_HIDE_KEYS,
    UI_SUBSECTION_HIDE_KEYS: UI_SUBSECTION_HIDE_KEYS,
    UI_DASHBOARD_HIDE_KEYS: UI_DASHBOARD_HIDE_KEYS,
    UI_ACTION_HIDE_KEYS: UI_ACTION_HIDE_KEYS,
    isUiOptionHiddenForUser: isUiOptionHiddenForUser,
    dedupeEmployeesList: dedupeEmployeesList,
    normalizeEmployeePhone: normalizeEmployeePhone,
    normalizeEmployeeEmail: normalizeEmployeeEmail,
    extractDayAndHourFromDateValue: extractDayAndHourFromDateValue,
    filterDeletedNotificationsPayload: filterDeletedNotificationsPayload,
    MIN_AUTO_SYNC_SECONDS: MIN_AUTO_SYNC_SECONDS,
    MAX_AUTO_SYNC_SECONDS: MAX_AUTO_SYNC_SECONDS,
    validateAutoSyncInterval: validateAutoSyncInterval,
    normalizeAutoSyncIntervalSeconds: normalizeAutoSyncIntervalSeconds,
    formatAutoSyncIntervalSecondsAr: formatAutoSyncIntervalSecondsAr
  };
}));
