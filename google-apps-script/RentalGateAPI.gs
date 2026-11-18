/**
 * RENTAL GATE CRM — Rental Gate API Integration & Batch Sync Engine
 * Token is stored strictly in Script Properties: RG_TOKEN (never exposed to clients)
 */

var RG_RESERVATIONS_API = 'https://api.rentalgate.net/api/reservations/filter';
var RG_EXTENDS_API = 'https://api.rentalgate.net/api/reservation-extends/filter';

function getRgToken() {
  var props = PropertiesService.getScriptProperties();
  return normalizeStr(props.getProperty('RG_TOKEN') || props.getProperty('RENTAL_TOKEN'));
}

function buildRentalGateRequest_(url, token, pageZeroBased, size) {
  var pageNum = pageZeroBased !== undefined && pageZeroBased !== null ? Math.max(0, Number(pageZeroBased) || 0) : 0;
  var pageSize = size ? Math.max(1, Number(size) || 100) : 100;
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  return {
    url: url + sep + 'page=' + encodeURIComponent(pageNum) + '&size=' + encodeURIComponent(pageSize),
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      lang: 'ar'
    },
    muteHttpExceptions: true
  };
}

function parseRentalGateResponse_(res) {
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('خطأ من Rental Gate API (' + code + '): ' + text.substring(0, 250));
  }
  return safeJsonParse(text, {});
}

function extractPagePayload_(body, pageIndex) {
  var rows = [];
  var totalPages = 1;
  var isLast = true;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && Array.isArray(body.content)) {
    rows = body.content;
    totalPages = toNumber(body.totalPages, 1);
    isLast = body.last === true || (pageIndex + 1) >= totalPages;
  } else if (body && body.data) {
    if (Array.isArray(body.data)) {
      rows = body.data;
      totalPages = toNumber((body.meta && body.meta.last_page) || (body.pagination && body.pagination.last_page) || body.last_page, 1);
      isLast = (pageIndex + 1) >= totalPages;
    } else if (Array.isArray(body.data.content)) {
      rows = body.data.content;
      totalPages = toNumber(body.data.totalPages, 1);
      isLast = body.data.last === true || (pageIndex + 1) >= totalPages;
    } else if (Array.isArray(body.data.data)) {
      rows = body.data.data;
      totalPages = toNumber(body.data.last_page || (body.data.meta && body.data.meta.last_page) || (body.data.pagination && body.data.pagination.last_page), 1);
      isLast = (pageIndex + 1) >= totalPages;
    }
  } else if (body && Array.isArray(body.items)) {
    rows = body.items;
    totalPages = toNumber((body.meta && body.meta.last_page) || (body.pagination && body.pagination.last_page) || body.last_page, 1);
    isLast = (pageIndex + 1) >= totalPages;
  }
  return { rows: rows, totalPages: totalPages, isLast: isLast };
}

function callRentalGateEndpoint(url, token, pageZeroBased, size) {
  var req = buildRentalGateRequest_(url, token, pageZeroBased, size);
  var res = UrlFetchApp.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    muteHttpExceptions: true
  });
  return parseRentalGateResponse_(res);
}

function fetchAllRentalGatePages(url, token) {
  var allItems = [];
  var maxPages = 100;
  var pageSize = 100;

  // Fetch page 0 first to discover totalPages
  var firstBody = callRentalGateEndpoint(url, token, 0, pageSize);
  var pagesFetched = 1;
  var firstInfo = extractPagePayload_(firstBody, 0);
  for (var f = 0; f < firstInfo.rows.length; f++) {
    allItems.push(firstInfo.rows[f]);
  }

  if (firstInfo.isLast || firstInfo.rows.length === 0 || firstInfo.totalPages <= 1) {
    return { items: allItems, pagesFetched: pagesFetched };
  }

  var lastPageIdx = Math.min(firstInfo.totalPages - 1, maxPages - 1);
  var batchSize = 10;
  for (var startPage = 1; startPage <= lastPageIdx; startPage += batchSize) {
    var endPage = Math.min(startPage + batchSize - 1, lastPageIdx);
    var reqs = [];
    for (var p = startPage; p <= endPage; p++) {
      reqs.push(buildRentalGateRequest_(url, token, p, pageSize));
    }
    var responses = UrlFetchApp.fetchAll(reqs);
    pagesFetched += responses.length;
    var stopEarly = false;
    for (var r = 0; r < responses.length; r++) {
      var info = extractPagePayload_(parseRentalGateResponse_(responses[r]), startPage + r);
      for (var k = 0; k < info.rows.length; k++) {
        allItems.push(info.rows[k]);
      }
      if (info.rows.length === 0) stopEarly = true;
    }
    if (stopEarly) break;
  }

  return { items: allItems, pagesFetched: pagesFetched };
}

