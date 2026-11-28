/**
 * RENTAL GATE CRM — Rental Gate API Integration & Batch Sync Engine
 * Token is stored strictly in Script Properties: RG_TOKEN (never exposed to clients)
 */

var RG_API_BASE_URL = 'https://api.rentalgate.net/api';
var RG_RESERVATIONS_API = 'https://api.rentalgate.net/api/reservations/filter';
var RG_EXTENDS_API = 'https://api.rentalgate.net/api/reservation-extends/filter';
var RG_CANCELLED_API = 'https://api.rentalgate.net/api/admin/cancelled-reservations';
var RG_COMPANY_CHANGES_API = 'https://api.rentalgate.net/api/reservation-company-changes/admin/filter';
var RG_RESERVATION_DETAIL_BASE = 'https://api.rentalgate.net/api/reservations/';

function normalizeRgTokenGs_(raw) {
  var clean = normalizeStr(raw).replace(/[\r\n]+/g, '');
  while (clean.length >= 2) {
    var first = clean.charAt(0);
    var last = clean.charAt(clean.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      clean = normalizeStr(clean.substring(1, clean.length - 1));
    } else {
      break;
    }
  }
  clean = clean.replace(/^(?:Bearer(?:\s+|$))+/i, '').trim();
  while (clean.length >= 2) {
    var f2 = clean.charAt(0);
    var l2 = clean.charAt(clean.length - 1);
    if ((f2 === '"' && l2 === '"') || (f2 === "'" && l2 === "'")) {
      clean = normalizeStr(clean.substring(1, clean.length - 1));
    } else {
      break;
    }
  }
  return clean.replace(/^(?:Bearer(?:\s+|$))+/i, '').trim();
}

function validateRgTokenGs_(raw) {
  var tok = normalizeRgTokenGs_(raw);
  if (!tok) {
    return { valid: false, token: '', message: 'RG_TOKEN غير مضبوط في Script Properties.' };
  }
  if (/[\s\x00-\x1f\x7f]/.test(tok) || tok.length < 16) {
    return { valid: false, token: '', message: 'RG_TOKEN يحتوي على مسافات أو تنسيق غير صالح (Token is malformed).' };
  }
  if (tok.indexOf('eyJ') === 0) {
    var parts = tok.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return { valid: false, token: '', message: 'RG_TOKEN (JWT) غير مكتمل أو غير صالح (Token is malformed).' };
    }
  }
  return { valid: true, token: tok, message: '' };
}

function buildRgEndpointUrlGs_(baseOrUrl, pathSuffix) {
  var rawBase = normalizeStr(baseOrUrl || RG_API_BASE_URL).replace(/\/+$/, '');
  var cleanPath = normalizeStr(pathSuffix || '').replace(/^\/+/, '');
  rawBase = rawBase.replace(/(\/api)+\/api(?=\/|$)/gi, '/api');
  if (!cleanPath) return rawBase;
  if (rawBase.toLowerCase().indexOf('/' + cleanPath.toLowerCase(), rawBase.length - cleanPath.length - 1) !== -1) {
    return rawBase;
  }
  if (cleanPath.toLowerCase().indexOf('api/') === 0 && rawBase.toLowerCase().slice(-4) === '/api') {
    cleanPath = cleanPath.substring(4);
  }
  return (rawBase + '/' + cleanPath).replace(/([^:]\/)\/+/g, '$1').replace(/(\/api)+\/api(?=\/|$)/gi, '/api');
}

function getRgToken() {
  var props = PropertiesService.getScriptProperties();
  return normalizeRgTokenGs_(props.getProperty('RG_TOKEN') || props.getProperty('RENTAL_TOKEN'));
}

