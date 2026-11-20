/**
 * RENTAL GATE CRM — System Settings (Token & Secrets Never Exposed)
 */

function normalizeAutoSyncParts_(hoursVal, minutesVal) {
  var hasH = hoursVal !== undefined && hoursVal !== null && String(hoursVal).trim() !== '';
  var hasM = minutesVal !== undefined && minutesVal !== null && String(minutesVal).trim() !== '';
  var total = (!hasH && !hasM)
    ? 720
    : Math.round(Math.max(0, hasH ? toNumber(hoursVal, 0) : 0) * 60 + Math.max(0, hasM ? toNumber(minutesVal, 0) : 0));
  if (!isFinite(total) || total < 1) total = 1;
  if (total > 10080) total = 10080;
  return {
    hours: Math.floor(total / 60),
    minutes: total % 60,
    totalMinutes: total
  };
}

function formatAutoSyncIntervalAr_(hoursVal, minutesVal) {
  var norm = normalizeAutoSyncParts_(hoursVal, minutesVal);
  var parts = [];
  if (norm.hours > 0) parts.push(norm.hours + ' ساعة');
  if (norm.minutes > 0) parts.push(norm.minutes + ' دقيقة');
  return 'كل ' + parts.join(' و');
}

function normalizeUiSimplificationSettings_(raw) {
  var obj = typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {});
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  var rawPreset = normalizeStr(obj.preset).toLowerCase();
  var preset = (rawPreset === 'small' || rawPreset === 'medium' || rawPreset === 'full' || rawPreset === 'custom')
    ? rawPreset
    : 'full';
  var defaults = {
    full: { hideSecondaryCarMeta: false, hideCustomerContactExtras: false, hideFinancialBreakdown: false, hideDrawerCharts: false, hideDashboardRadar: false, hideDashboardHeatmap: false },
    medium: { hideSecondaryCarMeta: false, hideCustomerContactExtras: true, hideFinancialBreakdown: false, hideDrawerCharts: true, hideDashboardRadar: false, hideDashboardHeatmap: false },
    small: { hideSecondaryCarMeta: true, hideCustomerContactExtras: true, hideFinancialBreakdown: true, hideDrawerCharts: true, hideDashboardRadar: false, hideDashboardHeatmap: true },
    custom: { hideSecondaryCarMeta: false, hideCustomerContactExtras: false, hideFinancialBreakdown: false, hideDrawerCharts: false, hideDashboardRadar: false, hideDashboardHeatmap: false }
  };
  var base = defaults[preset] || defaults.full;
  function pickBool(k) {
    if (preset !== 'custom' && obj[k] === undefined) return Boolean(base[k]);
    if (obj[k] !== undefined) return obj[k] === true || obj[k] === 'true' || obj[k] === 1;
    return Boolean(base[k]);
  }
  return {
    preset: preset,
    hideSecondaryCarMeta: pickBool('hideSecondaryCarMeta'),
    hideCustomerContactExtras: pickBool('hideCustomerContactExtras'),
    hideFinancialBreakdown: pickBool('hideFinancialBreakdown'),
    hideDrawerCharts: pickBool('hideDrawerCharts'),
    hideDashboardRadar: pickBool('hideDashboardRadar'),
    hideDashboardHeatmap: pickBool('hideDashboardHeatmap')
  };
}

function getSettings(session) {
  requireApiAccess(session);
  var map = getSettingsMap_(false);

  var interval = normalizeAutoSyncParts_(map.auto_sync_interval_hours, map.auto_sync_interval_minutes);
  var autoSyncEnabled = map.auto_sync_enabled !== undefined ? toBool(map.auto_sync_enabled) : true;

  return {
    company_name: map.company_name || 'RENTAL GATE',
    excluded_statuses: safeJsonParse(map.excluded_statuses, ['draft', 'test', 'abandoned']),
    session_ttl_hours: toNumber(map.session_ttl_hours, 24),
    allow_agent_view_all: toBool(map.allow_agent_view_all !== undefined ? map.allow_agent_view_all : 'true'),
    default_language: map.default_language || 'ar',
    auto_sync_enabled: autoSyncEnabled,
    auto_sync_interval_hours: interval.hours,
    auto_sync_interval_minutes: interval.minutes,
    ui_simplification: normalizeUiSimplificationSettings_(map.ui_simplification),
    hasRgToken: Boolean(getRgToken())
  };
}