function fetchBothEndpointsParallel_(resUrl, extUrl, token) {
  var maxPages = 100;
  var pageSize = 100;

  // Round 1: fetch page 0 of both reservations and extensions in parallel
  var firstBatch = UrlFetchApp.fetchAll([
    buildRentalGateRequest_(extUrl, token, 0, pageSize),
    buildRentalGateRequest_(resUrl, token, 0, pageSize)
  ]);

  var extInfo0 = extractPagePayload_(parseRentalGateResponse_(firstBatch[0]), 0);
  var resInfo0 = extractPagePayload_(parseRentalGateResponse_(firstBatch[1]), 0);

  var extItems = extInfo0.rows.slice();
  var resItems = resInfo0.rows.slice();
  var pagesFetched = 2;

  var remainingReqs = [];
  var remainingMeta = [];

  if (!extInfo0.isLast && extInfo0.rows.length > 0 && extInfo0.totalPages > 1) {
    var extLast = Math.min(extInfo0.totalPages - 1, maxPages - 1);
    for (var ep = 1; ep <= extLast; ep++) {
      remainingReqs.push(buildRentalGateRequest_(extUrl, token, ep, pageSize));
      remainingMeta.push({ kind: 'ext', page: ep });
    }
  }
  if (!resInfo0.isLast && resInfo0.rows.length > 0 && resInfo0.totalPages > 1) {
    var resLast = Math.min(resInfo0.totalPages - 1, maxPages - 1);
    for (var rp = 1; rp <= resLast; rp++) {
      remainingReqs.push(buildRentalGateRequest_(resUrl, token, rp, pageSize));
      remainingMeta.push({ kind: 'res', page: rp });
    }
  }

  // Round 2+: fetch all remaining pages in larger parallel batches of 20
  var batchSize = 20;
  for (var start = 0; start < remainingReqs.length; start += batchSize) {
    var reqChunk = remainingReqs.slice(start, start + batchSize);
    var metaChunk = remainingMeta.slice(start, start + batchSize);
    var responses = UrlFetchApp.fetchAll(reqChunk);
    pagesFetched += responses.length;
    for (var i = 0; i < responses.length; i++) {
      var info = extractPagePayload_(parseRentalGateResponse_(responses[i]), metaChunk[i].page);
      var targetArr = metaChunk[i].kind === 'ext' ? extItems : resItems;
      for (var k = 0; k < info.rows.length; k++) {
        targetArr.push(info.rows[k]);
      }
    }
  }

  return {
    extensions: extItems,
    reservations: resItems,
    pagesFetched: pagesFetched
  };
}

function saveApiToken(session, payload) {
  requireApiAccess(session);
  var p = payload || {};
  var raw = normalizeStr(p.token || p.rgToken || p.rentalToken).replace(/^Bearer\s+/i, '');
  if (!raw || raw.length < 16 || /\s/.test(raw)) {
    throw new Error('صيغة التوكن غير صالحة. يرجى لصق التوكن كاملاً بدون مسافات.');
  }

  PropertiesService.getScriptProperties().setProperties({
    RG_TOKEN: raw,
    RENTAL_TOKEN: raw
  });

  logActivity(
    session.user,
    'تحديث توكن API',
    'Settings',
    'RG_TOKEN',
    'تم ربط وحفظ RG_TOKEN وRENTAL_TOKEN في Script Properties'
  );

  var result = {
    saved: true,
    hasToken: true,
    hasRgToken: true
  };
  if (toBool(p.testAfterSave)) {
    result.connection = testRentalGateConnection(session);
  }
  return result;
}

function setupRentalGateTokens(token) {
  var clean = normalizeStr(token).replace(/^Bearer\s+/i, '');
  if (!clean) {
    throw new Error('يرجى تمرير التوكن للدالة setupRentalGateTokens(token).');
  }
  PropertiesService.getScriptProperties().setProperties({
    RG_TOKEN: clean,
    RENTAL_TOKEN: clean
  });
  return { saved: true, keys: ['RG_TOKEN', 'RENTAL_TOKEN'] };
}

function testRentalGateConnection(session) {
  requireApiAccess(session);
  var token = getRgToken();
  if (!token) {
    return {
      connected: false,
      hasToken: false,
      message: 'مفتاح RG_TOKEN غير مضبوط في Script Properties.'
    };
  }
  try {
    callRentalGateEndpoint(RG_RESERVATIONS_API, token, 0, 1);
    return {
      connected: true,
      hasToken: true,
      checkedAt: nowIso(),
      message: 'الاتصال بواجهة Rental Gate API ناجح ويعمل بشكل سليم.'
    };
  } catch (err) {
    return {
      connected: false,
      hasToken: true,
      checkedAt: nowIso(),
      message: err.message
    };
  }
}