function buildRentalGateRequest_(url, token, pageZeroBased, size, extraQuery) {
  var tokenCheck = validateRgTokenGs_(token);
  if (!tokenCheck.valid) {
    throw new Error('RG_API_HTTP_401: ' + tokenCheck.message);
  }
  var safeBaseUrl = buildRgEndpointUrlGs_(url, '');
  var pageNum = pageZeroBased !== undefined && pageZeroBased !== null ? Math.max(0, Number(pageZeroBased) || 0) : 0;
  var pageSize = size ? Math.max(1, Number(size) || 100) : 100;
  var reqUrl;
  if (extraQuery && extraQuery.directUrl) {
    reqUrl = extraQuery.directUrl;
  } else {
    var sep = safeBaseUrl.indexOf('?') === -1 ? '?' : '&';
    var qParts = [];
    if (extraQuery && extraQuery.cursor) {
      qParts.push('cursor=' + encodeURIComponent(extraQuery.cursor));
      qParts.push('size=' + encodeURIComponent(pageSize));
    } else if (extraQuery && extraQuery.useOffset) {
      qParts.push('offset=' + encodeURIComponent(extraQuery.offset || 0));
      qParts.push('limit=' + encodeURIComponent(pageSize));
    } else {
      qParts.push('page=' + encodeURIComponent(pageNum));
      qParts.push('size=' + encodeURIComponent(pageSize));
    }
    reqUrl = safeBaseUrl + sep + qParts.join('&');
  }
  return {
    url: reqUrl,
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + tokenCheck.token,
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

function pickRowsFromPayloadObj_(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return obj;
  var keys = ['content', 'items', 'results', 'reservations', 'extensions', 'records', 'rows', 'list', 'data'];
  for (var i = 0; i < keys.length; i++) {
    if (Array.isArray(obj[keys[i]])) return obj[keys[i]];
  }
  return null;
}

function extractPagePayload_(body, pageIndex, pageSize) {
  var size = pageSize ? Math.max(1, Number(pageSize) || 100) : 100;
  if (!body || typeof body !== 'object') {
    return { rows: [], totalPages: 1, totalElements: 0, hasTotalPages: false, currentPageNum: null, nextPageUrl: '', isLast: true };
  }
  if (Array.isArray(body)) {
    return {
      rows: body,
      totalPages: 1,
      totalElements: body.length,
      hasTotalPages: false,
      currentPageNum: null,
      nextPageUrl: '',
      isLast: body.length < size
    };
  }

  var metaHolder = body;
  var rows = pickRowsFromPayloadObj_(body);
  if (!rows) {
    var containers = [body.data, body.result, body.payload, body.response, body.body];
    for (var c = 0; c < containers.length; c++) {
      var cont = containers[c];
      if (cont && typeof cont === 'object') {
        var nested = pickRowsFromPayloadObj_(cont);
        if (nested) {
          rows = nested;
          metaHolder = cont;
          break;
        }
        if (cont.data && typeof cont.data === 'object') {
          var deep = pickRowsFromPayloadObj_(cont.data);
          if (deep) {
            rows = deep;
            metaHolder = cont.data;
            break;
          }
        }
      }
    }
  }

  var safeRows = Array.isArray(rows) ? rows : [];
  var rawTotalPages =
    (metaHolder && (metaHolder.totalPages !== undefined ? metaHolder.totalPages :
      (metaHolder.total_pages !== undefined ? metaHolder.total_pages :
      (metaHolder.last_page !== undefined ? metaHolder.last_page :
      (metaHolder.meta && metaHolder.meta.last_page !== undefined ? metaHolder.meta.last_page :
      (metaHolder.pagination && metaHolder.pagination.last_page !== undefined ? metaHolder.pagination.last_page : undefined)))))) !== undefined
    ? (metaHolder.totalPages !== undefined ? metaHolder.totalPages :
      (metaHolder.total_pages !== undefined ? metaHolder.total_pages :
      (metaHolder.last_page !== undefined ? metaHolder.last_page :
      (metaHolder.meta && metaHolder.meta.last_page !== undefined ? metaHolder.meta.last_page :
      metaHolder.pagination.last_page))))
    : (body.totalPages !== undefined ? body.totalPages :
      (body.total_pages !== undefined ? body.total_pages :
      (body.last_page !== undefined ? body.last_page :
      (body.meta && body.meta.last_page !== undefined ? body.meta.last_page :
      (body.pagination && body.pagination.last_page !== undefined ? body.pagination.last_page : undefined)))));

  var hasTotalPages = rawTotalPages !== undefined && rawTotalPages !== null && rawTotalPages !== '' && !isNaN(Number(rawTotalPages)) && Number(rawTotalPages) > 0;
  var totalPages = hasTotalPages ? Math.max(1, Number(rawTotalPages)) : 1;

  var rawTotalElements =
    (metaHolder && metaHolder.totalElements !== undefined) ? metaHolder.totalElements :
    ((metaHolder && metaHolder.totalItems !== undefined) ? metaHolder.totalItems :
    ((metaHolder && metaHolder.total_items !== undefined) ? metaHolder.total_items :
    ((metaHolder && metaHolder.totalRecords !== undefined) ? metaHolder.totalRecords :
    ((metaHolder && metaHolder.total_records !== undefined) ? metaHolder.total_records :
    ((metaHolder && metaHolder.total !== undefined) ? metaHolder.total :
    ((metaHolder && metaHolder.total_count !== undefined) ? metaHolder.total_count :
    ((metaHolder && metaHolder.count !== undefined) ? metaHolder.count :
    ((metaHolder && metaHolder.meta && metaHolder.meta.total !== undefined) ? metaHolder.meta.total :
    ((metaHolder && metaHolder.pagination && metaHolder.pagination.total !== undefined) ? metaHolder.pagination.total :
    (body.totalElements !== undefined ? body.totalElements :
    (body.totalItems !== undefined ? body.totalItems :
    (body.total_items !== undefined ? body.total_items :
    (body.total !== undefined ? body.total :
    (body.total_count !== undefined ? body.total_count : body.count))))))))))))));
  var hasTotalElements = rawTotalElements !== undefined && rawTotalElements !== null && rawTotalElements !== '' && !isNaN(Number(rawTotalElements));
  var totalElements = hasTotalElements ? Number(rawTotalElements) : safeRows.length;

  var explicitLast = (metaHolder && metaHolder.last !== undefined) ? metaHolder.last : body.last;
  var explicitHasMore = (metaHolder && metaHolder.hasMore !== undefined)
    ? metaHolder.hasMore
    : ((metaHolder && metaHolder.has_more !== undefined) ? metaHolder.has_more : (body.hasMore !== undefined ? body.hasMore : body.has_more));

  var nextPageUrl = normalizeStr(
    (metaHolder && (metaHolder.next_page_url || metaHolder.nextPageUrl || (metaHolder.meta && metaHolder.meta.next_page_url) || (metaHolder.links && metaHolder.links.next))) ||
    body.next_page_url || body.nextPageUrl || (body.meta && body.meta.next_page_url) || (body.links && body.links.next) || ''
  );
  var nextCursor = normalizeStr(
    (metaHolder && (metaHolder.nextCursor || metaHolder.next_cursor || metaHolder.nextToken || metaHolder.after || (metaHolder.meta && (metaHolder.meta.nextCursor || metaHolder.meta.next_cursor)))) ||
    body.nextCursor || body.next_cursor || body.nextToken || body.after || (body.meta && (body.meta.nextCursor || body.meta.next_cursor)) || ''
  );

  var rawNextPageNum =
    (metaHolder && (metaHolder.nextPage !== undefined ? metaHolder.nextPage : metaHolder.next_page)) !== undefined
      ? (metaHolder.nextPage !== undefined ? metaHolder.nextPage : metaHolder.next_page)
      : (body.nextPage !== undefined ? body.nextPage : body.next_page);
  var nextPageNum = (rawNextPageNum !== undefined && rawNextPageNum !== null && rawNextPageNum !== '' && !isNaN(Number(rawNextPageNum)))
    ? Number(rawNextPageNum)
    : null;

  var rawCurrentPage =
    (metaHolder && metaHolder.current_page !== undefined) ? metaHolder.current_page :
    ((metaHolder && metaHolder.meta && metaHolder.meta.current_page !== undefined) ? metaHolder.meta.current_page :
    ((metaHolder && metaHolder.pageNumber !== undefined) ? metaHolder.pageNumber :
    ((metaHolder && metaHolder.page !== undefined) ? metaHolder.page :
    ((metaHolder && metaHolder.number !== undefined) ? metaHolder.number :
    (body.current_page !== undefined ? body.current_page :
    ((body.meta && body.meta.current_page !== undefined) ? body.meta.current_page :
    (body.pageNumber !== undefined ? body.pageNumber : (body.page !== undefined ? body.page : body.number))))))));
  var hasCurrentPage = rawCurrentPage !== undefined && rawCurrentPage !== null && rawCurrentPage !== '' && !isNaN(Number(rawCurrentPage));
  var currentPageNum = hasCurrentPage ? Number(rawCurrentPage) : null;

  var serverPageSize = Number(
    (metaHolder && (metaHolder.size || metaHolder.per_page || metaHolder.pageSize || metaHolder.page_size || metaHolder.limit || (metaHolder.meta && metaHolder.meta.per_page))) ||
    body.size || body.per_page || body.pageSize || body.page_size || body.limit || size
  );
  var effectivePageSize = (!isNaN(serverPageSize) && serverPageSize > 0) ? serverPageSize : size;
  if (!hasTotalPages && hasTotalElements && effectivePageSize > 0 && totalElements > 0) {
    totalPages = Math.max(1, Math.ceil(totalElements / effectivePageSize));
    hasTotalPages = true;
  }

  var hasOneBasedMeta = Boolean(
    (metaHolder && (metaHolder.current_page !== undefined || metaHolder.last_page !== undefined || metaHolder.pageNumber !== undefined)) ||
    body.current_page !== undefined || body.last_page !== undefined || body.pageNumber !== undefined
  );

  var isLast;
  if (safeRows.length === 0) {
    isLast = true;
  } else if (explicitLast === true || explicitHasMore === false) {
    isLast = true;
  } else if (nextPageUrl || nextCursor || (nextPageNum !== null && nextPageNum > pageIndex)) {
    isLast = false;
  } else if (hasTotalPages) {
    if (currentPageNum !== null && currentPageNum >= 1 && (pageIndex === 0 ? currentPageNum === 1 : true) && hasOneBasedMeta) {
      isLast = currentPageNum >= totalPages;
    } else {
      isLast = (pageIndex + 1) >= totalPages;
    }
  } else if (explicitLast === false || explicitHasMore === true) {
    isLast = false;
  } else if (hasTotalElements && Number(totalElements) > effectivePageSize) {
    isLast = (pageIndex + 1) * effectivePageSize >= Number(totalElements);
  } else {
    isLast = safeRows.length < effectivePageSize;
  }

  return {
    rows: safeRows,
    totalPages: totalPages,
    totalElements: totalElements,
    hasTotalPages: hasTotalPages,
    hasTotalElements: hasTotalElements,
    currentPageNum: currentPageNum,
    nextPageNum: nextPageNum,
    nextPageUrl: nextPageUrl,
    nextCursor: nextCursor,
    effectivePageSize: effectivePageSize,
    isLast: isLast
  };
}

function callRentalGateEndpoint(url, token, pageZeroBased, size, extraQuery) {
  var req = buildRentalGateRequest_(url, token, pageZeroBased, size, extraQuery);
  var res = UrlFetchApp.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    muteHttpExceptions: true
  });
  return parseRentalGateResponse_(res);
}

function rowPageDedupKey_(row, kind) {
  if (!row || typeof row !== 'object') return '';
  if (kind === 'ext') {
    return normalizeStr(row.extendId || row.extensionNumber || row.extension_number || row.id || row.code);
  }
  var srcId = extractSourceReservationId_(row);
  var resNum = extractReservationNumber_(row).replace(/^#+/, '').trim();
  if (srcId) return 'ID:' + srcId;
  return resNum ? ('NUM:' + resNum) : '';
}

function appendUniquePageRows_(targetArr, seenMap, rows, kind) {
  var added = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var k = rowPageDedupKey_(r, kind);
    if (k) {
      if (seenMap[k]) continue;
      seenMap[k] = true;
    }
    targetArr.push(r);
    added++;
  }
  return added;
}