function updateSettings(session, payload) {
  requirePermission(session, 'manage_settings');

  var p = payload || {};
  return withScriptLock(function () {
    var existingMap = getSettingsMap_(false);
    var intervalChanged = Object.prototype.hasOwnProperty.call(p, 'auto_sync_interval_hours') ||
      Object.prototype.hasOwnProperty.call(p, 'auto_sync_interval_minutes');

    var allowedKeys = [
      'company_name',
      'excluded_statuses',
      'session_ttl_hours',
      'allow_agent_view_all',
      'default_language',
      'auto_sync_enabled',
      'ui_simplification'
    ];

    for (var i = 0; i < allowedKeys.length; i++) {
      var k = allowedKeys[i];
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      var val = p[k];
      if (k === 'excluded_statuses' && Array.isArray(val)) {
        val = JSON.stringify(val);
      } else if (k === 'ui_simplification') {
        val = JSON.stringify(normalizeUiSimplificationSettings_(val));
      } else if (k === 'auto_sync_enabled') {
        val = toBool(val) ? 'true' : 'false';
      } else {
        val = String(val);
      }
      upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', k, {
        key: k,
        value: val,
        updatedBy: session.user.name,
        updatedAt: nowIso()
      });
    }

    if (intervalChanged) {
      var nextInterval = normalizeAutoSyncParts_(
        Object.prototype.hasOwnProperty.call(p, 'auto_sync_interval_hours') ? p.auto_sync_interval_hours : existingMap.auto_sync_interval_hours,
        Object.prototype.hasOwnProperty.call(p, 'auto_sync_interval_minutes') ? p.auto_sync_interval_minutes : existingMap.auto_sync_interval_minutes
      );
      upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', 'auto_sync_interval_hours', {
        key: 'auto_sync_interval_hours',
        value: String(nextInterval.hours),
        updatedBy: session.user.name,
        updatedAt: nowIso()
      });
      upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', 'auto_sync_interval_minutes', {
        key: 'auto_sync_interval_minutes',
        value: String(nextInterval.minutes),
        updatedBy: session.user.name,
        updatedAt: nowIso()
      });
    }

    var current = getSettings(session);
    configureAutoSyncTrigger(current.auto_sync_interval_hours, current.auto_sync_enabled, current.auto_sync_interval_minutes);

    logActivity(session.user, 'تحديث الإعدادات', 'Settings', 'system',
      'تم تحديث إعدادات النظام (التحديث التلقائي: ' + (current.auto_sync_enabled ? formatAutoSyncIntervalAr_(current.auto_sync_interval_hours, current.auto_sync_interval_minutes) : 'متوقف') + ')');
    return current;
  });
}

var RG_NAV_ROUTE_IDS_ = ['dashboard', 'reservations', 'my-followups', 'team-followups', 'problems', 'reports', 'employees', 'activity', 'settings'];
var RG_PROTECTED_NAV_ROUTES_ = ['dashboard', 'settings'];
var RG_DASHBOARD_SECTION_IDS_ = ['hero_kpis', 'strip_kpis', 'daily_chart', 'recent_activity', 'charts_grid', 'expiry_radar', 'peak_heatmap', 'bottom_bento'];

function normalizeLayoutPermList_(rawList, canonicalIds) {
  var seen = {};
  var allowed = {};
  for (var i = 0; i < canonicalIds.length; i++) allowed[canonicalIds[i]] = true;
  var out = [];
  var src = Array.isArray(rawList) ? rawList : [];
  for (var j = 0; j < src.length; j++) {
    var id = normalizeStr(src[j]);
    if (!id || !allowed[id] || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  for (var k = 0; k < canonicalIds.length; k++) {
    if (!seen[canonicalIds[k]]) out.push(canonicalIds[k]);
  }
  return out;
}

function normalizeUserLayoutPrefs_(raw) {
  var obj = typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {});
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  var navOrder = normalizeLayoutPermList_(obj.navOrder, RG_NAV_ROUTE_IDS_);
  var dashOrder = normalizeLayoutPermList_(obj.dashOrder, RG_DASHBOARD_SECTION_IDS_);

  var hiddenNavSeen = {};
  var rawHiddenRoutes = Array.isArray(obj.hiddenRoutes) ? obj.hiddenRoutes : [];
  var hiddenRoutes = [];
  for (var i = 0; i < rawHiddenRoutes.length; i++) {
    var rid = normalizeStr(rawHiddenRoutes[i]);
    if (!rid || RG_NAV_ROUTE_IDS_.indexOf(rid) === -1 || RG_PROTECTED_NAV_ROUTES_.indexOf(rid) !== -1 || hiddenNavSeen[rid]) continue;
    hiddenNavSeen[rid] = true;
    hiddenRoutes.push(rid);
  }

  var hiddenDashSeen = {};
  var rawDashHidden = Array.isArray(obj.dashHidden) ? obj.dashHidden : [];
  var dashHidden = [];
  for (var j = 0; j < rawDashHidden.length; j++) {
    var did = normalizeStr(rawDashHidden[j]);
    if (!did || RG_DASHBOARD_SECTION_IDS_.indexOf(did) === -1 || hiddenDashSeen[did]) continue;
    hiddenDashSeen[did] = true;
    dashHidden.push(did);
  }

  return {
    navOrder: navOrder,
    hiddenRoutes: hiddenRoutes,
    dashOrder: dashOrder,
    dashHidden: dashHidden
  };
}

function saveUserLayoutPrefs(session, payload) {
  if (!session || !session.employeeId || !session.user) {
    throw new Error('UNAUTHORIZED: الجلسة غير صالحة.');
  }
  var normalized = normalizeUserLayoutPrefs_(payload);
  var key = 'layout_prefs_u_' + session.employeeId;
  return withScriptLock(function () {
    upsertRecordByKey(RG_SHEETS.SETTINGS, 'key', key, {
      key: key,
      value: JSON.stringify(normalized),
      updatedBy: session.user.name,
      updatedAt: nowIso()
    });
    return { layoutPrefs: normalized };
  });
}