function serializeReservationForClient_(sr, isFollowedFlag) {
  var daysCnt = toNumber(sr.daysCount, 1);
  var extDaysCnt = toNumber(sr.extendedDaysCount, 0);
  var totalDaysCnt = toNumber(sr.totalDaysCount, daysCnt + extDaysCnt);
  return {
    id: sr.id,
    sourceReservationId: sr.sourceReservationId || sr.reservationNumber || '',
    reservationNumber: sr.reservationNumber,
    sourceCreatedAt: sr.sourceCreatedAt || sr.createdAt || '',
    customerName: sr.customerName,
    customerPhone: sr.customerPhone,
    customerEmail: sr.customerEmail || '',
    customerIdNumber: sr.customerIdNumber || '',
    companyName: sr.companyName,
    branchName: sr.branchName,
    deliverBranchName: sr.deliverBranchName || sr.branchName || '',
    carName: sr.carName,
    plateNumber: sr.plateNumber,
    carCategory: sr.carCategory || '',
    startDate: sr.startDate,
    startTime: sr.startTime || '',
    originalEndDate: sr.originalEndDate || sr.endDate || '',
    originalEndTime: sr.originalEndTime || sr.endTime || '',
    endDate: sr.endDate,
    endTime: sr.endTime || '',
    extendedUntilDate: sr.extendedUntilDate || '',
    extendedUntilTime: sr.extendedUntilTime || '',
    daysCount: daysCnt,
    extendedDaysCount: extDaysCnt,
    totalDaysCount: totalDaysCnt,
    originalStatusCode: sr.originalStatusCode,
    originalStatusAr: sr.originalStatusAr,
    pickupTypeAr: sr.pickupTypeAr,
    returnTypeAr: sr.returnTypeAr,
    paymentMethod: sr.paymentMethod || '',
    paymentStatus: sr.paymentStatus || '',
    dailyPrice: toNumber(sr.dailyPrice, 0),
    discountAmount: toNumber(sr.discountAmount, 0),
    vatAmount: toNumber(sr.vatAmount, 0),
    baseAmount: toNumber(sr.baseAmount, 0),
    extensionsCount: toNumber(sr.extensionsCount, 0),
    extensionsAmount: toNumber(sr.extensionsAmount, 0),
    totalAmount: toNumber(sr.totalAmount, 0),
    hasExtensions: toBool(sr.hasExtensions),
    internalStatus: sr.internalStatus,
    priority: sr.priority,
    assignedEmployeeIds: safeJsonParse(sr.assignedEmployeeIds, []),
    assignedEmployeeNames: safeJsonParse(sr.assignedEmployeeNames, []),
    lastUpdateText: sr.lastUpdateText,
    lastUpdatedById: sr.lastUpdatedById,
    lastUpdatedByName: sr.lastUpdatedByName,
    lastUpdatedAt: sr.lastUpdatedAt,
    hasProblem: toBool(sr.hasProblem),
    createdAt: sr.createdAt || '',
    updatedAt: sr.updatedAt || '',
    statusHistory: normalizeStatusHistory_(sr.statusHistory),
    isFollowed: Boolean(isFollowedFlag)
  };
}

function syncRentalGate(session, payload) {
  requireApiAccess(session);
  var reqRange = resolvePullDateRange_(payload);
  if (reqRange.hasCustomRange && session.role !== RG_ROLES.GENERAL_MANAGER) {
    throw new Error('FORBIDDEN: تخصيص مدة أو تاريخ السحب متاح للمدير العام فقط.');
  }
  return runRentalGateSyncInternal({
    id: session.employeeId,
    employeeId: session.employeeId,
    name: session.user.name,
    role: session.role
  }, payload);
}

function pullReservations(session, payload) {
  requirePermission(session, 'pull_reservations');
  var reqRange = resolvePullDateRange_(payload);
  if (reqRange.hasCustomRange && session.role !== RG_ROLES.GENERAL_MANAGER) {
    throw new Error('FORBIDDEN: تخصيص مدة أو تاريخ السحب متاح للمدير العام فقط.');
  }
  var syncResult = runRentalGateSyncInternal({
    id: session.employeeId,
    employeeId: session.employeeId,
    name: session.user.name,
    role: session.role
  }, payload);
  return {
    importedCount: syncResult.importedCount || 0,
    updatedCount: syncResult.updatedCount || 0,
    extensionsCount: syncResult.extensionsCount || 0,
    pagesFetched: syncResult.pagesFetched || 0,
    durationMs: syncResult.durationMs || 0,
    finishedAt: syncResult.finishedAt || nowIso(),
    appliedRange: syncResult.appliedRange || { preset: 'all', dateFrom: '', dateTo: '', hasCustomRange: false },
    changedReservations: syncResult.changedReservations || []
  };
}