function fetchAllRentalGatePages(url, token, kind) {
  var rowKind = kind || 'res';
  var allItems = [];
  var seenMap = {};
  var visitedCursors = {};
  var visitedUrls = {};
  var maxPages = 200;
  var pageSize = 100;
  var pagesFetched = 0;
  var totalElements = 0;
  var complete = true;
  var errorNote = '';

  try {
    var firstBody = callRentalGateEndpoint(url, token, 0, pageSize);
    pagesFetched++;
    var firstInfo = extractPagePayload_(firstBody, 0, pageSize);
    if (firstInfo.hasTotalElements) totalElements = firstInfo.totalElements;
    appendUniquePageRows_(allItems, seenMap, firstInfo.rows, rowKind);

    if (firstInfo.rows.length === 0) {
      return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements, complete: true, errorNote: '' };
    }

    var firstHasMoreByTotal = firstInfo.hasTotalElements && allItems.length < firstInfo.totalElements && firstInfo.rows.length > 0;
    if (firstInfo.isLast && !firstHasMoreByTotal && !firstInfo.nextCursor && !firstInfo.nextPageUrl) {
      return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements || allItems.length, complete: true, errorNote: '' };
    }

    // Cursor / next_page_url mode if upstream provides explicit continuation links
    if (firstInfo.nextCursor || firstInfo.nextPageUrl) {
      var curCursor = firstInfo.nextCursor;
      var curNextUrl = firstInfo.nextPageUrl;
      var cStep = 1;
      while ((curCursor || curNextUrl) && cStep < maxPages) {
        if (curCursor) {
          if (visitedCursors[curCursor]) { complete = false; break; }
          visitedCursors[curCursor] = true;
        }
        if (curNextUrl) {
          if (visitedUrls[curNextUrl]) { complete = false; break; }
          visitedUrls[curNextUrl] = true;
        }
        var cBody = callRentalGateEndpoint(url, token, cStep, firstInfo.effectivePageSize || pageSize, {
          cursor: curCursor,
          directUrl: curCursor ? '' : curNextUrl
        });
        pagesFetched++;
        var cInfo = extractPagePayload_(cBody, cStep, firstInfo.effectivePageSize || pageSize);
        if (cInfo.hasTotalElements && cInfo.totalElements > totalElements) totalElements = cInfo.totalElements;
        var cAdded = appendUniquePageRows_(allItems, seenMap, cInfo.rows, rowKind);
        curCursor = cInfo.nextCursor;
        curNextUrl = cInfo.nextPageUrl;
        if (cInfo.rows.length === 0 || cAdded === 0) {
          if (totalElements > 0 && allItems.length < totalElements) complete = false;
          break;
        }
        cStep++;
      }
      if ((curCursor || curNextUrl) && cStep >= maxPages) complete = false;
      if (totalElements > 0 && allItems.length < totalElements) complete = false;
      return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements || allItems.length, complete: complete, errorNote: errorNote };
    }

    // Probe page=1 explicitly before inferring 1-based clamping
    var probeBody = callRentalGateEndpoint(url, token, 1, pageSize);
    pagesFetched++;
    var probeInfo = extractPagePayload_(probeBody, 1, pageSize);
    if (probeInfo.hasTotalElements && probeInfo.totalElements > totalElements) totalElements = probeInfo.totalElements;
    var probeAdded = appendUniquePageRows_(allItems, seenMap, probeInfo.rows, rowKind);
    var oneBasedClamped = (probeInfo.rows.length > 0 && probeAdded === 0) ? 1 : 0;
    var probeHasMore = (totalElements > 0 && allItems.length < totalElements && probeInfo.rows.length > 0);

    var knownTotalPages = Math.max(firstInfo.hasTotalPages ? firstInfo.totalPages : 0, probeInfo.hasTotalPages ? probeInfo.totalPages : 0);
    if (probeInfo.rows.length === 0 && knownTotalPages <= 1 && !probeHasMore) {
      return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements || allItems.length, complete: true, errorNote: '' };
    }

    if (knownTotalPages > 1) {
      var startIdx = 2;
      var lastTarget = knownTotalPages - (oneBasedClamped ? 0 : 1);
      var lastPageIdx = Math.min(lastTarget, maxPages - 1);
      if (lastTarget > lastPageIdx) complete = false;
      var batchSize = 10;
      for (var startPage = startIdx; startPage <= lastPageIdx; startPage += batchSize) {
        var endPage = Math.min(startPage + batchSize - 1, lastPageIdx);
        var reqs = [];
        for (var p = startPage; p <= endPage; p++) {
          reqs.push(buildRentalGateRequest_(url, token, p, pageSize));
        }
        var responses = UrlFetchApp.fetchAll(reqs);
        pagesFetched += responses.length;
        var stopEarly = false;
        for (var r = 0; r < responses.length; r++) {
          var info = extractPagePayload_(parseRentalGateResponse_(responses[r]), startPage + r, pageSize);
          if (info.hasTotalElements && info.totalElements > totalElements) totalElements = info.totalElements;
          var added = appendUniquePageRows_(allItems, seenMap, info.rows, rowKind);
          var batchHasMoreByTotal = totalElements > 0 && allItems.length < totalElements && info.rows.length > 0;
          if ((info.isLast && !batchHasMoreByTotal && (startPage + r) >= lastPageIdx) || info.rows.length === 0) {
            stopEarly = true;
          } else if (info.rows.length > 0 && added === 0 && !batchHasMoreByTotal) {
            stopEarly = true;
          }
        }
        if (stopEarly) break;
      }
      if (totalElements > 0 && allItems.length < totalElements) complete = false;
      return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements || allItems.length, complete: complete, errorNote: '' };
    }

    // Sequential fallback when totalPages is omitted
    var seqStoppedCleanly = false;
    for (var page = 2; page < maxPages; page++) {
      var pageBody = callRentalGateEndpoint(url, token, page, pageSize);
      pagesFetched++;
      var pageInfo = extractPagePayload_(pageBody, page, pageSize);
      if (pageInfo.hasTotalElements && pageInfo.totalElements > totalElements) totalElements = pageInfo.totalElements;
      var pageAdded = appendUniquePageRows_(allItems, seenMap, pageInfo.rows, rowKind);
      var loopHasMoreByTotal = totalElements > 0 && allItems.length < totalElements && pageInfo.rows.length > 0;
      if ((pageInfo.isLast && !loopHasMoreByTotal) || pageInfo.rows.length === 0 || pageAdded === 0) {
        if (totalElements > 0 && allItems.length < totalElements) complete = false;
        seqStoppedCleanly = true;
        break;
      }
    }
    if (!seqStoppedCleanly) complete = false;
    if (totalElements > 0 && allItems.length < totalElements) complete = false;
    return { items: allItems, pagesFetched: pagesFetched, totalElements: totalElements || allItems.length, complete: complete, errorNote: '' };
  } catch (err) {
    return {
      items: allItems,
      pagesFetched: pagesFetched,
      totalElements: totalElements,
      complete: false,
      errorNote: String(err && err.message ? err.message : err)
    };
  }
}

function extractLinkSrcIdGs_(row) {
  if (!row || typeof row !== 'object') return '';
  return normalizeStr(
    row.reservationId ||
    row.reservation_id ||
    row.sourceReservationId ||
    (row.reservation && (row.reservation.id || row.reservation.reservationId || row.reservation.reservation_id)) ||
    row.id ||
    ''
  );
}

