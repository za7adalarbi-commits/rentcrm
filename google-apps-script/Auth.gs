/**
 * RENTAL GATE CRM — Authentication, Sessions & Server-Side RBAC
 */

function sha256Hex(input) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(input), Utilities.Charset.UTF_8);
  var hex = [];
  for (var i = 0; i < digest.length; i++) {
    var b = (digest[i] + 256) % 256;
    var s = b.toString(16);
    if (s.length === 1) s = '0' + s;
    hex.push(s);
  }
  return hex.join('');
}

function hashPassword(password, salt) {
  return sha256Hex(String(salt) + '::RENTAL_GATE_CRM::' + String(password));
}

function hashToken(rawToken) {
  return sha256Hex('TOKEN::' + String(rawToken));
}

function getSessionTtlHours() {
  var rec = findRecordById(RG_SHEETS.SETTINGS, 'key', 'session_ttl_hours');
  var h = rec ? toNumber(rec.value, 24) : 24;
  return h > 0 ? h : 24;
}

var RG_SESSION_CACHE_PREFIX = 'RG_SES_';
var RG_SESSION_CACHE_TTL = 300;

function cacheSession_(tokenHash, sessionObj, expiresAtIso) {
  try {
    var payload = {
      tokenHash: tokenHash,
      employeeId: sessionObj.employeeId,
      role: sessionObj.role,
      permissions: sessionObj.permissions,
      user: sessionObj.user,
      expiresAt: expiresAtIso
    };
    CacheService.getScriptCache().put(RG_SESSION_CACHE_PREFIX + tokenHash, JSON.stringify(payload), RG_SESSION_CACHE_TTL);
  } catch (e) {}
}

function clearCachedSession_(tokenHash) {
  if (!tokenHash) return;
  try {
    CacheService.getScriptCache().remove(RG_SESSION_CACHE_PREFIX + tokenHash);
  } catch (e) {}
}

function clearEmployeeSessionCache_(employeeId) {
  var targetId = normalizeStr(employeeId);
  if (!targetId) return;
  try {
    var sessions = readAllRecords(RG_SHEETS.SESSIONS, false);
    var keys = [];
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].employeeId === targetId && !toBool(sessions[i].isRevoked) && sessions[i].tokenHash) {
        keys.push(RG_SESSION_CACHE_PREFIX + sessions[i].tokenHash);
      }
    }
    if (keys.length > 0) {
      CacheService.getScriptCache().removeAll(keys);
    }
  } catch (e) {}
}

function isDelegationActiveGas_(item, nowMs) {
  if (!item || typeof item !== 'object') return false;
  if (normalizeStr(item.status).toLowerCase() !== 'active') return false;
  if (normalizeStr(item.revokedAt)) return false;
  var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  var sMs = item.startsAt ? Date.parse(item.startsAt) : 0;
  var eMs = item.expiresAt ? Date.parse(item.expiresAt) : 0;
  if (sMs && !isNaN(sMs) && now < sMs) return false;
  if (eMs && !isNaN(eMs) && now > eMs) return false;
  return Boolean(eMs && !isNaN(eMs));
}

function resolveActiveDelegationForEmployee_(employeeId) {
  var targetId = normalizeStr(employeeId);
  if (!targetId) return null;
  try {
    var list = readAllRecords(RG_SHEETS.DELEGATIONS, false);
    var nowMs = Date.now();
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (normalizeStr(d.delegateEmployeeId) !== targetId) continue;
      if (!isDelegationActiveGas_(d, nowMs)) continue;
      return {
        id: d.id,
        delegatedRole: d.delegatedRole || RG_ROLES.SUPERVISOR,
        grantedById: d.grantedById,
        grantedByName: d.grantedByName,
        reason: d.reason,
        startsAt: d.startsAt,
        expiresAt: d.expiresAt
      };
    }
  } catch (e) {}
  return null;
}

