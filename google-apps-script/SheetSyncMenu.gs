/* ============================================================
   سحب الحجوزات من RentalGate + شيت المتابعة (Data / FollowUps)
   نسخة محسّنة فائقة السرعة باستخدام UrlFetchApp.fetchAll() بالتوازي
   التوكن يُحفظ بأمان في Script Properties (RG_TOKEN & RENTAL_TOKEN)
   ============================================================ */

var API = "https://api.rentalgate.net/api";
var RES_URL = API + "/reservations/filter";
var EXT_URL = API + "/reservation-extends/filter";
var PAGE_SIZE = 100;       // 100 عنصر بالصفحة لتقليل عدد الطلبات إلى النصف
var FIRST_PAGE = 0;        // الصفحات تبدأ من 0
var MAX_PAGES = 500;
var START_KEY = 20261110;  // الحجوزات من 10 نوفمبر 2026 (عدّله حسب الحاجة)

// التمديدات التي تنزل (مدفوع ومقبول فقط)
var EXT_ALLOWED = ["PAID", "ADMIN_APPROVED", "APPROVED", "ACCEPTED"];
// حالات الحجوزات المستبعدة
var EXCLUDE_STATUSES = ["CANCELLED", "CANCELED", "DECLINED", "REJECTED"];

/* ---------- إعدادات تابة FollowUps ---------- */

var FU_SYS = [
  "رقم الحجز", "اسم العميل", "جوال العميل", "الشركة", "اسم الفرع", "السيارة",
  "بداية الحجز", "وقت البداية", "نهاية الحجز", "وقت النهاية", "مدة الحجز",
  "نوع الاستلام", "نوع التسليم", "حالة الحجز"
];
var FU_ROUNDS = 4;
var FU_ROUND_FIELDS = ["حالة المتابعة", "موظف المتابعة", "الإجراء", "تاريخ المتابعة", "ملاحظات الموظف"];
var F_STATUS = 0, F_EMP = 1, F_ACTION = 2, F_DATE = 3, F_NOTES = 4;
var FU_ROUND_COLORS = ["#fff2cc", "#e2efda", "#fce4d6", "#ddebf7", "#ede7f6", "#f2f2f2"];
var FU_AGENT = [];
for (var _r = 1; _r <= FU_ROUNDS; _r++) {
  FU_ROUND_FIELDS.forEach(function (f) { FU_AGENT.push(f + " " + _r); });
}
var FU_HEADERS = FU_SYS.concat(FU_AGENT);
var FU_N_SYS = FU_SYS.length;
function fuCol_(round, field) { return FU_N_SYS + (round - 1) * FU_ROUND_FIELDS.length + field + 1; }

var FU_TEXT_COLS = [1, 2, 3, 7, 8, 9, 10, 11];
var FU_REFRESH_EXISTING = true;
var FU_DATE_FORMAT = "dd/MM/yyyy hh:mm AM/PM";

var FU_STATUSES = ["تم الحجز", "تم التسليم", "تم الاستلام", "تم الإنشاء", "تم الإلغاء", "تم التمديد", "لم يتم الحجز"];
var FU_EMPLOYEES = ["عبد الرحمن الأمير", "علا", "مريم", "أيمن", "زياد", "إبراهيم", "مبارك", "نورة"];
var FU_ACTIONS = [];

/* ---------- تابة Data ---------- */

var DATA_HEADERS = [
  "م", "رقم الحجز", "تاريخ الانشاء", "اسم العميل", "جوال العميل", "الشركة", "اسم الفرع", "السيارة",
  "بداية الحجز", "وقت البداية", "نهاية الحجز", "وقت النهاية", "مدة الحجز", "نوع الاستلام", "نوع التسليم",
  "حالة الحجز", "له تمديد", "نوع التمديد", "المبلغ المدفوع"
];