function fetchReservationDetailByIdGs_(token, srcId) {
  try {
    var tokenCheck = validateRgTokenGs_(token);
    if (!tokenCheck.valid) return null;
    var detailUrl = buildRgEndpointUrlGs_(RG_RESERVATION_DETAIL_BASE, encodeURIComponent(srcId));
    var res = UrlFetchApp.fetch(detailUrl, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + tokenCheck.token, Accept: 'application/json', lang: 'ar' },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return null;
    var body = safeJsonParse(res.getContentText(), null);
    if (!body || typeof body !== 'object') return null;
    var inner = (body.data && body.data.reservation && typeof body.data.reservation === 'object') ? body.data.reservation
      : ((body.reservation && typeof body.reservation === 'object') ? body.reservation
      : ((body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data
      : ((body.result && typeof body.result === 'object' && !Array.isArray(body.result)) ? body.result : body)));
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null;
    return Object.assign({}, inner, {
      reservationId: inner.reservationId || inner.reservation_id || inner.id || srcId,
      clientName: (inner.client && inner.client.name) || (inner.customer && inner.customer.name) || inner.clientName || inner.customer_name || '',
      clientMobile: (inner.client && (inner.client.mobile || inner.client.phone)) || (inner.customer && (inner.customer.mobile || inner.customer.phone)) || inner.clientMobile || inner.customer_phone || '',
      companyArName: (inner.companyCar && inner.companyCar.company && (inner.companyCar.company.arabicName || inner.companyCar.company.name)) || (inner.company && (inner.company.arabicName || inner.company.name)) || inner.companyArName || '',
      carNameAr: (inner.companyCar && inner.companyCar.car && inner.companyCar.car.carNameAr) || (inner.car && inner.car.carNameAr) || inner.carNameAr || ''
    });
  } catch (_e) {
    return null;
  }
}

function fetchBothEndpointsParallel_(resUrl, extUrl, token) {
  // Authoritatively pull all pages across primary reservations, extensions, cancelled, and company-changes endpoints
  var resPull = fetchAllRentalGatePages(resUrl, token, 'res');
  var extPull = fetchAllRentalGatePages(extUrl, token, 'ext');
  var canPull = fetchAllRentalGatePages(RG_CANCELLED_API, token, 'res');
  var rccPull = fetchAllRentalGatePages(RG_COMPANY_CHANGES_API, token, 'res');

  var pagesFetched = (resPull.pagesFetched || 0) + (extPull.pagesFetched || 0) + (canPull.pagesFetched || 0) + (rccPull.pagesFetched || 0);
  var incompleteEndpoints = [];
  if (!resPull.complete) incompleteEndpoints.push('reservations/filter' + (resPull.errorNote ? ': ' + resPull.errorNote : ''));
  if (!extPull.complete) incompleteEndpoints.push('reservation-extends/filter' + (extPull.errorNote ? ': ' + extPull.errorNote : ''));
  if (!canPull.complete) incompleteEndpoints.push('admin/cancelled-reservations' + (canPull.errorNote ? ': ' + canPull.errorNote : ''));
  if (!rccPull.complete) incompleteEndpoints.push('reservation-company-changes/admin/filter' + (rccPull.errorNote ? ': ' + rccPull.errorNote : ''));

  var bySrcId = {};
  var mergedRes = [];
  var canMetaById = {};
  var rccMetaById = {};
  var presentSrcIds = {};
  var missingIdsMap = {};
  var rawMainCount = resPull.items.length;

  for (var i = 0; i < resPull.items.length; i++) {
    var rItem = resPull.items[i];
    var sid = extractSourceReservationId_(rItem) || extractReservationNumber_(rItem);
    if (sid) {
      bySrcId[sid] = rItem;
      presentSrcIds[sid] = true;
    }
    var rNumMain = extractReservationNumber_(rItem);
    if (rNumMain) presentSrcIds[rNumMain] = true;
    mergedRes.push(rItem);
  }

  for (var ci = 0; ci < canPull.items.length; ci++) {
    var cRow = canPull.items[ci];
    var cSid = extractLinkSrcIdGs_(cRow);
    if (!cSid) continue;
    canMetaById[cSid] = {
      isSourceCancelled: true,
      cancellationReason: normalizeStr(cRow.cancellationReason || cRow.reason || ''),
      cancelledAt: normalizeStr(cRow.cancelledAt || cRow.canceledAt || cRow.createdAt || ''),
      referenceNumber: normalizeStr(cRow.referenceNumber || cRow.reference_number || '')
    };
    if (bySrcId[cSid]) {
      bySrcId[cSid].isSourceCancelled = true;
      if (canMetaById[cSid].cancellationReason && !bySrcId[cSid].cancellationReason) bySrcId[cSid].cancellationReason = canMetaById[cSid].cancellationReason;
      if (canMetaById[cSid].cancelledAt && !bySrcId[cSid].cancelledAt) bySrcId[cSid].cancelledAt = canMetaById[cSid].cancelledAt;
    } else if (cRow.clientName || cRow.customer_name || cRow.carNameAr || cRow.reservationNumber || cRow.startDate) {
      var inlineCan = Object.assign({}, cRow, {
        reservationId: cSid,
        isSourceCancelled: true,
        reservationStatus: cRow.reservationStatus || cRow.status || 'cancelled'
      });
      bySrcId[cSid] = inlineCan;
      presentSrcIds[cSid] = true;
      mergedRes.push(inlineCan);
    } else if (!presentSrcIds[cSid]) {
      missingIdsMap[cSid] = true;
    }
  }

  for (var ri = 0; ri < rccPull.items.length; ri++) {
    var rRow = rccPull.items[ri];
    var rSid = extractLinkSrcIdGs_(rRow);
    if (!rSid) continue;
    var rccSt = normalizeStr(rRow.status || '').toUpperCase();
    var isCompChanged = rccSt === 'COMPANY_CHANGED';
    rccMetaById[rSid] = {
      isSourceRejected: isCompChanged || rccSt === 'REJECTED' || rccSt === 'TIMEOUT',
      rccStatus: rccSt,
      rccReason: normalizeStr(rRow.reason || rRow.rejectionReason || ''),
      newCompanyName: normalizeStr(rRow.newCompanyName || rRow.alternativeCompanyName || '')
    };
    if (bySrcId[rSid]) {
      if (rccMetaById[rSid].isSourceRejected) bySrcId[rSid].isSourceRejected = true;
      bySrcId[rSid].rccStatus = rccSt;
      if (rccMetaById[rSid].rccReason && !bySrcId[rSid].rejectionReason) bySrcId[rSid].rejectionReason = rccMetaById[rSid].rccReason;
      if (rccMetaById[rSid].newCompanyName && !bySrcId[rSid].newCompanyName) bySrcId[rSid].newCompanyName = rccMetaById[rSid].newCompanyName;
    } else if (rRow.clientName || rRow.customer_name || rRow.carNameAr || rRow.reservationNumber || rRow.startDate) {
      var inlineRcc = Object.assign({}, rRow, {
        reservationId: rSid,
        isSourceRejected: rccMetaById[rSid].isSourceRejected,
        rccStatus: rccSt,
        reservationStatus: rccMetaById[rSid].isSourceRejected ? (rRow.reservationStatus || rRow.status || 'rejected') : (rRow.reservationStatus || rRow.status || '')
      });
      bySrcId[rSid] = inlineRcc;
      presentSrcIds[rSid] = true;
      mergedRes.push(inlineRcc);
    } else if (!presentSrcIds[rSid]) {
      missingIdsMap[rSid] = true;
    }
  }

  var backfillIds = Object.keys(missingIdsMap);
  var backfillFailedIds = [];
  for (var bi = 0; bi < backfillIds.length; bi++) {
    var bSid = backfillIds[bi];
    var det = fetchReservationDetailByIdGs_(token, bSid);
    pagesFetched++;
    if (!det) {
      det = fetchReservationDetailByIdGs_(token, bSid); // targeted retry pass
      pagesFetched++;
    }
    if (det) {
      if (canMetaById[bSid]) {
        det.isSourceCancelled = true;
        if (canMetaById[bSid].cancellationReason && !det.cancellationReason) det.cancellationReason = canMetaById[bSid].cancellationReason;
        if (canMetaById[bSid].cancelledAt && !det.cancelledAt) det.cancelledAt = canMetaById[bSid].cancelledAt;
      }
      if (rccMetaById[bSid]) {
        if (rccMetaById[bSid].isSourceRejected) det.isSourceRejected = true;
        det.rccStatus = rccMetaById[bSid].rccStatus;
        if (rccMetaById[bSid].rccReason && !det.rejectionReason) det.rejectionReason = rccMetaById[bSid].rccReason;
        if (rccMetaById[bSid].newCompanyName && !det.newCompanyName) det.newCompanyName = rccMetaById[bSid].newCompanyName;
      }
      bySrcId[bSid] = det;
      mergedRes.push(det);
    } else {
      backfillFailedIds.push(bSid);
    }
  }

  var uniqueTotal = Math.max(mergedRes.length + backfillFailedIds.length, resPull.totalElements || 0);
  var grossThreeLists = rawMainCount + canPull.items.length + rccPull.items.length;
  var sourceBreakdown = {
    uniqueSourceTotal: uniqueTotal,
    grossAcrossThreeLists: grossThreeLists,
    activeOrOtherCount: rawMainCount,
    cancelledListCount: canPull.items.length,
    rejectedListCount: rccPull.items.length,
    overlapCount: Math.max(0, grossThreeLists - uniqueTotal),
    dualCancelledRejectedCount: 0,
    reassignedActiveCount: 0
  };

  return {
    extensions: extPull.items,
    reservations: mergedRes,
    pagesFetched: pagesFetched,
    totalInSource: uniqueTotal,
    incompleteEndpoints: incompleteEndpoints,
    backfillFailedIds: backfillFailedIds,
    sourceBreakdown: sourceBreakdown
  };
}

function saveApiToken(session, payload) {
  requireApiAccess(session);
  var p = payload || {};
  var tokenCheck = validateRgTokenGs_(p.token || p.rgToken || p.rentalToken);
  if (!tokenCheck.valid) {
    throw new Error('صيغة التوكن غير صالحة. يرجى لصق التوكن كاملاً بدون مسافات أو علامات اقتباس.');
  }
  var raw = tokenCheck.token;

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
  var tokenCheck = validateRgTokenGs_(token);
  if (!tokenCheck.valid) {
    throw new Error('صيغة RG_TOKEN غير صالحة: ' + tokenCheck.message);
  }
  var clean = tokenCheck.token;
  PropertiesService.getScriptProperties().setProperties({
    RG_TOKEN: clean,
    RENTAL_TOKEN: clean
  });
  return { saved: true, keys: ['RG_TOKEN', 'RENTAL_TOKEN'] };
}

function testRentalGateConnection(session) {
  requireApiAccess(session);
  var tokenCheck = validateRgTokenGs_(PropertiesService.getScriptProperties().getProperty('RG_TOKEN') || PropertiesService.getScriptProperties().getProperty('RENTAL_TOKEN'));
  if (!tokenCheck.valid) {
    return {
      connected: false,
      hasToken: Boolean(getRgToken()),
      message: tokenCheck.message || 'مفتاح RG_TOKEN غير مضبوط في Script Properties.'
    };
  }
  try {
    callRentalGateEndpoint(RG_RESERVATIONS_API, tokenCheck.token, 0, 1);
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
  var lcClient = (typeof classifyReservationLifecycleGs_ === 'function')
    ? classifyReservationLifecycleGs_(sr)
    : 'active';
  var isProtectedClient = lcClient === 'rejected' || lcClient === 'cancelled';
  var rawRefClient = normalizeStr(sr.referenceNumber);
  var cleanRefClient = isProtectedClient
    ? ((rawRefClient && rawRefClient !== normalizeStr(sr.reservationNumber) && (!normalizeStr(sr.sourceReservationId) || rawRefClient !== normalizeStr(sr.sourceReservationId))) ? rawRefClient : '')
    : (rawRefClient || normalizeStr(sr.sourceReservationId) || '');
  return {
    id: sr.id,
    sourceReservationId: sr.sourceReservationId || sr.reservationNumber || '',
    reservationNumber: sr.reservationNumber,
    referenceNumber: cleanRefClient,
    sourceCreatedAt: sr.sourceCreatedAt || sr.createdAt || '',
    customerName: sr.customerName,
    customerPhone: sr.customerPhone,
    customerEmail: sr.customerEmail || '',
    customerIdNumber: sr.customerIdNumber || '',
    companyName: sr.companyName,
    companyNumber: sr.companyNumber || '',
    newCompanyName: sr.newCompanyName || '',
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
    paidAmount: toNumber(sr.paidAmount, 0),
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
    rejectionReason: sr.rejectionReason || '',
    carStatusAtRequest: sr.carStatusAtRequest || '',
    refundAmount: toNumber(sr.refundAmount, 0),
    rejectedById: sr.rejectedById || '',
    rejectedByName: sr.rejectedByName || '',
    rejectedAt: sr.rejectedAt || '',
    cancellationReason: sr.cancellationReason || '',
    cancelledById: sr.cancelledById || '',
    cancelledByName: sr.cancelledByName || '',
    cancelledAt: sr.cancelledAt || '',
    deliveryFailureReason: sr.deliveryFailureReason || '',
    driverNotes: sr.driverNotes || '',
    pinnedNote: sr.pinnedNote || '',
    pinnedNoteById: sr.pinnedNoteById || '',
    pinnedNoteByName: sr.pinnedNoteByName || '',
    pinnedNoteUpdatedAt: sr.pinnedNoteUpdatedAt || '',
    noAnswerCount: Math.max(0, Math.floor(toNumber(sr.noAnswerCount, 0))),
    createdAt: sr.createdAt || '',
    updatedAt: sr.updatedAt || '',
    sourceOrder: (sr.sourceOrder !== undefined && sr.sourceOrder !== null && sr.sourceOrder !== '' && Number(sr.sourceOrder) > 0) ? Math.floor(Number(sr.sourceOrder)) : null,
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
    fetchedCount: syncResult.fetchedCount || 0,
    excludedFilteredCount: syncResult.excludedFilteredCount || 0,
    rangeFilteredCount: syncResult.rangeFilteredCount || 0,
    totalInSource: syncResult.totalInSource || 0,
    failedCount: syncResult.failedCount || 0,
    missingLocalCount: syncResult.missingLocalCount || 0,
    missingSourceIds: syncResult.missingSourceIds || [],
    failedRecords: syncResult.failedRecords || [],
    incompleteEndpoints: syncResult.incompleteEndpoints || [],
    backfillFailedIds: syncResult.backfillFailedIds || [],
    unfetchedSourceGap: syncResult.unfetchedSourceGap || 0,
    syncComplete: syncResult.syncComplete !== false,
    sourceBreakdown: syncResult.sourceBreakdown || null,
    reconciliation: syncResult.reconciliation || null,
    durationMs: syncResult.durationMs || 0,
    finishedAt: syncResult.finishedAt || nowIso(),
    appliedRange: syncResult.appliedRange || { preset: 'all', dateFrom: '', dateTo: '', hasCustomRange: false },
    changedReservations: syncResult.changedReservations || []
  };
}

function runRentalGateSyncInternal(actor, options) {
  var rawToken = PropertiesService.getScriptProperties().getProperty('RG_TOKEN') || PropertiesService.getScriptProperties().getProperty('RENTAL_TOKEN');
  var tokenCheck = validateRgTokenGs_(rawToken);
  if (!tokenCheck.valid) {
    throw new Error(tokenCheck.message || 'لم يتم ضبط RG_TOKEN في Script Properties.');
  }
  var token = tokenCheck.token;

  var actorId = (actor && (actor.employeeId || actor.id)) || 'SYSTEM';
  var actorName = (actor && actor.name) || 'المزامنة التلقائية';
  var actorObj = { id: actorId, name: actorName, role: (actor && actor.role) || 'system' };
  var appliedRange = resolvePullDateRange_(options);

  var startedAt = nowIso();
  var startMs = Date.now();
  var parallelFetch;
  try {
    // 1. Fetch extensions & reservations in parallel batches OUTSIDE the script lock
    parallelFetch = fetchBothEndpointsParallel_(RG_RESERVATIONS_API, RG_EXTENDS_API, token);
  } catch (fetchErr) {
    try {
      withScriptLock(function () {
        appendRecord(RG_SHEETS.SYNC_LOG, {
          id: generateId('SYNC'),
          triggeredById: actorId,
          triggeredByName: actorName,
          status: 'error',
          importedCount: 0,
          updatedCount: 0,
          extensionsCount: 0,
          pagesFetched: 0,
          errorMessage: fetchErr.message,
          durationMs: Date.now() - startMs,
          startedAt: startedAt,
          finishedAt: nowIso()
        });
      });
    } catch (_logErr) {}
    throw fetchErr;
  }

  var syncOut = withScriptLock(function () {
    var importedCount = 0;
    var updatedCount = 0;
    var extensionsCount = 0;
    var pagesFetched = parallelFetch.pagesFetched || 0;

    try {
      var excludedSetting = findRecordById(RG_SHEETS.SETTINGS, 'key', 'excluded_statuses');
      var excludedStatuses = sanitizeExcludedStatusesListGs_(safeJsonParse(excludedSetting ? excludedSetting.value : '[]', []));
      var excludedSet = {};
      for (var e = 0; e < excludedStatuses.length; e++) {
        excludedSet[normalizeStr(excludedStatuses[e]).toLowerCase()] = true;
      }

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
          reservationId: prevExt && prevExt.reservationId ? prevExt.reservationId : '',
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

      // 2. Preserve authoritative Rental Gate source sequence (1-based) BEFORE any range filtering
      var rawFetchedList = Array.isArray(parallelFetch.reservations) ? parallelFetch.reservations : [];
      var rawFetchedCount = rawFetchedList.length;
      for (var seqI = 0; seqI < rawFetchedList.length; seqI++) {
        if (rawFetchedList[seqI] && typeof rawFetchedList[seqI] === 'object') {
          rawFetchedList[seqI].__sourceOrder = seqI + 1;
        }
      }
      var resItems = filterSourceReservationsByPullRange_(rawFetchedList, appliedRange);
      var rangeFilteredCount = Math.max(0, rawFetchedCount - resItems.length);
      var excludedFilteredCount = 0;

      var existingReservations = readAllRecords(RG_SHEETS.RESERVATIONS, true);
      var existingByNumber = {};
      var existingBySourceId = {};
      for (var r = 0; r < existingReservations.length; r++) {
        var rKey = normalizeStr(existingReservations[r].reservationNumber);
        var sKey = normalizeStr(existingReservations[r].sourceReservationId);
        if (rKey) existingByNumber[rKey] = existingReservations[r];
        if (sKey) existingBySourceId[sKey] = existingReservations[r];
      }

      var resSeenBySrcKey = {};
      var resUsedNums = {};
      var resRecordsToUpsert = [];
      var statusChangeHistoryBatch = [];
      var changedReservations = [];
      var failedRecords = [];
      var excludedSourceIds = [];
      var expectedSourceIds = [];
      var duplicateHandledCount = 0;
      var nowStr = nowIso();

      for (var biFail = 0; biFail < (parallelFetch.backfillFailedIds || []).length; biFail++) {
        var bFailId = normalizeStr(parallelFetch.backfillFailedIds[biFail]);
        if (bFailId) {
          failedRecords.push({
            identifier: bFailId,
            sourceReservationId: bFailId,
            entityType: 'backfill',
            stage: 'backfill',
            reason: 'DETAIL_FETCH_FAILED'
          });
        }
      }

      for (var i = 0; i < resItems.length; i++) {
        var item = resItems[i];
        try {
          var resApiId = extractSourceReservationId_(item);
          var statusCode = extractReservationStatusCode_(item, false);
          var prelimStatusAr = resolveSourceWorkflowStatus_(item);
          var prelimLc = (typeof classifyReservationLifecycleGs_ === 'function')
            ? classifyReservationLifecycleGs_({
                originalStatusCode: statusCode,
                originalStatusAr: prelimStatusAr,
                isSourceRejected: item.isSourceRejected === true,
                isSourceCancelled: item.isSourceCancelled === true
              })
            : 'active';
          var resNumber;
          if (prelimLc === 'rejected' || prelimLc === 'cancelled') {
            var explicitRefPre = normalizeStr(item.referenceNumber || item.reference_number || item.refNumber || item.ref_number || item.sourceReference || item.externalReference || item.orderRef || item.reference || '');
            var explicitBookPre = normalizeStr(
              item.reservationNumber || item.reservation_number || item.reservationNo || item.reservation_no ||
              item.reservationCode || item.reservation_code || item.bookingNumber || item.booking_number ||
              item.bookingCode || item.booking_code || item.contractNumber || item.contract_number ||
              item.orderNumber || item.order_number || item.code || item.serialNumber || item.serial_number || item.number || ''
            );
            resNumber = (explicitBookPre && (!explicitRefPre || explicitBookPre !== explicitRefPre || !resApiId))
              ? explicitBookPre
              : (resApiId || explicitBookPre);
          } else {
            resNumber = extractReservationNumber_(item) || resApiId;
          }
          if (!resNumber) {
            failedRecords.push({
              identifier: resApiId || ('row#' + (i + 1)),
              sourceReservationId: resApiId || '',
              entityType: 'reservation',
              stage: 'normalize',
              reason: 'MISSING_RESERVATION_NUMBER'
            });
            continue;
          }

          var srcUniqueKey = resApiId ? ('ID:' + resApiId) : ('NUM:' + resNumber);
          if (resSeenBySrcKey[srcUniqueKey]) {
            duplicateHandledCount++;
            continue;
          }
          resSeenBySrcKey[srcUniqueKey] = true;

          // Only apply excludedSet when booking is NOT rejected/cancelled and NOT explicitly included
          if (prelimLc !== 'rejected' && prelimLc !== 'cancelled' && statusCode && excludedSet[statusCode]) {
            excludedFilteredCount++;
            excludedSourceIds.push(resApiId || resNumber);
            continue;
          }

          if (resApiId) expectedSourceIds.push(resApiId);
          else expectedSourceIds.push(resNumber);

          var existing = (resApiId ? existingBySourceId[resApiId] : null) || null;
          if (!existing) {
            var numCand = existingByNumber[resNumber];
            if (numCand) {
              var candSrc = normalizeStr(numCand.sourceReservationId);
              if (candSrc && resApiId && candSrc !== resApiId) {
                existing = null;
              } else {
                existing = numCand;
              }
            }
          }

          // If another distinct booking already claimed resNumber in this batch or existing sheet, disambiguate instead of dropping or overwriting!
          if (resUsedNums[resNumber] && resUsedNums[resNumber] !== srcUniqueKey) {
            resNumber = resApiId ? (resNumber + '-' + resApiId.replace(/[^A-Za-z0-9_-]/g, '')) : (resNumber + '-R' + (i + 1));
          } else if (existing === null && existingByNumber[resNumber] && normalizeStr(existingByNumber[resNumber].sourceReservationId) && resApiId && normalizeStr(existingByNumber[resNumber].sourceReservationId) !== resApiId) {
            resNumber = resNumber + '-' + resApiId.replace(/[^A-Za-z0-9_-]/g, '');
          }
          resUsedNums[resNumber] = srcUniqueKey;

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

          var incomingLifecycleGs = classifyReservationLifecycleGs_({
            originalStatusCode: statusCode,
            originalStatusAr: sourceStatusAr,
            internalStatus: sourceStatusAr
          });
          var existingLifecycleGs = classifyReservationLifecycleGs_(existing);

          var sourceChanged = Boolean(
            (statusCode && (
              (prevCode && statusCode !== prevCode) ||
              (!prevCode && prevOrigAr && sourceStatusAr !== prevOrigAr)
            )) ||
            (incomingLifecycleGs !== existingLifecycleGs) ||
            (!statusCode && prevOrigAr && sourceStatusAr && sourceStatusAr !== prevOrigAr)
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
          } else if (shouldAutoReconcileSyncedStatus_(existing, sourceStatusAr)) {
            nextInternalStatus = sourceStatusAr;
            nextLastUpdateText = 'تم السحب من Rental Gate بالحالة: ' + sourceStatusAr;
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
              note: 'تصحيح تلقائي للحالة وفق موقع Rental Gate: ' + sourceStatusAr
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

        var finalLifecycleGs = classifyReservationLifecycleGs_({
          originalStatusCode: statusCode,
          originalStatusAr: sourceStatusAr,
          internalStatus: nextInternalStatus
        });
        var isRejSync = finalLifecycleGs === 'rejected';
        var isCanSync = finalLifecycleGs === 'cancelled';

        var resPayload = {
          id: resId,
          sourceReservationId: resApiId || resNumber,
          reservationNumber: resNumber,
          sourceCreatedAt: sourceCreatedRaw ? (formatDateTimeDisplay_(sourceCreatedRaw) || normalizeStr(sourceCreatedRaw)) : '',
          customerName: normalizeStr(item.clientName || item.customer_name || customerObj.name || customerObj.full_name || 'عميل'),
          customerPhone: normalizeStr(item.clientMobile || item.customer_phone || customerObj.phone || customerObj.mobile || ''),
          customerEmail: normalizeStr(item.clientEmail || item.customer_email || customerObj.email || (existing && existing.customerEmail) || ''),
          customerIdNumber: extractCustomerNationalIdGs_(item, existing),
          companyName: normalizeStr(item.companyArName || item.companyEnName || item.company_name || companyObj.name || ''),
          companyNumber: normalizeStr((existing && existing.companyNumber) || item.companyNumber || item.company_number || item.companyCode || item.companyId || ''),
          newCompanyName: isRejSync ? (sanitizeReasonTextGs_(item.newCompanyName || item.new_company_name || item.transferCompanyName || item.alternativeCompanyName) || (existing && sanitizeReasonTextGs_(existing.newCompanyName)) || '') : '',
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
          originalStatusAr: sourceStatusAr,
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
          rejectionReason: isRejSync ? extractRejectionReasonGs_(item, existing) : '',
          carStatusAtRequest: isRejSync ? (sanitizeReasonTextGs_(item.carStatusAtRequest || item.car_status_at_request) || (existing && sanitizeReasonTextGs_(existing.carStatusAtRequest)) || '') : '',
          refundAmount: isRejSync ? ((existing && existing.refundAmount !== undefined && existing.refundAmount !== null && existing.refundAmount !== '') ? toNumber(existing.refundAmount, 0) : toNumber(item.refundAmount || item.refund_amount, 0)) : 0,
          rejectedById: isRejSync ? normalizeStr((existing && existing.rejectedById) || item.rejectedById || item.rejected_by_id || item.confirmedById || item.confirmed_by_id || item.actionById || actorId) : '',
          rejectedByName: isRejSync ? normalizeStr((existing && existing.rejectedByName) || item.rejectedByName || item.rejected_by_name || item.rejectedBy || item.confirmedByName || item.confirmed_by_name || item.confirmedBy || item.actionByName || item.adminName || actorName) : '',
          rejectedAt: isRejSync ? normalizeStr(item.rejectedAt || item.rejected_at || item.actionAt || (existing && existing.rejectedAt) || nowStr) : '',
          cancellationReason: isCanSync ? extractCancellationReasonGs_(item, existing) : '',
          cancelledById: isCanSync ? normalizeStr((existing && existing.cancelledById) || item.cancelledById || item.cancelled_by_id || item.canceled_by_id || item.actionById || actorId) : '',
          cancelledByName: isCanSync ? normalizeStr((existing && existing.cancelledByName) || item.cancelledByName || item.cancelled_by_name || item.canceledByName || item.canceled_by_name || item.cancelledBy || item.actionByName || actorName) : '',
          cancelledAt: isCanSync ? normalizeStr(item.cancelledAt || item.cancelled_at || item.canceledAt || item.canceled_at || item.actionAt || (existing && existing.cancelledAt) || nowStr) : '',
          referenceNumber: (isRejSync || isCanSync)
            ? (function () {
                var candList = [
                  item.referenceNumber, item.reference_number, item.refNumber, item.ref_number,
                  item.sourceReference, item.externalReference, item.orderRef, item.reference,
                  existing && existing.referenceNumber
                ];
                for (var ci = 0; ci < candList.length; ci++) {
                  var cv = normalizeStr(candList[ci]);
                  if (!cv || cv === resNumber || (resApiId && cv === resApiId)) continue;
                  return cv;
                }
                return '';
              })()
            : normalizeStr(item.referenceNumber || item.reference_number || item.refNumber || item.ref_number || item.sourceReference || item.externalReference || item.orderRef || item.reference || (existing && existing.referenceNumber) || resApiId || ''),
          paidAmount: (function () {
            var rp = item.paidAmount !== undefined ? item.paidAmount : (item.paid_amount !== undefined ? item.paid_amount : (item.amountPaid !== undefined ? item.amountPaid : item.amount_paid));
            if (rp !== undefined && rp !== null && rp !== '') return Math.max(0, Math.round(toNumber(rp, 0) * 100) / 100);
            if (existing && toNumber(existing.paidAmount, 0) > 0) return Math.round(toNumber(existing.paidAmount, 0) * 100) / 100;
            var pst = normalizeStr(item.paymentStatus || item.paymentResult || (existing && existing.paymentStatus) || '').toLowerCase();
            return ['paid', 'wallet_paid', 'paid_by_wallet', 'paid_wallet', 'refunded', 'مدفوع', 'مدفوع عن طريق المحفظة', 'مسترد'].indexOf(pst) !== -1 ? totalAmount : 0;
          })(),
          deliveryFailureReason: sanitizeReasonTextGs_(item.deliveryFailureReason || item.delivery_failure_reason || item.failedDeliveryReason || item.failed_delivery_reason || item.deliverFailReason || item.failReason) || (existing && sanitizeReasonTextGs_(existing.deliveryFailureReason)) || '',
          driverNotes: sanitizeReasonTextGs_(item.driverNotes || item.driver_notes || item.driverNote || item.driver_note || item.deliveryNotes || item.delivery_notes || item.driverComment) || (existing && sanitizeReasonTextGs_(existing.driverNotes)) || '',
          pinnedNote: existing ? normalizeStr(existing.pinnedNote) : '',
          pinnedNoteById: existing ? normalizeStr(existing.pinnedNoteById) : '',
          pinnedNoteByName: existing ? normalizeStr(existing.pinnedNoteByName) : '',
          pinnedNoteUpdatedAt: existing ? normalizeStr(existing.pinnedNoteUpdatedAt) : '',
          noAnswerCount: existing ? Math.max(0, Math.floor(toNumber(existing.noAnswerCount, 0))) : 0,
          createdAt: existing ? existing.createdAt : nowStr,
          updatedAt: nowStr,
          statusHistory: JSON.stringify(nextStatusHistory),
          rawJson: JSON.stringify(item).substring(0, 16000),
          sourceOrder: (item.__sourceOrder && Number(item.__sourceOrder) > 0)
            ? Math.floor(Number(item.__sourceOrder))
            : ((existing && existing.sourceOrder && Number(existing.sourceOrder) > 0) ? Math.floor(Number(existing.sourceOrder)) : (i + 1))
        };

          resRecordsToUpsert.push(resPayload);
          changedReservations.push(serializeReservationForClient_(resPayload, false));
        } catch (rowErr) {
          failedRecords.push({
            identifier: normalizeStr(extractSourceReservationId_(item) || extractReservationNumber_(item) || ('row#' + (i + 1))),
            sourceReservationId: extractSourceReservationId_(item) || '',
            reservationNumber: extractReservationNumber_(item) || '',
            entityType: 'reservation',
            stage: 'normalize',
            reason: String(rowErr && rowErr.message ? rowErr.message : rowErr).substring(0, 240)
          });
        }
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

      // Post-upsert verification against RG_SHEETS.RESERVATIONS
      var verifySheetRows = readAllRecords(RG_SHEETS.RESERVATIONS, true);
      var verifiedSrcMap = {};
      var verifiedNumMap = {};
      for (var vsi = 0; vsi < verifySheetRows.length; vsi++) {
        var vRow = verifySheetRows[vsi];
        var vNum = normalizeStr(vRow.reservationNumber);
        var vSid = normalizeStr(vRow.sourceReservationId);
        if (vNum) verifiedNumMap[vNum] = true;
        if (vSid) verifiedSrcMap[vSid] = true;
      }
      var missingSourceIds = [];
      for (var ei = 0; ei < expectedSourceIds.length; ei++) {
        var eid = expectedSourceIds[ei];
        if (!verifiedSrcMap[eid] && !verifiedNumMap[eid]) {
          missingSourceIds.push(eid);
        }
      }

      var incompleteEndpoints = parallelFetch.incompleteEndpoints || [];
      var backfillFailedIds = parallelFetch.backfillFailedIds || [];
      var totalInSource = toNumber(parallelFetch.totalInSource, resItems.length + backfillFailedIds.length);
      var unfetchedSourceGap = Math.max(0, totalInSource - (resRecordsToUpsert.length + backfillFailedIds.length + excludedFilteredCount + rangeFilteredCount));
      var syncComplete =
        failedRecords.length === 0 &&
        missingSourceIds.length === 0 &&
        incompleteEndpoints.length === 0 &&
        backfillFailedIds.length === 0 &&
        unfetchedSourceGap === 0;
      var syncStatusVal = syncComplete ? 'success' : 'partial';
      var syncWarnParts = [];
      if (failedRecords.length > 0) syncWarnParts.push('فشل ' + failedRecords.length + ' سجل');
      if (missingSourceIds.length > 0) syncWarnParts.push('ناقص بعد التحقق: ' + missingSourceIds.length);
      if (unfetchedSourceGap > 0) syncWarnParts.push('فجوة مصدر: ' + unfetchedSourceGap);
      if (incompleteEndpoints.length > 0) syncWarnParts.push('واجهات ناقصة: ' + incompleteEndpoints.join(' | '));
      var syncErrMsg = syncComplete ? '' : syncWarnParts.join(' · ').substring(0, 500);

      var reconciliation = {
        totalInSource: totalInSource,
        fetchedCount: rawFetchedCount,
        normalizedCount: resRecordsToUpsert.length,
        savedOrUpdatedCount: importedCount + updatedCount,
        dbTotalReservations: verifySheetRows.length,
        duplicateHandledCount: duplicateHandledCount,
        excludedFilteredCount: excludedFilteredCount,
        rangeFilteredCount: rangeFilteredCount,
        failedCount: failedRecords.length,
        missingLocalCount: missingSourceIds.length,
        unfetchedSourceGap: unfetchedSourceGap,
        syncComplete: syncComplete,
        missingSourceIds: missingSourceIds,
        failedRecords: failedRecords,
        excludedSourceIds: excludedSourceIds,
        incompleteEndpoints: incompleteEndpoints,
        backfillFailedIds: backfillFailedIds,
        sourceBreakdown: parallelFetch.sourceBreakdown || null
      };

      var syncRecord = {
        id: generateId('SYNC'),
        triggeredById: actorId,
        triggeredByName: actorName,
        status: syncStatusVal,
        importedCount: importedCount,
        updatedCount: updatedCount,
        extensionsCount: extensionsCount,
        pagesFetched: pagesFetched,
        errorMessage: syncErrMsg,
        durationMs: Date.now() - startMs,
        startedAt: startedAt,
        finishedAt: nowIso()
      };
      appendRecord(RG_SHEETS.SYNC_LOG, syncRecord);
      if (actorId !== 'SYSTEM' || (importedCount + updatedCount + extensionsCount) > 0 || !syncComplete) {
        var rangeDesc = appliedRange.hasCustomRange
          ? (' | النطاق: ' + (appliedRange.dateFrom || '-') + ' → ' + (appliedRange.dateTo || '-'))
          : '';
        logActivity(actorObj, 'سحب بيانات', 'Sync', syncRecord.id,
          'استيراد ' + importedCount + '، تحديث ' + updatedCount + '، تمديدات ' + extensionsCount +
          ' | مطابقة ' + resRecordsToUpsert.length + '/' + totalInSource + (syncComplete ? '' : (' (ناقص/فاشل: ' + (missingSourceIds.length + failedRecords.length + unfetchedSourceGap) + ')')) + rangeDesc);
      }

      return {
        syncRecord: syncRecord,
        rawFetchedCount: rawFetchedCount,
        excludedFilteredCount: excludedFilteredCount,
        rangeFilteredCount: rangeFilteredCount,
        changedReservations: changedReservations,
        resRecordsToUpsert: resRecordsToUpsert,
        extRecordsToUpsert: extRecordsToUpsert,
        reconciliation: reconciliation,
        excludedSourceIds: excludedSourceIds,
        expectedSourceIds: expectedSourceIds
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

  var recOut = syncOut.reconciliation || {};
  var neonSyncMeta = (typeof pushIncrementalSyncToNeonSafe_ === 'function')
    ? pushIncrementalSyncToNeonSafe_(syncOut.resRecordsToUpsert, syncOut.extRecordsToUpsert, {
        triggeredById: actorId,
        triggeredByName: actorName,
        pagesFetched: syncOut.syncRecord.pagesFetched,
        appliedRange: appliedRange,
        totalInSource: recOut.totalInSource,
        incompleteEndpoints: recOut.incompleteEndpoints,
        backfillFailedIds: recOut.backfillFailedIds,
        sourceBreakdown: recOut.sourceBreakdown,
        excludedFilteredCount: syncOut.excludedFilteredCount,
        rangeFilteredCount: syncOut.rangeFilteredCount,
        excludedSourceIds: syncOut.excludedSourceIds,
        expectedSourceIds: syncOut.expectedSourceIds
      })
    : { skipped: true };

  return {
    id: syncOut.syncRecord.id,
    triggeredById: syncOut.syncRecord.triggeredById,
    triggeredByName: syncOut.syncRecord.triggeredByName,
    status: syncOut.syncRecord.status,
    importedCount: syncOut.syncRecord.importedCount,
    updatedCount: syncOut.syncRecord.updatedCount,
    extensionsCount: syncOut.syncRecord.extensionsCount,
    pagesFetched: syncOut.syncRecord.pagesFetched,
    fetchedCount: syncOut.rawFetchedCount,
    excludedFilteredCount: syncOut.excludedFilteredCount,
    rangeFilteredCount: syncOut.rangeFilteredCount,
    totalInSource: recOut.totalInSource || 0,
    failedCount: recOut.failedCount || 0,
    missingLocalCount: recOut.missingLocalCount || 0,
    missingSourceIds: recOut.missingSourceIds || [],
    failedRecords: recOut.failedRecords || [],
    incompleteEndpoints: recOut.incompleteEndpoints || [],
    backfillFailedIds: recOut.backfillFailedIds || [],
    unfetchedSourceGap: recOut.unfetchedSourceGap || 0,
    syncComplete: recOut.syncComplete !== false,
    sourceBreakdown: recOut.sourceBreakdown || null,
    reconciliation: recOut,
    errorMessage: syncOut.syncRecord.errorMessage,
    durationMs: syncOut.syncRecord.durationMs,
    startedAt: syncOut.syncRecord.startedAt,
    finishedAt: syncOut.syncRecord.finishedAt,
    appliedRange: appliedRange,
    changedReservations: syncOut.changedReservations,
    neonSync: neonSyncMeta
  };
}

function getSyncStatus(session) {
  requireApiAccess(session);
  var logs = readRecentRecords_(RG_SHEETS.SYNC_LOG, 30);
  logs.sort(function (a, b) {
    return String(b.startedAt).localeCompare(String(a.startedAt));
  });
  var map = getSettingsMap_(false);
  var interval = typeof normalizeAutoSyncParts_ === 'function'
    ? normalizeAutoSyncParts_(map.auto_sync_interval_hours, map.auto_sync_interval_minutes)
    : { hours: map.auto_sync_interval_hours !== undefined ? toNumber(map.auto_sync_interval_hours, 12) : 12, minutes: toNumber(map.auto_sync_interval_minutes, 0) };
  return {
    hasToken: Boolean(getRgToken()),
    autoSyncEnabled: map.auto_sync_enabled !== undefined ? toBool(map.auto_sync_enabled) : true,
    autoSyncIntervalHours: interval.hours,
    autoSyncIntervalMinutes: interval.minutes,
    lastSync: logs.length > 0 ? logs[0] : null,
    logs: logs.slice(0, 20)
  };
}