function applyDelegationToCleanUser_(cleanUser) {
  if (!cleanUser || typeof cleanUser !== 'object') return cleanUser;
  var baseRole = normalizeStr(cleanUser.role) || RG_ROLES.AGENT;
  var basePerms = resolveEffectivePermissions(cleanUser);
  if (baseRole === RG_ROLES.AGENT) {
    var activeDel = resolveActiveDelegationForEmployee_(cleanUser.id);
    if (activeDel) {
      var supPerms = RG_ROLE_PERMISSIONS.supervisor || [];
      var merged = [];
      var seen = {};
      for (var i = 0; i < basePerms.length; i++) {
        if (!seen[basePerms[i]]) { seen[basePerms[i]] = true; merged.push(basePerms[i]); }
      }
      for (var j = 0; j < supPerms.length; j++) {
        if (!seen[supPerms[j]]) { seen[supPerms[j]] = true; merged.push(supPerms[j]); }
      }
      cleanUser.baseRole = baseRole;
      cleanUser.role = RG_ROLES.SUPERVISOR;
      cleanUser.permissions = merged;
      cleanUser.activeDelegation = activeDel;
      return cleanUser;
    }
  }
  cleanUser.baseRole = baseRole;
  cleanUser.permissions = basePerms;
  cleanUser.activeDelegation = null;
  return cleanUser;
}

function handleLogin(payload) {
  var p = payload || {};
  var username = normalizeLoginUsername_(p.username);
  var password = String(p.password || '');

  if (!username || !password) {
    throw new Error('يرجى إدخال اسم المستخدم وكلمة المرور.');
  }

  var authResult = withScriptLock(function () {
    var employees = readAllRecords(RG_SHEETS.EMPLOYEES, false);
    if (employees.length === 0) {
      initDatabaseCore_();
      employees = readAllRecords(RG_SHEETS.EMPLOYEES, true);
    }

    var findByUname = function (list) {
      for (var i = 0; i < list.length; i++) {
        if (normalizeLoginUsername_(list[i].username) === username) {
          return list[i];
        }
      }
      return null;
    };

    var user = findByUname(employees);
    if (!user) {
      // Fallback uncached read in case an admin edited Employees sheet manually
      employees = readAllRecords(RG_SHEETS.EMPLOYEES, true);
      user = findByUname(employees);
    }

    if (!user) {
      throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
    }

    if (normalizeStr(user.status).toLowerCase() !== 'active') {
      throw new Error('هذا الحساب موقوف حاليًا. يرجى مراجعة المدير العام.');
    }

    var expectedHash = hashPassword(password, normalizeStr(user.salt));
    if (expectedHash !== normalizeStr(user.passwordHash)) {
      throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
    }

    var rawToken = generateId('SES') + '_' + Utilities.getUuid().replace(/-/g, '');
    var tokenHash = hashToken(rawToken);
    var ttlHours = getSessionTtlHours();
    var now = new Date();
    var expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);
    var expiresIso = expiresAt.toISOString();

    appendRecord(RG_SHEETS.SESSIONS, {
      tokenHash: tokenHash,
      employeeId: user.id,
      username: user.username,
      role: user.role,
      expiresAt: expiresIso,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      isRevoked: 'false'
    });

    var nowIsoStr = now.toISOString();
    touchEmployeeActivityThrottled_(user.id, nowIsoStr);

    var cleanUser = applyDelegationToCleanUser_(sanitizeEmployeeForClient(user));
    cleanUser.lastActivity = nowIsoStr;

    var sessionObj = {
      tokenHash: tokenHash,
      employeeId: cleanUser.id,
      role: cleanUser.role,
      permissions: cleanUser.permissions,
      user: cleanUser
    };
    cacheSession_(tokenHash, sessionObj, expiresIso);

    logActivity(user, 'تسجيل الدخول', 'Employee', user.id, 'تسجيل دخول ناجح للمستخدم ' + user.username);

    return {
      token: rawToken,
      expiresAt: expiresIso,
      user: cleanUser,
      sessionObj: sessionObj
    };
  });

  var response = {
    token: authResult.token,
    expiresAt: authResult.expiresAt,
    user: authResult.user
  };
  if (p.includeBootstrap !== false) {
    response.bootstrap = getAppBootstrap(authResult.sessionObj, {
      range: normalizeStr(p.range) || '30d'
    });
  }
  return response;
}