var STATUS_AR = {
  PENDING: "قيد الانتظار",
  NEW: "جديد",
  CREATED: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  BOOKED: "تم الحجز",
  RESERVED: "تم الحجز",
  ACTIVE: "نشط الآن",
  STARTED: "نشط الآن",
  IN_PROGRESS: "مؤكد",
  ON_THE_WAY: "في الطريق",
  READY: "جاهز للاستلام",
  READY_FOR_PICKUP: "جاهز للاستلام",
  READY_TO_PICKUP: "جاهز للاستلام",
  HOLD: "معلق",
  ON_HOLD: "معلق",
  ONHOLD: "معلق",
  SUSPENDED: "معلق",
  SUSPEND: "معلق",
  PAUSED: "معلق",
  PAUSE: "معلق",
  FROZEN: "معلق",
  HOLD_BY_ADMIN: "معلق",
  ADMIN_HOLD: "معلق",
  WAITING_APPROVAL: "معلق",
  WAITING_CONFIRMATION: "معلق",
  PENDING_APPROVAL: "معلق",
  PENDING_CONFIRMATION: "معلق",
  UNDER_REVIEW: "معلق",
  DELIVERED: "تم التسليم",
  PICKED_UP: "نشط الآن",
  RECEIVED: "نشط الآن",
  ON_RENT: "نشط الآن",
  RENTED: "نشط الآن",
  CAR_RECEIVED: "نشط الآن",
  ONGOING: "نشط الآن",
  RETURNED: "تم الإرجاع",
  EXTENDED: "تم التمديد",
  AUTOMATICALLY_EXTENDED: "تم التمديد تلقائيًا",
  COMPLETED: "منتهي",
  FINISHED: "منتهي",
  CLOSED: "منتهي",
  ENDED: "منتهي",
  FINISHED_BY_DRIVER: "تم التسليم من قبل السائق",
  CANCELLED: "ملغي",
  CANCELED: "ملغي",
  DECLINED: "مرفوض",
  REJECTED: "مرفوض",
  EXPIRED: "منتهي",
  NO_SHOW: "لم يحضر",
  DRAFT: "مسودة",
  UNPAID: "غير مدفوع",
  WAITING_PAYMENT: "بانتظار الدفع",
  AWAITING_PAYMENT: "بانتظار الدفع",
  PENDING_PAYMENT: "بانتظار الدفع",
  PAID: "مدفوع",
  WALLET_PAID: "مدفوع عن طريق المحفظة",
  PAID_BY_WALLET: "مدفوع عن طريق المحفظة",
  PAID_WALLET: "مدفوع عن طريق المحفظة",
  ADMIN_APPROVED: "مقبول",
  LOCATION_CHANGED: "تم تغيير الموقع",
  ACCEPTED: "مقبول",
  APPROVED: "مقبول",
  IN_RENT: "نشط الآن",
  CHECKED_OUT: "نشط الآن",
  CANCELLED_BY_CUSTOMER: "ملغي",
  CANCELED_BY_CUSTOMER: "ملغي",
  CANCELLED_BY_CLIENT: "ملغي",
  CANCELED_BY_CLIENT: "ملغي",
  CANCELLED_BY_USER: "ملغي",
  CANCELED_BY_USER: "ملغي",
  CANCELLED_BY_ADMIN: "ملغي",
  CANCELED_BY_ADMIN: "ملغي",
  CANCELLED_BY_PROVIDER: "ملغي",
  CANCELED_BY_PROVIDER: "ملغي",
  CANCELLED_BY_COMPANY: "ملغي",
  CANCELED_BY_COMPANY: "ملغي",
  CUSTOMER_CANCELLED: "ملغي",
  CUSTOMER_CANCELED: "ملغي",
  USER_CANCELLED: "ملغي",
  USER_CANCELED: "ملغي",
  CLIENT_CANCELLED: "ملغي",
  CLIENT_CANCELED: "ملغي",
  ADMIN_CANCELLED: "ملغي",
  ADMIN_CANCELED: "ملغي",
  PROVIDER_CANCELLED: "ملغي",
  PROVIDER_CANCELED: "ملغي",
  COMPANY_CANCELLED: "ملغي",
  COMPANY_CANCELED: "ملغي",
  SYSTEM_CANCELLED: "ملغي",
  SYSTEM_CANCELED: "ملغي",
  AUTO_CANCELLED: "ملغي",
  AUTO_CANCELED: "ملغي",
  REJECTED_BY_ADMIN: "مرفوض",
  REJECTED_BY_COMPANY: "مرفوض",
  REJECTED_BY_PROVIDER: "مرفوض",
  REJECTED_BY_CUSTOMER: "مرفوض",
  REJECTED_BY_CLIENT: "مرفوض",
  REJECTED_BY_USER: "مرفوض",
  PROVIDER_REJECTED: "مرفوض",
  COMPANY_REJECTED: "مرفوض",
  ADMIN_REJECTED: "مرفوض",
  CUSTOMER_REJECTED: "مرفوض",
  CLIENT_REJECTED: "مرفوض",
  USER_REJECTED: "مرفوض",
  AUTO_REJECTED: "مرفوض",
  SYSTEM_REJECTED: "مرفوض",
  DECLINED_BY_ADMIN: "مرفوض",
  DECLINED_BY_COMPANY: "مرفوض",
  DECLINED_BY_PROVIDER: "مرفوض",
  REFUSED_BY_ADMIN: "مرفوض",
  REFUSED_BY_COMPANY: "مرفوض",
  REFUSED_BY_PROVIDER: "مرفوض"
};
var HANDOVER_AR = {
  BRANCH: "فرع", OFFICE: "فرع", PICKUP: "فرع",
  AIRPORT: "مطار",
  MY_LOCATION: "موقع خاص",
  CUSTOM: "موقع خاص", CUSTOM_LOCATION: "موقع خاص", DELIVERY: "موقع خاص",
  LOCATION: "موقع خاص", PRIVATE_LOCATION: "موقع خاص", PRIVATE: "موقع خاص",
  HOME: "موقع خاص", HOTEL: "موقع خاص"
};
var EXT_TYPE_AR = {
  CLIENT: "التمديد بواسطة العميل",
  CUSTOMER: "التمديد بواسطة العميل",
  USER: "التمديد بواسطة العميل",
  AUTOMATIC: "تمديد تلقائي",
  AUTO: "تمديد تلقائي",
  SYSTEM: "تمديد تلقائي",
  ADMIN: "تمديد إداري",
  MANUAL: "تمديد إداري"
};

var UNMAPPED = {};

/* ---------- أدوات ---------- */

function notify_(msg, opts) {
  var options = opts || {};
  Logger.log(msg);
  if (options.toastOnly) {
    try {
      var activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs && typeof activeSs.toast === "function") {
        activeSs.toast(String(msg), options.title || "Rental Gate", options.duration || 8);
      }
    } catch (e) {}
    return;
  }
  try {
    var activeSsAlert = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSsAlert && typeof activeSsAlert.toast === "function") {
      activeSsAlert.toast(String(msg).split("\n")[0], options.title || "Rental Gate", 6);
    }
  } catch (eToast) {}
  if (options.noAlert) return;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function normalizeToken_(raw) {
  var s = String(raw === null || raw === undefined ? "" : raw)
    .replace(/[\r\n]+/g, "")
    .trim();
  while (s.length >= 2) {
    var f = s.charAt(0), l = s.charAt(s.length - 1);
    if ((f === '"' && l === '"') || (f === "'" && l === "'")) {
      s = s.substring(1, s.length - 1).trim();
    } else {
      break;
    }
  }
  s = s.replace(/^(?:Bearer(?:\s+|$))+/i, "").trim();
  while (s.length >= 2) {
    var f2 = s.charAt(0), l2 = s.charAt(s.length - 1);
    if ((f2 === '"' && l2 === '"') || (f2 === "'" && l2 === "'")) {
      s = s.substring(1, s.length - 1).trim();
    } else {
      break;
    }
  }
  return s.replace(/^(?:Bearer(?:\s+|$))+/i, "").trim();
}

