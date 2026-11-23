/**
 * RENTAL GATE CRM — Scheduled Triggers Service
 */

function configureAutoSyncTrigger(hours, enabled, minutes) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledAutoSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  var interval = typeof normalizeAutoSyncParts_ === 'function'
    ? normalizeAutoSyncParts_(hours, minutes)
    : { hours: Math.max(0, Math.min(168, Math.round(toNumber(hours, 12)))), minutes: Math.max(0, Math.min(59, Math.round(toNumber(minutes, 0)))), totalMinutes: 720 };

  if (!enabled) {
    return { enabled: false, intervalHours: interval.hours, intervalMinutes: interval.minutes, totalMinutes: interval.totalMinutes };
  }

  var totalMin = Math.max(1, Math.min(10080, interval.totalMinutes));
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  var builder = ScriptApp.newTrigger('scheduledAutoSync').timeBased();
  if (totalMin < 60) {
    if ([1, 5, 10, 15, 30].indexOf(totalMin) !== -1) {
      builder.everyMinutes(totalMin).create();
    } else if (totalMin % 5 === 0) {
      builder.everyMinutes(5).create();
    } else {
      builder.everyMinutes(1).create();
    }
  } else if (m === 0 && [1, 2, 4, 6, 8, 12].indexOf(h) !== -1) {
    builder.everyHours(h).create();
  } else if (m === 0 && h >= 24 && h % 24 === 0) {
    builder.everyDays(Math.round(h / 24)).create();
  } else if (m !== 0) {
    builder.everyMinutes(m % 5 === 0 ? 5 : 1).create();
  } else {
    builder.everyHours(1).create();
  }
  return { enabled: true, intervalHours: h, intervalMinutes: m, totalMinutes: totalMin };
}

function scheduledAutoSync() {
  var enabledRec = findRecordById(RG_SHEETS.SETTINGS, 'key', 'auto_sync_enabled');
  var enabled = enabledRec ? toBool(enabledRec.value) : true;
  if (!enabled) return;

  var intervalRec = findRecordById(RG_SHEETS.SETTINGS, 'key', 'auto_sync_interval_hours');
  var minutesRec = findRecordById(RG_SHEETS.SETTINGS, 'key', 'auto_sync_interval_minutes');
  var interval = typeof normalizeAutoSyncParts_ === 'function'
    ? normalizeAutoSyncParts_(intervalRec ? intervalRec.value : undefined, minutesRec ? minutesRec.value : undefined)
    : { hours: 12, minutes: 0, totalMinutes: 720 };

  var logs = readRecentRecords_(RG_SHEETS.SYNC_LOG, 10);
  if (logs.length > 0) {
    logs.sort(function (a, b) {
      return String(b.finishedAt || b.startedAt).localeCompare(String(a.finishedAt || a.startedAt));
    });
    var lastTime = new Date(logs[0].finishedAt || logs[0].startedAt).getTime();
    if (!isNaN(lastTime)) {
      var elapsedMinutes = (Date.now() - lastTime) / 60000;
      if (elapsedMinutes < Math.max(0, interval.totalMinutes - 0.15)) {
        return;
      }
    }
  }

  var intervalLabel = typeof formatAutoSyncIntervalAr_ === 'function'
    ? formatAutoSyncIntervalAr_(interval.hours, interval.minutes)
    : ('كل ' + interval.hours + ' ساعة');
  runRentalGateSyncInternal({
    id: 'SYSTEM',
    employeeId: 'SYSTEM',
    name: 'المزامنة التلقائية (' + intervalLabel + ')',
    role: 'system'
  });
}

function getTriggerStatus(session) {
  requireApiAccess(session);
  var triggers = ScriptApp.getProjectTriggers();
  var active = [];
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'scheduledAutoSync' || fn === 'scheduledMinuteSync') {
      active.push({
        id: triggers[i].getUniqueId(),
        handler: fn,
        eventType: String(triggers[i].getEventType())
      });
    }
  }
  return { count: active.length, triggers: active };
}