function runRentalGateSyncInternal(actor, options) {
  var token = getRgToken();
  if (!token) {
    throw new Error('لم يتم ضبط RG_TOKEN في Script Properties.');
  }

  var actorId = (actor && (actor.employeeId || actor.id)) || 'SYSTEM';
  var actorName = (actor && actor.name) || 'المزامنة التلقائية';
  var actorObj = { id: actorId, name: actorName, role: (actor && actor.role) || 'system' };
  var appliedRange = resolvePullDateRange_(options);

  var startedAt = nowIso();
  var startMs = Date.now();

  return withScriptLock(function () {
    var importedCount = 0;
    var updatedCount = 0;
    var extensionsCount = 0;
    var pagesFetched = 0;

    try {
      var excludedSetting = findRecordById(RG_SHEETS.SETTINGS, 'key', 'excluded_statuses');
      var excludedStatuses = safeJsonParse(excludedSetting ? excludedSetting.value : '[]', []);
      var excludedSet = {};
      for (var e = 0; e < excludedStatuses.length; e++) {
        excludedSet[normalizeStr(excludedStatuses[e]).toLowerCase()] = true;
      }

      // 1. Fetch extensions & reservations in parallel batches via UrlFetchApp.fetchAll()
      var parallelFetch = fetchBothEndpointsParallel_(RG_RESERVATIONS_API, RG_EXTENDS_API, token);
      pagesFetched += parallelFetch.pagesFetched;

      var existingExtensions = readAllRecords(RG_SHEETS.EXTENSIONS, true);
      var existingExtByNum = {};
      for (var exi = 0; exi < existingExtensions.length; exi++) {
        var ek = normalizeStr(existingExtensions[exi].extensionNumber);
        if (ek) existingExtByNum[ek] = existingExtensions[exi];
      }

      var extRecordsToUpsert = [];
      var extSeenMap = {};
      var extByResNumber = {};
      var extByResId = {};

      for (var x = 0; x < parallelFetch.extensions.length; x++) {
        var ext = parallelFetch.extensions[x];
        if (!isExtensionAcceptedAndPaid(ext)) continue;

        var extNum = normalizeStr(ext.extendId || ext.id || ext.extension_number || ext.code);
        var resIdForExt = normalizeStr(ext.reservationId || ext.reservation_id || (ext.reservation && ext.reservation.id));
        var resNumForExt = normalizeStr(ext.reservationNumber || ext.reservation_number || (ext.reservation && ext.reservation.reservation_number) || resIdForExt);
        if (!resNumForExt && !resIdForExt) continue;
        if (!extNum) extNum = (resNumForExt || resIdForExt) + '_EXT_' + (x + 1);
        if (extSeenMap[extNum]) continue;
        extSeenMap[extNum] = true;

        var prevExt = existingExtByNum[extNum];
        var extStatusRaw = normalizeStr(ext.reservationStatus || ext.status || 'paid');
        var extPayRaw = normalizeStr(ext.payment_status || ext.paymentStatus || ext.paymentResult || (ext.paymentDate ? 'paid' : ext.paymentType) || 'paid');
        var extTypeRaw = normalizeStr(ext.extensionType || ext.extension_type || ext.type);
        var rawExtStart = ext.extendDate || ext.startDate || ext.start_date || ext.from_date || ext.createdAt;
        var extStartDate = formatDateOnly(rawExtStart);
        var extStartTime = normalizeStr(ext.startTime) || extractTimeHM_(rawExtStart);
        var extDaysVal = toNumber(ext.extendDays !== undefined ? ext.extendDays : (ext.days !== undefined ? ext.days : ext.extend_days), 0);
        var rawExtEnd = ext.newEndDate || ext.actualEndDate || ext.endDate || ext.end_date || ext.to_date;
        var extEndDate = formatDateOnly(rawExtEnd);
        var extEndTime = normalizeStr(ext.endTime) || extractTimeHM_(rawExtEnd) || extStartTime;
        if (!extEndDate && extStartDate && extDaysVal > 0) {
          extEndDate = shiftIsoDateDays_(extStartDate, extDaysVal);
        }
        if (extDaysVal <= 0 && extStartDate && extEndDate) {
          extDaysVal = computeDateDiffDays_(extStartDate, extEndDate);
        }
        var extSubTotal = Math.round(toNumber(ext.subTotal !== undefined ? ext.subTotal : ext.subtotal, 0) * 100) / 100;
        var extVatAmt = Math.round(toNumber(ext.vatAmount !== undefined ? ext.vatAmount : ext.vat, 0) * 100) / 100;
        var extTotalAmt = Math.round(toNumber(ext.total !== undefined ? ext.total : (ext.amount !== undefined ? ext.amount : ext.price), 0) * 100) / 100;

        var extRecord = {
          id: prevExt ? prevExt.id : generateId('EXT'),
          extensionNumber: extNum,
          sequenceNumber: prevExt ? toNumber(prevExt.sequenceNumber, 1) : 1,
          reservationId: prevExt && prevExt.reservationId ? prevExt.reservationId : resIdForExt,
          reservationNumber: resNumForExt || resIdForExt,
          sourceReservationId: resIdForExt || resNumForExt,
          extensionType: extTypeRaw,
          extensionTypeAr: translateExtensionType_(extTypeRaw),
          statusCode: extStatusRaw,
          statusAr: translateOriginalStatus(extStatusRaw),
          paymentStatus: extPayRaw,
          paymentDate: ext.paymentDate ? formatDateTimeDisplay_(ext.paymentDate) : '',
          paymentMethod: normalizeStr(ext.paymentType || ext.paymentMethod),
          extendDays: Math.max(0, extDaysVal),
          startDate: extStartDate,
          startTime: extStartTime,
          endDate: extEndDate,
          endTime: extEndTime,
          subTotal: extSubTotal,
          vatAmount: extVatAmt,
          amount: extTotalAmt,
          isAcceptedAndPaid: 'true',
          syncedAt: nowIso()
        };

        extRecordsToUpsert.push(extRecord);
        if (resNumForExt) {
          if (!extByResNumber[resNumForExt]) extByResNumber[resNumForExt] = [];
          extByResNumber[resNumForExt].push(extRecord);
        }
        if (resIdForExt) {
          if (!extByResId[resIdForExt]) extByResId[resIdForExt] = [];
          extByResId[resIdForExt].push(extRecord);
        }
      }

      // 2. Apply Manager custom pull date filter (if requested), deduplicate, preserve & advance statusHistory
      var resItems = filterSourceReservationsByPullRange_(parallelFetch.reservations, appliedRange);

      var existingReservations = readAllRecords(RG_SHEETS.RESERVATIONS, true);
      var existingByNumber = {};
      for (var r = 0; r < existingReservations.length; r++) {
        var rKey = normalizeStr(existingReservations[r].reservationNumber);
        if (rKey) existingByNumber[rKey] = existingReservations[r];
      }

      var resSeenMap = {};
      var resRecordsToUpsert = [];
      var statusChangeHistoryBatch = [];
      var changedReservations = [];
      var nowStr = nowIso();

      for (var i = 0; i < resItems.length; i++) {
        var item = resItems[i];
        var resApiId = normalizeStr(item.reservationId || item.id);
        var resNumber = normalizeStr(item.reservationNumber || item.reservation_number || item.code || item.reference || resApiId);
        if (!resNumber || resSeenMap[resNumber]) continue;
        resSeenMap[resNumber] = true;

        var statusCode = normalizeStr(item.reservationStatus || item.status || item.status_code).toLowerCase().replace(/\s+/g, '_');
        if (excludedSet[statusCode]) continue;

        var combinedExts = [];
        var extSeenForRes = {};
        var byNumList = extByResNumber[resNumber] || [];
        var byIdList = resApiId ? (extByResId[resApiId] || []) : [];
        var mergedLists = byNumList.concat(byIdList);
        for (var m = 0; m < mergedLists.length; m++) {
          var candExt = mergedLists[m];
          if (!extSeenForRes[candExt.extensionNumber]) {
            extSeenForRes[candExt.extensionNumber] = true;
            combinedExts.push(candExt);
          }
        }

        var existing = existingByNumber[resNumber];
        var resId = existing ? existing.id : generateId('RES');

        var rawStart = item.startDate || item.start_date || item.pickup_date;
        var rawOrigEnd = item.endDate || item.end_date || item.return_date || item.actualEndDate;
        var rawActualEnd = item.actualEndDate || rawOrigEnd;

        var startDateVal = formatDateOnly(rawStart);
        var startTimeVal = normalizeStr(item.startTime) || extractTimeHM_(rawStart);
        var originalEndDateVal = formatDateOnly(rawOrigEnd);
        var originalEndTimeVal = normalizeStr(item.originalEndTime || item.endTime) || extractTimeHM_(rawOrigEnd);

        var extSummary = summarizeReservationExtensions_(
          combinedExts,
          item,
          rawActualEnd,
          extractTimeHM_(rawActualEnd) || originalEndTimeVal
        );

        for (var k = 0; k < extSummary.extensions.length; k++) {
          extSummary.extensions[k].reservationId = resId;
          extSummary.extensions[k].sourceReservationId = resApiId || resNumber;
          extSummary.extensions[k].reservationNumber = resNumber;
        }

        var effectiveEndDate = extSummary.extendedUntilDate || formatDateOnly(rawActualEnd) || originalEndDateVal;
        var effectiveEndTime = extSummary.extendedUntilTime || extractTimeHM_(rawActualEnd) || originalEndTimeVal;

        var baseDays = toNumber(item.reservationDays || item.days_count || item.days, 0);
        if (baseDays <= 0 && startDateVal && originalEndDateVal) {
          baseDays = Math.max(1, computeDateDiffDays_(startDateVal, originalEndDateVal));
        }
        if (baseDays <= 0) baseDays = 1;

        var extendedDaysVal = extSummary.extendedDaysCount;
        if (extendedDaysVal <= 0 && extSummary.extensionsCount > 0 && originalEndDateVal && effectiveEndDate && effectiveEndDate > originalEndDateVal) {
          extendedDaysVal = computeDateDiffDays_(originalEndDateVal, effectiveEndDate);
        }
        var totalDaysVal = baseDays + extendedDaysVal;

        var baseAmount = Math.round(toNumber(item.total !== undefined ? item.total : (item.total_price || item.amount || item.base_amount), 0) * 100) / 100;
        var totalAmount = extSummary.extensions.length > 0
          ? computeTotalAmount(baseAmount, extSummary.extensions)
          : Math.round((baseAmount + extSummary.extensionsAmount) * 100) / 100;

        var customerObj = item.customer || item.user || {};
        var companyObj = item.company || item.partner || {};
        var branchObj = item.branch || item.location || {};
        var carObj = item.car || item.vehicle || {};

        var sourceStatusAr = resolveSourceWorkflowStatus_(item);
        var nextInternalStatus = sourceStatusAr;
        var nextLastUpdateText = 'تم السحب من Rental Gate بالحالة: ' + sourceStatusAr;
        var nextLastUpdatedById = actorId;
        var nextLastUpdatedByName = actorName;
        var nextLastUpdatedAt = nowStr;
        var nextStatusHistory = [];

        if (!existing) {
          nextStatusHistory = appendStatusStageEntry_([], {
            source: 'api_pull',
            previousStatus: '',
            newStatus: sourceStatusAr,
            sourceStatusCode: statusCode,
            changedAt: nowStr,
            changedById: actorId,
            changedByName: actorName,
            note: nextLastUpdateText
          });
        } else {
          var prevHist = normalizeStatusHistory_(existing.statusHistory);
          var prevCode = normalizeStr(existing.originalStatusCode).toLowerCase();
          var prevOrigAr = normalizeStr(existing.originalStatusAr);
          var prevInternal = normalizeStr(existing.internalStatus);
          if (prevHist.length === 0 && (prevInternal || prevOrigAr)) {
            prevHist = appendStatusStageEntry_([], {
              source: 'api_pull',
              previousStatus: '',
              newStatus: prevInternal || prevOrigAr,
              sourceStatusCode: prevCode,
              changedAt: existing.createdAt || existing.lastUpdatedAt || nowStr,
              changedById: existing.lastUpdatedById || 'SYSTEM',
              changedByName: existing.lastUpdatedByName || 'النظام',
              note: 'المرحلة المسجلة قبل التحديث'
            });
          }

          var sourceChanged = Boolean(
            statusCode && (
              (prevCode && statusCode !== prevCode) ||
              (!prevCode && prevOrigAr && sourceStatusAr !== prevOrigAr)
            )
          );

          if (sourceChanged) {
            nextInternalStatus = sourceStatusAr;
            nextLastUpdateText = 'تحديث الحالة من Rental Gate: ' + (prevInternal || prevOrigAr || '-') + ' ← ' + sourceStatusAr;
            nextLastUpdatedById = actorId;
            nextLastUpdatedByName = actorName;
            nextLastUpdatedAt = nowStr;
            nextStatusHistory = appendStatusStageEntry_(prevHist, {
              source: 'api_pull',
              previousStatus: prevInternal || prevOrigAr,
              newStatus: sourceStatusAr,
              sourceStatusCode: statusCode,
              changedAt: nowStr,
              changedById: actorId,
              changedByName: actorName,
              note: nextLastUpdateText
            });
            statusChangeHistoryBatch.push({
              id: generateId('FUH'),
              followUpId: '',
              reservationId: resId,
              reservationNumber: resNumber,
              employeeId: actorId,
              employeeName: actorName,
              changeType: 'api_status_sync',
              previousStatus: prevInternal || prevOrigAr || '',
              newStatus: sourceStatusAr,
              previousAction: existing.lastUpdateText || '',
              newAction: nextLastUpdateText,
              previousNotes: '',
              newNotes: 'تحديث تلقائي للحالة عند إعادة السحب من Rental Gate',
              changedAt: nowStr
            });
          } else {
            nextInternalStatus = prevInternal || sourceStatusAr;
            nextLastUpdateText = existing.lastUpdateText || ('تم السحب من Rental Gate بالحالة: ' + sourceStatusAr);
            nextLastUpdatedById = existing.lastUpdatedById || actorId;
            nextLastUpdatedByName = existing.lastUpdatedByName || actorName;
            nextLastUpdatedAt = existing.lastUpdatedAt || nowStr;
            nextStatusHistory = prevHist;
          }
        }

        var receiveBranchName = normalizeStr(item.receiveBranchArName || item.receiveBranchEnName || item.branch_name || branchObj.name || '');
        var deliverBranchName = normalizeStr(item.deliverBranchArName || item.deliverBranchEnName || item.returnBranchName || receiveBranchName);
        var sourceCreatedRaw = item.reservationDate || item.createdAt || item.created_at || '';

        var resPayload = {
          id: resId,
          sourceReservationId: resApiId || resNumber,
          reservationNumber: resNumber,
          sourceCreatedAt: sourceCreatedRaw ? (formatDateTimeDisplay_(sourceCreatedRaw) || normalizeStr(sourceCreatedRaw)) : '',
          customerName: normalizeStr(item.clientName || item.customer_name || customerObj.name || customerObj.full_name || 'عميل'),
          customerPhone: normalizeStr(item.clientMobile || item.customer_phone || customerObj.phone || customerObj.mobile || ''),
          customerEmail: normalizeStr(item.clientEmail || item.customer_email || customerObj.email || ''),
          customerIdNumber: normalizeStr(item.clientNationalId || item.clientIdNumber || customerObj.idNumber || ''),
          companyName: normalizeStr(item.companyArName || item.companyEnName || item.company_name || companyObj.name || ''),
          branchName: receiveBranchName,
          deliverBranchName: deliverBranchName,
          carName: normalizeStr(item.carNameAr || item.carNameEn || item.car_name || carObj.name || (carObj.brand ? (carObj.brand + ' ' + (carObj.model || '')) : '')),
          plateNumber: normalizeStr(item.plate_number || item.plateNumber || carObj.plate_number || ''),
          carCategory: normalizeStr(item.carCategoryAr || item.carTypeAr || item.carCategory || carObj.category || ''),
          startDate: startDateVal,
          startTime: startTimeVal,
          originalEndDate: originalEndDateVal,
          originalEndTime: originalEndTimeVal,
          endDate: effectiveEndDate,
          endTime: effectiveEndTime,
          extendedUntilDate: extSummary.extendedUntilDate,
          extendedUntilTime: extSummary.extendedUntilTime,
          daysCount: baseDays,
          extendedDaysCount: extendedDaysVal,
          totalDaysCount: totalDaysVal,
          originalStatusCode: statusCode,
          originalStatusAr: translateOriginalStatus(statusCode),
          pickupTypeAr: translateDeliveryType(item.receiveType || item.pickup_type || item.delivery_type),
          returnTypeAr: translateDeliveryType(item.deliverType || item.return_type || item.dropoff_type),
          paymentMethod: normalizeStr(item.paymentType || item.paymentMethod || ''),
          paymentStatus: normalizeStr(item.paymentStatus || item.paymentResult || ''),
          dailyPrice: toNumber(item.dailyPrice || item.dayPrice || item.pricePerDay, 0),
          discountAmount: toNumber(item.discount || item.discountAmount, 0),
          vatAmount: toNumber(item.vat || item.vatAmount || item.tax, 0),
          baseAmount: baseAmount,
          extensionsCount: extSummary.extensionsCount,
          extensionsAmount: extSummary.extensionsAmount,
          totalAmount: totalAmount,
          hasExtensions: (extSummary.extensionsCount > 0 || toBool(item.extended)) ? 'true' : 'false',
          internalStatus: nextInternalStatus,
          priority: existing ? existing.priority : 'عادي',
          assignedEmployeeIds: existing ? existing.assignedEmployeeIds : '[]',
          assignedEmployeeNames: existing ? existing.assignedEmployeeNames : '[]',
          lastUpdateText: nextLastUpdateText,
          lastUpdatedById: nextLastUpdatedById,
          lastUpdatedByName: nextLastUpdatedByName,
          lastUpdatedAt: nextLastUpdatedAt,
          hasProblem: existing ? existing.hasProblem : 'false',
          createdAt: existing ? existing.createdAt : nowStr,
          updatedAt: nowStr,
          statusHistory: JSON.stringify(nextStatusHistory),
          rawJson: JSON.stringify(item).substring(0, 4000)
        };

        resRecordsToUpsert.push(resPayload);
        changedReservations.push(serializeReservationForClient_(resPayload, false));
      }

      var diffOpts = { ignoreDiffKeys: { updatedAt: true, syncedAt: true, rawJson: true } };
      if (extRecordsToUpsert.length > 0) {
        var extResult = batchUpsertRecords(RG_SHEETS.EXTENSIONS, 'extensionNumber', extRecordsToUpsert, diffOpts);
        extensionsCount = extResult.inserted + extResult.updated;
      }

      if (resRecordsToUpsert.length > 0) {
        var resResult = batchUpsertRecords(RG_SHEETS.RESERVATIONS, 'reservationNumber', resRecordsToUpsert, diffOpts);
        importedCount = resResult.inserted;
        updatedCount = resResult.updated;
      }

      if (statusChangeHistoryBatch.length > 0) {
        batchAppendRecords(RG_SHEETS.FOLLOWUP_HISTORY, statusChangeHistoryBatch);
      }

      var syncRecord = {
        id: generateId('SYNC'),
        triggeredById: actorId,
        triggeredByName: actorName,
        status: 'success',
        importedCount: importedCount,
        updatedCount: updatedCount,
        extensionsCount: extensionsCount,
        pagesFetched: pagesFetched,
        errorMessage: '',
        durationMs: Date.now() - startMs,
        startedAt: startedAt,
        finishedAt: nowIso()
      };
      appendRecord(RG_SHEETS.SYNC_LOG, syncRecord);
      var neonSyncMeta = (typeof pushIncrementalSyncToNeonSafe_ === 'function')
        ? pushIncrementalSyncToNeonSafe_(resRecordsToUpsert, extRecordsToUpsert, {
            triggeredById: actorId,
            triggeredByName: actorName,
            pagesFetched: pagesFetched,
            appliedRange: appliedRange
          })
        : { skipped: true };
      if (actorId !== 'SYSTEM' || (importedCount + updatedCount + extensionsCount) > 0) {
        var rangeDesc = appliedRange.hasCustomRange
          ? (' | النطاق: ' + (appliedRange.dateFrom || '-') + ' → ' + (appliedRange.dateTo || '-'))
          : '';
        logActivity(actorObj, 'سحب بيانات', 'Sync', syncRecord.id,
          'استيراد ' + importedCount + '، تحديث ' + updatedCount + '، تمديدات ' + extensionsCount + rangeDesc);
      }

      return {
        id: syncRecord.id,
        triggeredById: syncRecord.triggeredById,
        triggeredByName: syncRecord.triggeredByName,
        status: syncRecord.status,
        importedCount: syncRecord.importedCount,
        updatedCount: syncRecord.updatedCount,
        extensionsCount: syncRecord.extensionsCount,
        pagesFetched: syncRecord.pagesFetched,
        errorMessage: syncRecord.errorMessage,
        durationMs: syncRecord.durationMs,
        startedAt: syncRecord.startedAt,
        finishedAt: syncRecord.finishedAt,
        appliedRange: appliedRange,
        changedReservations: changedReservations,
        neonSync: neonSyncMeta
      };
    } catch (err) {
      var errRecord = {
        id: generateId('SYNC'),
        triggeredById: actorId,
        triggeredByName: actorName,
        status: 'error',
        importedCount: importedCount,
        updatedCount: updatedCount,
        extensionsCount: extensionsCount,
        pagesFetched: pagesFetched,
        errorMessage: err.message,
        durationMs: Date.now() - startMs,
        startedAt: startedAt,
        finishedAt: nowIso()
      };
      appendRecord(RG_SHEETS.SYNC_LOG, errRecord);
      throw err;
    }
  });
}

function getSyncStatus(session) {
  requireApiAccess(session);
  var logs = readRecentRecords_(RG_SHEETS.SYNC_LOG, 30);
  logs.sort(function (a, b) {
    return String(b.startedAt).localeCompare(String(a.startedAt));
  });
  var map = getSettingsMap_(false);
  return {
    hasToken: Boolean(getRgToken()),
    autoSyncEnabled: map.auto_sync_enabled !== undefined ? toBool(map.auto_sync_enabled) : true,
    autoSyncIntervalHours: map.auto_sync_interval_hours ? toNumber(map.auto_sync_interval_hours, 12) : 12,
    lastSync: logs.length > 0 ? logs[0] : null,
    logs: logs.slice(0, 20)
  };
}