function isValidJwtLikeToken_(token) {
  var t = normalizeToken_(token);
  if (!t || t.indexOf("eyJ") !== 0) return false;
  if (/[\s\x00-\x1f\x7f]/.test(t)) return false;
  var parts = t.split(".");
  return parts.length === 3 && Boolean(parts[0]) && Boolean(parts[1]) && Boolean(parts[2]);
}

function getToken_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props) return "";
    var rgToken = normalizeToken_(props.getProperty("RG_TOKEN"));
    if (rgToken) return rgToken;
    return normalizeToken_(props.getProperty("RENTAL_TOKEN"));
  } catch (e) {
    Logger.log("getToken_ error: " + e.message);
    return "";
  }
}

function setToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("حفظ التوكن", "الصق التوكن (يبدأ بـ eyJ). كلمة Bearer ما تضر، بتنشال تلقائياً", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = normalizeToken_(r.getResponseText());
  if (!isValidJwtLikeToken_(t)) {
    notify_("التوكن غير صحيح أو فارغ، لازم يبدأ بـ eyJ", { toastOnly: true, title: "تنبيه التوكن" });
    return;
  }
  PropertiesService.getScriptProperties().setProperties({
    RG_TOKEN: t,
    RENTAL_TOKEN: t
  });
  notify_("تم حفظ التوكن بنجاح (RG_TOKEN & RENTAL_TOKEN) ✔");
}

function pick_(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    var v = obj, parts = paths[i].split(".");
    for (var j = 0; j < parts.length && v != null; j++) v = v[parts[j]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function pad_(n) { return (n < 10 ? "0" : "") + n; }

function parts_(v) {
  if (!v) return null;
  var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] !== undefined ? +m[4] : null, mi: m[5] !== undefined ? +m[5] : null };
}
function dateKey_(v) { var p = parts_(v); return p ? p.y * 10000 + p.mo * 100 + p.d : 0; }
function fmtDate_(v) { var p = parts_(v); return p ? pad_(p.d) + "/" + pad_(p.mo) + "/" + p.y : ""; }
function fmtTime_(v) {
  var p = parts_(v);
  if (!p || p.h === null) return "";
  return pad_(p.h % 12 || 12) + ":" + pad_(p.mi) + " " + (p.h >= 12 ? "م" : "ص");
}

function durationText_(days) {
  var n = Number(days);
  if (!n) return days || "";
  if (n === 1) return "1 يوم";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return n + " أيام";
  return n + " يوم";
}

