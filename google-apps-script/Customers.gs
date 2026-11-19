/**
 * RENTAL GATE CRM — Customers Directory & CRUD Service (Strict ES5)
 */

function formatCustomerRecordForClient_(row) {
  var c = row || {};
  return {
    id: normalizeStr(c.id),
    name: normalizeStr(c.name),
    phone: normalizeStr(c.phone),
    email: normalizeStr(c.email),
    idNumber: normalizeStr(c.idNumber),
    companyName: normalizeStr(c.companyName),
    notes: normalizeStr(c.notes),
    status: normalizeStr(c.status) || 'active',
    createdAt: normalizeStr(c.createdAt),
    updatedAt: normalizeStr(c.updatedAt)
  };
}

function getCustomers(session, payload) {
  var canRead = hasPermission(session, 'view_dashboard') ||
    hasPermission(session, 'view_all_reservations') ||
    hasPermission(session, 'add_followup') ||
    hasPermission(session, 'edit_reservation_details');
  if (!canRead) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية استعراض بيانات العملاء.');
  }

  var p = payload || {};
  var search = normalizeStr(p.search).toLowerCase();
  var limit = Math.min(500, Math.max(10, toNumber(p.limit, 100)));
  var all = readAllRecords(RG_SHEETS.CUSTOMERS, false);
  var items = [];

  for (var i = 0; i < all.length; i++) {
    var row = all[i];
    if (!row || !row.id) continue;
    if (normalizeStr(row.deletedAt) || normalizeStr(row.status) === 'deleted') continue;
    if (search) {
      var hay = (normalizeStr(row.name) + ' ' + normalizeStr(row.phone) + ' ' + normalizeStr(row.companyName)).toLowerCase();
      if (hay.indexOf(search) === -1) continue;
    }
    items.push(formatCustomerRecordForClient_(row));
  }

  items.sort(function (a, b) {
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  if (items.length > limit) {
    items = items.slice(0, limit);
  }
  return { items: items, total: items.length };
}

function createCustomer(session, payload) {
  if (!hasPermission(session, 'add_followup') && !hasPermission(session, 'edit_reservation_details')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية إضافة عملاء.');
  }

  var p = payload || {};
  var name = normalizeStr(p.name || p.customerName);
  if (!name) throw new Error('VALIDATION_ERROR: اسم العميل مطلوب.');

  return withScriptLock(function () {
    var now = nowIso();
    var cust = {
      id: normalizeStr(p.id) || generateId('CUST'),
      name: name,
      phone: normalizeStr(p.phone || p.customerPhone),
      email: normalizeStr(p.email || p.customerEmail),
      idNumber: normalizeStr(p.idNumber || p.customerIdNumber),
      companyName: normalizeStr(p.companyName),
      notes: normalizeStr(p.notes),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: ''
    };

    appendRecord(RG_SHEETS.CUSTOMERS, cust);
    logActivity(session.user, 'إضافة عميل', 'Customer', cust.id, cust.name);
    return { customer: formatCustomerRecordForClient_(cust) };
  });
}

function updateCustomer(session, payload) {
  if (!hasPermission(session, 'add_followup') && !hasPermission(session, 'edit_reservation_details')) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية تعديل بيانات العملاء.');
  }

  var p = payload || {};
  var custId = normalizeStr(p.customerId || p.id);
  if (!custId) throw new Error('VALIDATION_ERROR: معرف العميل مطلوب.');
  if (p.name !== undefined && !normalizeStr(p.name)) {
    throw new Error('VALIDATION_ERROR: اسم العميل مطلوب.');
  }

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.CUSTOMERS, 'id', custId);
    if (!existing || normalizeStr(existing.deletedAt) || normalizeStr(existing.status) === 'deleted') {
      throw new Error('NOT_FOUND: العميل غير موجود.');
    }

    var now = nowIso();
    var patch = {
      name: p.name !== undefined ? normalizeStr(p.name) : normalizeStr(existing.name),
      phone: p.phone !== undefined ? normalizeStr(p.phone) : normalizeStr(existing.phone),
      email: p.email !== undefined ? normalizeStr(p.email) : normalizeStr(existing.email),
      idNumber: p.idNumber !== undefined ? normalizeStr(p.idNumber) : normalizeStr(existing.idNumber),
      companyName: p.companyName !== undefined ? normalizeStr(p.companyName) : normalizeStr(existing.companyName),
      notes: p.notes !== undefined ? normalizeStr(p.notes) : normalizeStr(existing.notes),
      status: p.status !== undefined ? normalizeStr(p.status) : (normalizeStr(existing.status) || 'active'),
      updatedAt: now
    };

    var updated = updateRecordByKey(RG_SHEETS.CUSTOMERS, 'id', custId, patch);
    logActivity(session.user, 'تحديث عميل', 'Customer', custId, patch.name);
    return { customer: formatCustomerRecordForClient_(updated || patch) };
  });
}

function deleteCustomer(session, payload) {
  requirePermission(session, 'edit_reservation_details');
  var p = payload || {};
  var custId = normalizeStr(p.customerId || p.id);
  if (!custId) throw new Error('VALIDATION_ERROR: معرف العميل مطلوب.');

  return withScriptLock(function () {
    var existing = findRecordById(RG_SHEETS.CUSTOMERS, 'id', custId);
    if (!existing || normalizeStr(existing.deletedAt) || normalizeStr(existing.status) === 'deleted') {
      throw new Error('NOT_FOUND: العميل غير موجود.');
    }

    var now = nowIso();
    updateRecordByKey(RG_SHEETS.CUSTOMERS, 'id', custId, {
      status: 'deleted',
      deletedAt: now,
      updatedAt: now
    });
    logActivity(session.user, 'حذف عميل', 'Customer', custId, normalizeStr(existing.name));
    return { deleted: true, customerId: custId };
  });
}