function handleLogout(session) {
  return withScriptLock(function () {
    updateRecordByKey(RG_SHEETS.SESSIONS, 'tokenHash', session.tokenHash, {
      isRevoked: 'true',
      lastSeenAt: nowIso()
    });
    clearCachedSession_(session.tokenHash);
    logActivity(session.user, 'تسجيل الخروج', 'Employee', session.user.id, 'تسجيل خروج');
    return { loggedOut: true };
  });
}

function requireAuth(token) {
  var rawToken = normalizeStr(token);
  if (!rawToken) {
    throw new Error('UNAUTHORIZED: جلسة غير مصرح بها، يرجى تسجيل الدخول.');
  }

  var tokenHash = hashToken(rawToken);
  try {
    var cachedRaw = CacheService.getScriptCache().get(RG_SESSION_CACHE_PREFIX + tokenHash);
    if (cachedRaw) {
      var cached = JSON.parse(cachedRaw);
      var delExp = cached && cached.user && cached.user.activeDelegation && cached.user.activeDelegation.expiresAt
        ? Date.parse(cached.user.activeDelegation.expiresAt)
        : 0;
      var delegationStillValid = !delExp || (!isNaN(delExp) && delExp > Date.now());
      if (cached && cached.expiresAt && new Date(cached.expiresAt).getTime() > Date.now() && delegationStillValid) {
        return {
          tokenHash: tokenHash,
          employeeId: cached.employeeId,
          role: cached.role,
          permissions: cached.permissions,
          user: cached.user
        };
      }
      clearCachedSession_(tokenHash);
    }
  } catch (e) {}

  var sessionRec = findRecordById(RG_SHEETS.SESSIONS, 'tokenHash', tokenHash);
  if (!sessionRec || toBool(sessionRec.isRevoked)) {
    throw new Error('UNAUTHORIZED: الجلسة منتهية أو تم تسجيل الخروج.');
  }

  if (new Date(sessionRec.expiresAt).getTime() <= Date.now()) {
    throw new Error('UNAUTHORIZED: انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا.');
  }

  var user = findRecordById(RG_SHEETS.EMPLOYEES, 'id', sessionRec.employeeId);
  if (!user || normalizeStr(user.status) !== 'active') {
    throw new Error('UNAUTHORIZED: الحساب غير نشط أو غير موجود.');
  }

  var cleanUser = applyDelegationToCleanUser_(sanitizeEmployeeForClient(user));
  var result = {
    tokenHash: tokenHash,
    employeeId: cleanUser.id,
    role: cleanUser.role,
    permissions: cleanUser.permissions,
    user: cleanUser
  };
  cacheSession_(tokenHash, result, sessionRec.expiresAt);
  return result;
}

function requireRole(session, allowedRoles) {
  if (!session || !session.role) {
    throw new Error('FORBIDDEN: لا توجد صلاحية صالحة.');
  }
  if (allowedRoles.indexOf(session.role) === -1) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية تنفيذ هذا الإجراء.');
  }
}

function requirePermission(session, action) {
  if (!session || !hasPermission(session, action)) {
    throw new Error('FORBIDDEN: ليس لديك صلاحية تنفيذ هذا الإجراء (' + action + ').');
  }
}

function requireApiAccess(session) {
  if (!session || !canAccessApi(session.user || session)) {
    throw new Error('FORBIDDEN: صلاحيات API وإعدادات الربط مخصصة للمدير العام والمشرف فقط.');
  }
}

function revokeEmployeeSessions(employeeId) {
  var targetId = normalizeStr(employeeId);
  if (!targetId) return;
  var revoked = updateRecordsWhere_(
    RG_SHEETS.SESSIONS,
    function (s) { return s.employeeId === targetId && !toBool(s.isRevoked); },
    { isRevoked: 'true', lastSeenAt: nowIso() }
  );
  if (revoked.length > 0) {
    try {
      var keys = [];
      for (var i = 0; i < revoked.length; i++) {
        if (revoked[i].tokenHash) keys.push(RG_SESSION_CACHE_PREFIX + revoked[i].tokenHash);
      }
      if (keys.length > 0) CacheService.getScriptCache().removeAll(keys);
    } catch (e) {}
  }
}