function normalizeEnumKey_(v) {
  return String(v === null || v === undefined ? "" : v)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function map_(dict, v, label) {
  if (v === "" || v == null) return "";
  var strVal = String(v).trim();
  if (!strVal) return "";
  if (/[\u0600-\u06FF]/.test(strVal)) return strVal;
  var key = normalizeEnumKey_(strVal);
  var t = dict[key];
  if (t) return t;
  UNMAPPED[label + ": " + strVal] = true;
  return strVal;
}

function round2_(x) { return Math.round(x * 100) / 100; }

/* ---------- سحب البيانات بالتوازي فائق السرعة ---------- */

function buildApiReq_(url, token) {
  var cleanTok = normalizeToken_(token);
  var safeUrl = String(url || "").replace(/(\/api)+\/api(?=\/|$)/gi, "/api");
  return {
    url: safeUrl,
    method: "get",
    headers: { "Authorization": "Bearer " + cleanTok, "Accept": "application/json", "lang": "ar" },
    muteHttpExceptions: true
  };
}

function parseApiRes_(res) {
  if (!res) {
    var emptyResErr = new Error("لم يتم استلام استجابة من الخادم.");
    emptyResErr.code = "EMPTY_RESPONSE";
    throw emptyResErr;
  }
  var code = Number(res.getResponseCode());
  var rawText = String(res.getContentText() || "");
  if (code === 401 || code === 403) {
    var authErr = new Error("التوكن منتهي الصلاحية أو غير مصرح له (كود " + code + ").");
    authErr.code = "INVALID_TOKEN";
    authErr.httpStatus = code;
    throw authErr;
  }
  if (code !== 200) {
    var httpErr = new Error("كود " + code + " | " + rawText.substring(0, 300));
    httpErr.code = "HTTP_ERROR";
    httpErr.httpStatus = code;
    throw httpErr;
  }
  try {
    return JSON.parse(rawText);
  } catch (parseErr) {
    var badJsonErr = new Error("تعذر قراءة استجابة API كـ JSON: " + rawText.substring(0, 200));
    badJsonErr.code = "INVALID_JSON";
    throw badJsonErr;
  }
}

function itemsOf_(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  var r = result.content || result.items || result.data || result.results || result.rows || result.reservations || result.extensions || result.records || result.list || result.payload || result.result || [];
  if (r && !Array.isArray(r)) {
    r = r.content || r.items || r.data || r.results || r.rows || r.reservations || r.extensions || r.records || r.list || [];
  }
  if (r && !Array.isArray(r)) {
    r = r.content || r.items || r.results || r.rows || r.reservations || r.records || r.list || [];
  }
  return Array.isArray(r) ? r : [];
}

function extractPageInfo_(result, requestedSize, currentPage) {
  var root = (result && typeof result === "object" && !Array.isArray(result)) ? result : {};
  var dataObj = (root.data && typeof root.data === "object" && !Array.isArray(root.data))
    ? root.data
    : ((root.payload && typeof root.payload === "object" && !Array.isArray(root.payload))
      ? root.payload
      : ((root.result && typeof root.result === "object" && !Array.isArray(root.result)) ? root.result : {}));
  var metaObj = (root.meta && typeof root.meta === "object")
    ? root.meta
    : ((dataObj.meta && typeof dataObj.meta === "object") ? dataObj.meta : {});
  var pagObj = (root.pagination && typeof root.pagination === "object")
    ? root.pagination
    : ((dataObj.pagination && typeof dataObj.pagination === "object") ? dataObj.pagination : {});

  var items = itemsOf_(result);
  var pageSize = Number(
    root.size || root.pageSize || root.per_page ||
    dataObj.size || dataObj.pageSize || dataObj.per_page ||
    pagObj.per_page || pagObj.pageSize ||
    requestedSize || PAGE_SIZE
  ) || PAGE_SIZE;

  var rawTotalPages =
    root.totalPages || root.total_pages || root.last_page || root.pages || root.pageCount ||
    dataObj.totalPages || dataObj.total_pages || dataObj.last_page || dataObj.pages || dataObj.pageCount ||
    metaObj.totalPages || metaObj.total_pages || metaObj.last_page ||
    pagObj.totalPages || pagObj.total_pages || pagObj.last_page || 0;

  var totalPages = Number(rawTotalPages) || 0;
  if (totalPages <= 0) {
    var totalElements = Number(
      root.totalElements || root.totalCount || root.total_items || root.total ||
      dataObj.totalElements || dataObj.totalCount || dataObj.total_items || dataObj.total ||
      metaObj.totalElements || metaObj.total || pagObj.total || 0
    );
    if (totalElements > 0 && pageSize > 0) {
      totalPages = Math.ceil(totalElements / pageSize);
    }
  }

  var explicitLast = (root.last === true) || (dataObj.last === true) || (metaObj.last === true) || (pagObj.last === true) ||
    (root.hasMore === false) || (root.hasNext === false) ||
    (dataObj.hasMore === false) || (dataObj.hasNext === false) ||
    (metaObj.hasMore === false) || (metaObj.hasNext === false) ||
    (pagObj.hasMore === false) || (pagObj.hasNext === false);
  var explicitNotLast = (root.last === false) || (dataObj.last === false) || (metaObj.last === false) || (pagObj.last === false);
  var explicitHasMore = (root.hasMore === true) || (root.hasNext === true) ||
    (dataObj.hasMore === true) || (dataObj.hasNext === true) ||
    (metaObj.hasMore === true) || (metaObj.hasNext === true) ||
    (pagObj.hasMore === true) || (pagObj.hasNext === true);

  var hasMore = false;
  if (explicitLast || items.length === 0) {
    hasMore = false;
  } else if (totalPages > 0) {
    var pageOffset = currentPage - FIRST_PAGE + 1;
    hasMore = pageOffset < totalPages || explicitHasMore || explicitNotLast;
  } else if (explicitHasMore || explicitNotLast) {
    hasMore = items.length > 0;
  } else if (items.length >= pageSize) {
    hasMore = true;
  }

  return {
    items: items,
    totalPages: totalPages > 0 ? Math.min(totalPages, MAX_PAGES) : 0,
    last: explicitLast,
    hasMore: hasMore
  };
}

function appendPageQuery_(baseUrl, pageNum, pageSize) {
  var sep = baseUrl.indexOf("?") === -1 ? "?" : "&";
  return baseUrl + sep + "page=" + pageNum + "&size=" + pageSize;
}

function collectExtraPages_(baseUrl, token, page0Info, initialItems, idKeys) {
  var pages = [initialItems || []];
  var seen = {};
  var countAdded = function (list) {
    var added = 0;
    for (var k = 0; k < list.length; k++) {
      var id = String(pick_(list[k], idKeys));
      if (id && seen[id]) continue;
      if (id) seen[id] = true;
      added++;
    }
    return added;
  };
  countAdded(pages[0]);

  if (!pages[0].length || page0Info.last) {
    return pages;
  }

  var nextPageToFetch = FIRST_PAGE + 1;
  if (page0Info.totalPages > 1) {
    var reqs = [];
    var pageIndices = [];
    for (var rp = FIRST_PAGE + 1; rp < FIRST_PAGE + page0Info.totalPages && rp < FIRST_PAGE + MAX_PAGES; rp++) {
      reqs.push(buildApiReq_(appendPageQuery_(baseUrl, rp, PAGE_SIZE), token));
      pageIndices.push(rp - FIRST_PAGE);
    }
    var batchSize = 12;
    var stopAfterBatch = false;
    var lastBatchInfo = null;
    for (var i = 0; i < reqs.length && !stopAfterBatch; i += batchSize) {
      var chunkReqs = reqs.slice(i, i + batchSize);
      var chunkIdx = pageIndices.slice(i, i + batchSize);
      var chunkRes = UrlFetchApp.fetchAll(chunkReqs);
      for (var j = 0; j < chunkRes.length; j++) {
        var parsedChunk = parseApiRes_(chunkRes[j]);
        var chunkInfo = extractPageInfo_(parsedChunk, PAGE_SIZE, FIRST_PAGE + chunkIdx[j]);
        pages[chunkIdx[j]] = chunkInfo.items;
        lastBatchInfo = chunkInfo;
        if (chunkInfo.items.length === 0) {
          stopAfterBatch = true;
        } else if (countAdded(chunkInfo.items) === 0) {
          stopAfterBatch = true;
        }
      }
    }
    nextPageToFetch = FIRST_PAGE + page0Info.totalPages;
    if (stopAfterBatch || (lastBatchInfo && lastBatchInfo.last)) {
      return pages;
    }
    if (lastBatchInfo && !lastBatchInfo.hasMore) {
      return pages;
    }
  } else if (!page0Info.hasMore) {
    return pages;
  }

  // Fallback sequential paging when totalPages is omitted/inaccurate or hasMore/last=false indicates more pages
  for (var seqPage = nextPageToFetch; seqPage < FIRST_PAGE + MAX_PAGES; seqPage++) {
    var seqRes = UrlFetchApp.fetch(appendPageQuery_(baseUrl, seqPage, PAGE_SIZE), {
      method: "get",
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json", "lang": "ar" },
      muteHttpExceptions: true
    });
    var seqPayload = parseApiRes_(seqRes);
    var seqInfo = extractPageInfo_(seqPayload, PAGE_SIZE, seqPage);
    if (!seqInfo.items.length) break;
    var newlyAdded = countAdded(seqInfo.items);
    if (newlyAdded === 0) break;
    pages.push(seqInfo.items);
    if (seqInfo.last || !seqInfo.hasMore) break;
  }

  return pages;
}

function fetchBothParallel_(token) {
  var cleanToken = normalizeToken_(token);
  if (!isValidJwtLikeToken_(cleanToken)) {
    var tokenErr = new Error("التوكن غير محفوظ أو فارغ أو غير صالح.");
    tokenErr.code = cleanToken ? "INVALID_TOKEN" : "EMPTY_TOKEN";
    throw tokenErr;
  }

  var firstBatch = UrlFetchApp.fetchAll([
    buildApiReq_(RES_URL + "?page=" + FIRST_PAGE + "&size=" + PAGE_SIZE, cleanToken),
    buildApiReq_(EXT_URL + "?page=" + FIRST_PAGE + "&size=" + PAGE_SIZE, cleanToken)
  ]);

  var res0 = parseApiRes_(firstBatch[0]);
  var res0Info = extractPageInfo_(res0, PAGE_SIZE, FIRST_PAGE);
  var resPages = collectExtraPages_(RES_URL, cleanToken, res0Info, res0Info.items, ["reservationId", "id"]);

  var extPages = [[]];
  try {
    var ext0 = parseApiRes_(firstBatch[1]);
    var ext0Info = extractPageInfo_(ext0, PAGE_SIZE, FIRST_PAGE);
    extPages = collectExtraPages_(EXT_URL, cleanToken, ext0Info, ext0Info.items, ["extendId", "id"]);
  } catch (extErr) {
    if (extErr && (extErr.code === "INVALID_TOKEN" || extErr.httpStatus === 401 || extErr.httpStatus === 403)) {
      throw extErr;
    }
    Logger.log("تحذير سحب التمديدات: " + (extErr && extErr.message ? extErr.message : extErr));
  }

  var dedupe = function (pages, idKeys) {
    var out = [], seen = {};
    for (var p = 0; p < pages.length; p++) {
      var list = pages[p] || [];
      for (var k = 0; k < list.length; k++) {
        var it = list[k];
        var id = String(pick_(it, idKeys));
        if (id && seen[id]) continue;
        if (id) seen[id] = true;
        out.push(it);
      }
    }
    return out;
  };

  return {
    reservations: dedupe(resPages, ["reservationId", "id"]),
    extensions: dedupe(extPages, ["extendId", "id"])
  };
}

/* ---------- تحويل إلى صفوف ---------- */

function resId_(r) { return pick_(r, ["reservationId", "id"]); }
function resDisplayId_(r) {
  return pick_(r, [
    "reservationNumber", "reservation_number", "reservationNo", "reservation_no",
    "reservationCode", "reservation_code", "bookingNumber", "booking_number",
    "contractNumber", "contract_number", "reference", "code", "reservationId", "id"
  ]);
}
function rawStatusOf_(obj) {
  var val = pick_(obj, [
    "reservationStatus", "status", "status_code", "bookingStatus",
    "contractStatus", "statusEn", "reservationStatusCode",
    "reservation.reservationStatus", "reservation.status",
    "status.code", "status.key", "status.value", "status.name"
  ]);
  if (val && typeof val === "object") {
    return pick_(val, ["code", "key", "value", "status", "name", "en"]);
  }
  return val;
}
function extId_(e) { return pick_(e, ["extendId", "id"]); }
function extDate_(e) { return pick_(e, ["extendDate", "createdAt"]); }
function extAllowed_(e) {
  var st = normalizeEnumKey_(rawStatusOf_(e));
  return EXT_ALLOWED.indexOf(st) !== -1;
}

function resRow_(r, idx, exts, flagExt) {
  var amount = Number(r.total) || 0;
  exts.forEach(function (e) { amount += Number(e.total) || 0; });
  return [
    idx,
    resDisplayId_(r),
    fmtDate_(pick_(r, ["reservationDate", "createdAt", "created_at", "startDate"])),
    pick_(r, ["clientName", "customerName"]),
    pick_(r, ["clientMobile", "customerPhone", "mobile"]),
    pick_(r, ["companyArName", "companyEnName", "companyName"]),
    pick_(r, ["receiveBranchArName", "receiveBranchEnName", "branchName"]),
    pick_(r, ["carNameAr", "carNameEn", "carName"]),
    fmtDate_(r.startDate),
    fmtTime_(r.startDate),
    fmtDate_(r.endDate),
    fmtTime_(r.endDate),
    durationText_(r.reservationDays),
    map_(HANDOVER_AR, r.receiveType, "نوع الاستلام"),
    map_(HANDOVER_AR, r.deliverType, "نوع التسليم"),
    map_(STATUS_AR, rawStatusOf_(r), "حالة الحجز"),
    flagExt ? "نعم" : "لا",
    "",
    round2_(amount)
  ];
}

function extRow_(e, full) {
  return [
    "",
    pick_(e, ["reservationNumber", "reservation_number", "reservationId"]),
    fmtDate_(extDate_(e)),
    "تمديد #" + extId_(e) + (full ? " - " + pick_(e, ["clientName", "customerName"]) : ""),
    full ? pick_(e, ["clientMobile", "customerPhone"]) : "",
    full ? pick_(e, ["companyArabicName", "companyName"]) : "",
    full ? pick_(e, ["branchArabicName", "branchName"]) : "",
    full ? pick_(e, ["carName"]) : "",
    fmtDate_(extDate_(e)),
    "", "", "", "", "", "",
    map_(STATUS_AR, rawStatusOf_(e), "حالة التمديد"),
    "",
    map_(EXT_TYPE_AR, e.extensionType, "نوع التمديد"),
    Number(e.total) || 0
  ];
}

/* ---------- تابة FollowUps ---------- */

function fuSysCols_(r) {
  return [
    String(resDisplayId_(r)),
    pick_(r, ["clientName", "customerName"]),
    String(pick_(r, ["clientMobile", "customerPhone", "mobile"])),
    pick_(r, ["companyArName", "companyEnName", "companyName"]),
    pick_(r, ["receiveBranchArName", "receiveBranchEnName", "branchName"]),
    pick_(r, ["carNameAr", "carNameEn", "carName"]),
    fmtDate_(r.startDate),
    fmtTime_(r.startDate),
    fmtDate_(r.endDate),
    fmtTime_(r.endDate),
    durationText_(r.reservationDays),
    map_(HANDOVER_AR, r.receiveType, "نوع الاستلام"),
    map_(HANDOVER_AR, r.deliverType, "نوع التسليم"),
    map_(STATUS_AR, rawStatusOf_(r), "حالة الحجز")
  ];
}

function writeFuHeader_(sheet) {
  sheet.getRange(1, 1, 1, FU_HEADERS.length).setValues([FU_HEADERS])
    .setFontWeight("bold").setBackground("#d9e2f3").setHorizontalAlignment("center");
  for (var r = 1; r <= FU_ROUNDS; r++) {
    sheet.getRange(1, fuCol_(r, 0), 1, FU_ROUND_FIELDS.length)
      .setBackground(FU_ROUND_COLORS[(r - 1) % FU_ROUND_COLORS.length]);
  }
  sheet.setFrozenRows(1);
}

function resolveFollowUpsSheet_(ss) {
  var sheet = ss.getSheetByName("FollowUps");
  if (!sheet) return ss.insertSheet("FollowUps");
  var a1 = String(sheet.getRange(1, 1).getValue() || "").trim();
  // حماية قاعدة بيانات CRM إذا كانت تابة FollowUps مستخدمة بنظام Web App (تبدأ بـ id)
  if (a1 === "id") {
    return ss.getSheetByName("FollowUps_Sheet") || ss.insertSheet("FollowUps_Sheet");
  }
  return sheet;
}

function migrateFollowUps_(sheet) {
  var last = sheet.getLastRow();
  if (last === 0) { writeFuHeader_(sheet); return; }

  var a1 = String(sheet.getRange(1, 1).getValue()).trim();
  if (a1 !== FU_HEADERS[0]) {
    sheet.insertRowsBefore(1, 1);
    writeFuHeader_(sheet);
    return;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var oldH = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var same = FU_HEADERS.every(function (h, i) { return oldH[i] === h; });
  if (same) { return; }

  var data = last > 1 ? sheet.getRange(2, 1, last - 1, lastCol).getValues() : [];
  var idx = FU_HEADERS.map(function (h) {
    var k = oldH.indexOf(h);
    if (k < 0 && / 1$/.test(h)) {
      var base = h.replace(/ 1$/, "");
      k = oldH.indexOf(base);
      if (k < 0 && base === "موظف المتابعة") k = oldH.indexOf("اسم الموظف المتابع");
    }
    return k;
  });
  var out = data.map(function (row) {
    return idx.map(function (k) { return k >= 0 ? row[k] : ""; });
  });

  var firstDataRow = Math.max(2, (typeof sheet.getFrozenRows === 'function' ? Number(sheet.getFrozenRows() || 0) : 1) + 1);
  if (typeof ensureSheetCapacity_ === 'function') {
    ensureSheetCapacity_(sheet, Math.max(firstDataRow, firstDataRow + out.length - 1), FU_HEADERS.length);
  }
  var maxRowsClear = Math.max(firstDataRow, sheet.getMaxRows());
  var maxColsClear = Math.max(FU_HEADERS.length, sheet.getMaxColumns());
  if (maxRowsClear >= firstDataRow) {
    sheet.getRange(firstDataRow, 1, maxRowsClear - firstDataRow + 1, maxColsClear).clearDataValidations();
    sheet.getRange(firstDataRow, 1, maxRowsClear - firstDataRow + 1, maxColsClear).clearContent();
  }
  writeFuHeader_(sheet);
  if (out.length) {
    FU_TEXT_COLS.forEach(function (c) { sheet.getRange(2, c, out.length, 1).setNumberFormat("@"); });
    sheet.getRange(2, 1, out.length, FU_HEADERS.length).setValues(out);
  }
}

function applyFuFormatting_(sheet) {
  var rows = sheet.getLastRow() - 1;
  if (rows < 1) return;

  FU_TEXT_COLS.forEach(function (c) { sheet.getRange(2, c, rows, 1).setNumberFormat("@"); });

  var list = function (arr) {
    return SpreadsheetApp.newDataValidation().requireValueInList(arr, true).setAllowInvalid(false).build();
  };
  var dateRule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
    .setHelpText("اختر التاريخ من التقويم أو اكتبه مع الوقت مثل: 05/11/2026 03:30 PM").build();

  for (var r = 1; r <= FU_ROUNDS; r++) {
    sheet.getRange(2, fuCol_(r, F_STATUS), rows, 1).setDataValidation(list(FU_STATUSES));
    sheet.getRange(2, fuCol_(r, F_EMP), rows, 1).setDataValidation(list(FU_EMPLOYEES));
    if (FU_ACTIONS.length) sheet.getRange(2, fuCol_(r, F_ACTION), rows, 1).setDataValidation(list(FU_ACTIONS));

    var dr = sheet.getRange(2, fuCol_(r, F_DATE), rows, 1);
    dr.setDataValidation(dateRule);
    dr.setNumberFormat(FU_DATE_FORMAT);

    sheet.getRange(2, fuCol_(r, F_NOTES), rows, 1).setWrap(true);
    sheet.getRange(1, fuCol_(r, 0), rows + 1, FU_ROUND_FIELDS.length)
      .setBorder(null, true, null, true, null, null, "#7f7f7f", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

function updateFollowUps_(ss, filtered) {
  var sheet = resolveFollowUpsSheet_(ss);
  var N = FU_HEADERS.length;
  if (sheet.getMaxColumns() < N) sheet.insertColumnsAfter(sheet.getMaxColumns(), N - sheet.getMaxColumns());

  migrateFollowUps_(sheet);

  var byId = {};
  filtered.forEach(function (r) {
    var dispId = String(resDisplayId_(r));
    var rawId = String(resId_(r));
    if (dispId) byId[dispId] = r;
    if (rawId && !byId[rawId]) byId[rawId] = r;
  });

  var last = sheet.getLastRow();
  var existing = {};
  var refreshed = null;
  if (last > 1) {
    if (FU_REFRESH_EXISTING) {
      refreshed = sheet.getRange(2, 1, last - 1, FU_N_SYS).getValues();
      refreshed.forEach(function (row, i) {
        var id = String(row[0]).trim();
        if (!id) return;
        existing[id] = true;
        if (byId[id]) {
          var matched = byId[id];
          existing[String(resDisplayId_(matched))] = true;
          existing[String(resId_(matched))] = true;
          refreshed[i] = fuSysCols_(matched);
        }
      });
    } else {
      sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (row) {
        var id = String(row[0]).trim();
        if (id) {
          existing[id] = true;
          if (byId[id]) {
            existing[String(resDisplayId_(byId[id]))] = true;
            existing[String(resId_(byId[id]))] = true;
          }
        }
      });
    }
  }

  var emptyAgent = FU_AGENT.map(function () { return ""; });
  var newRows = [];
  filtered.forEach(function (r) {
    var dispId = String(resDisplayId_(r));
    var rawId = String(resId_(r));
    if ((!dispId && !rawId) || existing[dispId] || existing[rawId]) return;
    if (dispId) existing[dispId] = true;
    if (rawId) existing[rawId] = true;
    newRows.push(fuSysCols_(r).concat(emptyAgent));
  });

  var n = newRows.length;
  if (n > 0) {
    sheet.insertRowsAfter(1, n);
    var target = sheet.getRange(2, 1, n, N);
    target.clearFormat();
    target.clearDataValidations();
    applyFuFormatting_(sheet);
    sheet.getRange(2, 1, n, N).setValues(newRows);
  } else if (last === 1) {
    applyFuFormatting_(sheet);
  }

  if (refreshed && refreshed.length) sheet.getRange(2 + n, 1, refreshed.length, FU_N_SYS).setValues(refreshed);

  return n;
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var shName = sh.getName();
    if (shName !== "FollowUps" && shName !== "FollowUps_Sheet") return;
    if (String(sh.getRange(1, 1).getValue() || "").trim() !== FU_HEADERS[0]) return;

    var r1 = e.range.getRow(), r2 = r1 + e.range.getNumRows() - 1;
    var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    if (r2 < 2) return;
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.value === undefined) return;

    var start = Math.max(r1, 2), cnt = r2 - start + 1;
    if (cnt > 200) return;

    for (var r = 1; r <= FU_ROUNDS; r++) {
      var touched = [F_STATUS, F_EMP, F_ACTION, F_NOTES].some(function (f) {
        var c = fuCol_(r, f);
        return c >= c1 && c <= c2;
      });
      if (!touched) continue;

      var dr = sh.getRange(start, fuCol_(r, F_DATE), cnt, 1);
      var vals = dr.getValues();
      var now = new Date(), changed = false;
      vals.forEach(function (v, i) { if (v[0] === "" || v[0] === null) { vals[i][0] = now; changed = true; } });
      if (changed) {
        dr.setNumberFormat(FU_DATE_FORMAT);
        dr.setValues(vals);
      }
    }
  } catch (err) {}
}

/* ---------- الرئيسية ---------- */

function fetchBookingsFromAPI(customStartKey, opts) {
  var options = (opts && typeof opts === "object") ? opts : {};
  var token = getToken_();
  if (!token) {
    var emptyMsg = "التوكن فارغ أو غير محفوظ في إعدادات السكربت. من القائمة اختر: حفظ التوكن، ثم الصق توكن Rental Gate.";
    notify_(emptyMsg, { toastOnly: true, title: "تنبيه التوكن", noAlert: true });
    return { success: false, error: "EMPTY_TOKEN", message: emptyMsg };
  }
  if (!isValidJwtLikeToken_(token)) {
    var invalidMsg = "صيغة التوكن غير صحيحة (يجب أن يبدأ بـ eyJ). من القائمة اختر: حفظ التوكن وأعد لصقه.";
    notify_(invalidMsg, { toastOnly: true, title: "تنبيه التوكن", noAlert: true });
    return { success: false, error: "INVALID_TOKEN", message: invalidMsg };
  }

  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (ssErr) {
    ss = null;
  }
  if (!ss) {
    var ssMsg = "تعذر الوصول إلى جدول البيانات النشط.";
    Logger.log(ssMsg);
    return { success: false, error: "NO_SPREADSHEET", message: ssMsg };
  }

  UNMAPPED = {};
  var t0 = Date.now();
  var effectiveStartKey = Number(customStartKey) || START_KEY;

  try {
    var fetched = fetchBothParallel_(token);
    var reservations = fetched.reservations || [];
    var allExt = fetched.extensions || [];

    var hasAnyExt = {};
    allExt.forEach(function (e) { hasAnyExt[String(pick_(e, ["reservationId"]))] = true; });

    var extensions = allExt.filter(extAllowed_);

    var excluded = EXCLUDE_STATUSES.map(function (s) { return normalizeEnumKey_(s); });
    var filtered = reservations.filter(function (r) {
      var resDateVal = pick_(r, ["reservationDate", "createdAt", "created_at", "startDate"]);
      if (effectiveStartKey > 0 && dateKey_(resDateVal) < effectiveStartKey) return false;
      var stKey = normalizeEnumKey_(rawStatusOf_(r));
      return excluded.indexOf(stKey) === -1;
    });
    filtered.sort(function (a, b) { return Number(resId_(b)) - Number(resId_(a)); });

    var statusCount = {};
    var statusCountAr = {};
    filtered.forEach(function (r) {
      var rawVal = rawStatusOf_(r);
      var rawSt = String(rawVal || "").trim();
      var arSt = rawSt ? (map_(STATUS_AR, rawSt, "حالة الحجز") || rawSt) : "غير محدد";
      var statKey = rawSt || "?";
      statusCount[statKey] = (statusCount[statKey] || 0) + 1;
      statusCountAr[arSt] = (statusCountAr[arSt] || 0) + 1;
    });

    var extByRes = {};
    extensions.forEach(function (e) {
      var k = String(pick_(e, ["reservationId"]));
      (extByRes[k] = extByRes[k] || []).push(e);
    });
    Object.keys(extByRes).forEach(function (k) {
      extByRes[k].sort(function (a, b) { return Number(extId_(a)) - Number(extId_(b)); });
    });

    var rows = [], used = {}, extCount = 0;
    filtered.forEach(function (r, i) {
      var id = String(resId_(r));
      var exts = extByRes[id] || [];
      var flag = (r.extended === true) || !!hasAnyExt[id];
      rows.push(resRow_(r, i + 1, exts, flag));
      exts.forEach(function (e) { rows.push(extRow_(e, false)); extCount++; });
      used[id] = true;
    });

    extensions.forEach(function (e) {
      if (used[String(pick_(e, ["reservationId"]))]) return;
      if (dateKey_(extDate_(e)) >= effectiveStartKey) { rows.push(extRow_(e, true)); extCount++; }
    });

    var dataSheet = ss.getSheetByName("Data") || ss.insertSheet("Data");
    var dataFirstRow = Math.max(2, (typeof dataSheet.getFrozenRows === 'function' ? Number(dataSheet.getFrozenRows() || 0) : 1) + 1);
    var reqDataRows = Math.max(dataFirstRow, dataFirstRow + rows.length - 1);
    if (typeof ensureSheetCapacity_ === 'function') {
      ensureSheetCapacity_(dataSheet, reqDataRows, DATA_HEADERS.length);
    } else {
      if (dataSheet.getMaxColumns() < DATA_HEADERS.length) dataSheet.insertColumnsAfter(dataSheet.getMaxColumns(), DATA_HEADERS.length - dataSheet.getMaxColumns());
      if (dataSheet.getMaxRows() < reqDataRows) dataSheet.insertRowsAfter(dataSheet.getMaxRows(), reqDataRows - dataSheet.getMaxRows());
    }
    var existingDataLast = dataSheet.getLastRow();
    if (existingDataLast >= dataFirstRow) {
      dataSheet.getRange(dataFirstRow, 1, existingDataLast - dataFirstRow + 1, Math.max(dataSheet.getLastColumn(), DATA_HEADERS.length)).clearContent();
    }
    dataSheet.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]).setFontWeight("bold");
    dataSheet.setFrozenRows(1);
    if (rows.length > 0) {
      [2, 3, 9, 10, 11, 12, 13].forEach(function (c) {
        dataSheet.getRange(dataFirstRow, c, rows.length, 1).setNumberFormat("@");
      });
      dataSheet.getRange(dataFirstRow, 1, rows.length, DATA_HEADERS.length).setValues(rows);
    }

    var added = updateFollowUps_(ss, filtered);
    var sec = ((Date.now() - t0) / 1000).toFixed(1);

    var statusLines = Object.keys(statusCount).map(function (k) {
      var arLabel = STATUS_AR[normalizeEnumKey_(k)] || k;
      return (arLabel !== k ? (arLabel + " (" + k + ")") : arLabel) + " = " + statusCount[k];
    });

    var msg = "تم السحب والتحديث خلال " + sec + " ثانية ⚡\n" +
              "مسحوب من الـ API (الكل): " + reservations.length + " حجز و " + allExt.length + " تمديد\n" +
              "تابة Data: " + filtered.length + " حجز + " + extCount + " تمديد\n" +
              "تابة المتابعة: أضيف " + added + " حجز جديد (في الأعلى)\n\n" +
              "الحجوزات حسب الحالة:\n" +
              statusLines.join("\n");
    var un = Object.keys(UNMAPPED);
    if (un.length) msg += "\n\nقيم إنجليزية بدون ترجمة (أرسلها لي):\n" + un.join("\n");
    notify_(msg, { noAlert: Boolean(options.silent), toastOnly: Boolean(options.silent) });
    return {
      success: true,
      totalFetched: reservations.length,
      extensionsFetched: allExt.length,
      filteredCount: filtered.length,
      addedFollowUps: added,
      statusCounts: statusCount,
      statusCountsAr: statusCountAr,
      unmapped: un,
      durationSeconds: Number(sec)
    };
  } catch (e) {
    var errCode = (e && e.code) ? e.code : "SYNC_ERROR";
    var errMsg = "خطأ أثناء السحب: " + (e && e.message ? e.message : String(e));
    notify_(errMsg, { toastOnly: true, title: "فشل السحب", noAlert: true });
    return { success: false, error: errCode, message: errMsg };
  }
}

