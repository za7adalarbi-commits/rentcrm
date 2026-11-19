/**
 * RENTAL GATE CRM — System Settings (Token & Secrets Never Exposed)
 */

function getSettings(session) {
  requireApiAccess(session);
  var map = getSettingsMap_(false);

  var intervalHours = Math.max(1, Math.min(168, toNumber(map.auto_sync_interval_hours, 12)));
  var autoSyncEnabled = map.auto_sync_enabled !== undefined ? toBool(map.auto_sync_enabled) : true;

  return {
    company_name: map.company_name || 'RENTAL GATE',
    excluded_statuses: safeJsonParse(map.excluded_statuses, ['draft', 'test', 'abandoned']),
    session_ttl_hours: toNumber(map.session_ttl_hours, 24),
    allow_agent_view_all: toBool(map.allow_agent_view_all !== undefined ? map.allow_agent_view_all : 'true'),
    default_language: map.default_language || 'ar',
    auto_sync_enabled: autoSyncEnabled,
    auto_sync_interval_hours: intervalHours,
    hasRgToken: Boolean(getRgToken())
  };
}

function updateSettings(session, payload) {
  requirePermission(session, 'manage_settings');

  var p = payload || {};
  return withScriptLock(function () {
    var allowedKeys = [
      'company_name',
      'excluded_statuses',
      'session_ttl_hours',
      'allow_agent_view_all',
      'default_language',
      'auto_sync_enabled',
      'auto_sync_interval_hours'
    ];

    for (var i = 0; i < allowedKeys.length; i++) {
      var k = allowedKeys[i];
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      var val = p[k];
      if (k === 'excluded_statuses' && Array.isArray(val)) {
        val = JSON.stringify(val);
      } else if (k === 'auto_sync_interval_hours') {
        val = String(Math.max(1, Math.min(168, toNumber(val, 12))));
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

    var current = getSettings(session);
    configureAutoSyncTrigger(current.auto_sync_interval_hours, current.auto_sync_enabled);

    logActivity(session.user, 'تحديث الإعدادات', 'Settings', 'system',
      'تم تحديث إعدادات النظام (التحديث التلقائي: ' + (current.auto_sync_enabled ? ('كل ' + current.auto_sync_interval_hours + ' ساعة') : 'متوقف') + ')');
    return current;
  });
}

function applyAutoConnectConfig(session, payload) {
  requirePermission(session, 'manage_settings');
  var p = payload || {};
  var props = PropertiesService.getScriptProperties();
  var updates = {};
  var updatedKeys = [];

  var rgToken = normalizeStr(p.rgToken || p.token || p.rentalToken).replace(/^Bearer\s+/i, '');
  if (rgToken) {
    if (rgToken.length < 16 || /\s/.test(rgToken)) {
      throw new Error('صيغة توكن Rental Gate غير صالحة. تأكد من لصق التوكن بدون مسافات.');
    }
    updates.RG_TOKEN = rgToken;
    updates.RENTAL_TOKEN = rgToken;
    updatedKeys.push('RG_TOKEN', 'RENTAL_TOKEN');
  }

  var spreadsheetId = normalizeStr(p.spreadsheetId);
  if (spreadsheetId) {
    updates.SPREADSHEET_ID = spreadsheetId;
    updatedKeys.push('SPREADSHEET_ID');
  }

  var neonSyncUrl = normalizeStr(p.neonSyncUrl);
  if (neonSyncUrl) {
    updates.NEON_SYNC_URL = neonSyncUrl;
    updatedKeys.push('NEON_SYNC_URL');
  }

  var syncSecret = normalizeStr(p.syncSecret);
  if (syncSecret) {
    updates.SYNC_API_SECRET = syncSecret;
    updatedKeys.push('SYNC_API_SECRET');
  }

  if (updatedKeys.length > 0) {
    props.setProperties(updates);
  }

  var dbInit = null;
  if (p.initDb !== false) {
    dbInit = initDatabase();
  }

  if (p.enableMinuteSync === true && typeof setupNeonEveryMinuteSync === 'function') {
    setupNeonEveryMinuteSync(true);
  }

  logActivity(
    session.user,
    'الربط التلقائي الشامل',
    'Settings',
    'AUTO_CONNECT',
    'تم تحديث خصائص Apps Script: ' + (updatedKeys.length ? updatedKeys.join(', ') : 'التحقق وتهيئة التبويبات')
  );

  var connCheck = null;
  if (p.testConnection !== false && getRgToken()) {
    connCheck = testRentalGateConnection(session);
  }

  return {
    saved: true,
    updatedKeys: updatedKeys,
    hasRgToken: Boolean(getRgToken()),
    spreadsheetId: dbInit && dbInit.spreadsheetId ? dbInit.spreadsheetId : normalizeStr(props.getProperty('SPREADSHEET_ID')),
    hasNeonSync: Boolean(props.getProperty('NEON_SYNC_URL') && props.getProperty('SYNC_API_SECRET')),
    connection: connCheck
  };
}