function fetchBookingsCustomDateFromUI() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "سحب الحجوزات من تاريخ معين",
    "أدخل تاريخ البداية بصيغة YYYY-MM-DD (مثال: 2026-11-10):",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var raw = String(resp.getResponseText() || "").trim();
  var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    notify_("صيغة التاريخ غير صحيحة. يجب أن تكون YYYY-MM-DD مثل 2026-11-10", { toastOnly: true, noAlert: true });
    return;
  }
  var key = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return fetchBookingsFromAPI(key);
}

/* ---------- للتشخيص فقط ---------- */

function debugRaw() {
  var token = getToken_();
  if (!isValidJwtLikeToken_(token)) {
    Logger.log("debugRaw skipped: token missing or invalid");
    return { success: false, error: token ? "INVALID_TOKEN" : "EMPTY_TOKEN" };
  }
  [RES_URL, EXT_URL].forEach(function (u) {
    var res = UrlFetchApp.fetch(u + "?page=" + FIRST_PAGE + "&size=2", {
      method: "get",
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json", "lang": "ar" },
      muteHttpExceptions: true
    });
    Logger.log(u + "\nكود: " + res.getResponseCode() + "\n" + res.getContentText().substring(0, 4000));
  });
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("إدارة المتابعات 🚀")
    .addItem("سحب الحجوزات المباشرة من المنصة", "fetchBookingsFromAPI")
    .addItem("سحب الحجوزات من تاريخ معين...", "fetchBookingsCustomDateFromUI")
    .addItem("حفظ التوكن", "setToken")
    .addToUi();
}
