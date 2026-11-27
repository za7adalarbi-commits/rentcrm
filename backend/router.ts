import { crmCore, handleLogin, handleLogout, hashToken, invalidateAuthSessionCache, requireAuth, type AuthSession } from './auth.js';
import { checkMutationSpamLimit, getMutationSyncSpec, invalidateAndBumpVersion, runWithIdempotency } from './cache.js';
import { ensureSchemaInitialized, type DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { broadcastCrmEvent, publishPgNotify } from './realtime.js';
import * as integrityService from './integrityService.js';
import * as queries from './queries.js';

export interface CrmApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T | null;
  error: string | null;
}

export interface CrmDispatchRequest {
  action: string;
  token?: string;
  payload?: Record<string, any>;
}

export async function dispatchCrmRequest(
  executor: DbExecutor,
  req: CrmDispatchRequest
): Promise<CrmApiResponse> {
  const action = String(req.action || '').trim();
  const token = String(req.token || '').trim();
  const payload = (req.payload && typeof req.payload === 'object') ? req.payload : {};

  try {
    if (!action || action === 'ping') {
      return {
        success: true,
        message: 'RENTAL GATE CRM PostgreSQL API متصل ويعمل بنجاح.',
        data: {
          service: 'RENTAL GATE CRM (Neon PostgreSQL)',
          timestamp: new Date().toISOString()
        },
        error: null
      };
    }

    await ensureSchemaInitialized(executor);
    await queries.ensureSeededDatabase(executor);

    if (action === 'login') {
      const loginData = await handleLogin(executor, payload);
      if (payload.includeBootstrap) {
        const tempSession: AuthSession = {
          tokenHash: hashToken(loginData.token),
          employeeId: loginData.user.id,
          username: loginData.user.username,
          role: loginData.user.role,
          expiresAt: loginData.expiresAt,
          user: loginData.user
        };
        const bootstrap = await queries.getAppBootstrap(executor, tempSession, {
          range: payload.range || '30d'
        });
        return {
          success: true,
          message: 'تم تسجيل الدخول بنجاح.',
          data: { ...loginData, bootstrap },
          error: null
        };
      }
      return { success: true, message: 'تم تسجيل الدخول بنجاح.', data: loginData, error: null };
    }

    const session = await requireAuth(executor, token);
    const spamCheck = checkMutationSpamLimit(executor, session.user.id, action, payload);
    if (!spamCheck.allowed) {
      const code = spamCheck.reason || 'RATE_LIMITED';
      throw new Error(`${code}: ${spamCheck.message || 'تم رفض الطلب مؤقتًا بواسطة مانع التكرار.'}`);
    }
    const syncSpec = getMutationSyncSpec(action);
    const executeAction = async () => {
    let result: any = null;

    switch (action) {
      case 'logout':
        result = await handleLogout(executor, session);
        break;
      case 'getMe': {
        const meSettings = await queries.getSettingsMap(executor).catch(() => ({} as Record<string, any>));
        const meRoleDefaults = typeof crmCore.normalizeRoleUiDefaults === 'function'
          ? crmCore.normalizeRoleUiDefaults(meSettings.role_ui_defaults)
          : {};
        const meUiSimp = typeof crmCore.normalizeUiSimplificationSettings === 'function'
          ? crmCore.normalizeUiSimplificationSettings(meSettings.ui_simplification)
          : {};
        result = {
          user: session.user,
          layoutPrefs: await queries.getUserLayoutPrefs(executor, session),
          roleUiDefaults: meRoleDefaults,
          uiSimplification: meUiSimp
        };
        break;
      }
      case 'getAppBootstrap':
        result = await queries.getAppBootstrap(executor, session, payload);
        break;
      case 'getDashboard':
        result = await queries.getDashboard(executor, session, payload);
        break;
      case 'getTodayAndRadar':
        result = await queries.getTodayAndRadar(executor, session, payload);
        break;
      case 'getReservations':
        result = await queries.getReservations(executor, session, payload);
        break;
      case 'syncLocalCache':
        result = await queries.syncLocalCache(executor, session, payload);
        break;
      case 'getReservationDetails':
        result = await queries.getReservationDetails(executor, session, payload);
        break;
      case 'claimReservation':
        result = await queries.claimReservation(executor, session, payload);
        break;
      case 'unclaimReservation':
        result = await queries.unclaimReservation(executor, session, payload);
        break;
      case 'quickUpdateReservationStatus':
        result = await queries.quickUpdateReservationStatus(executor, session, payload);
        break;
      case 'updateReservationDetails':
        result = await queries.updateReservationDetails(executor, session, payload);
        break;
      case 'saveReservationPinnedNote':
        result = await queries.saveReservationPinnedNote(executor, session, payload);
        break;
      case 'recordNoAnswerFollowUp':
        result = await queries.recordNoAnswerFollowUp(executor, session, payload);
        break;
      case 'togglePinnedCriticalReservation':
        result = await queries.togglePinnedCriticalReservation(executor, session, payload);
        break;
      case 'addFollowUp':
        result = await queries.addFollowUp(executor, session, payload);
        break;
      case 'updateFollowUp':
        result = await queries.updateFollowUp(executor, session, payload);
        break;
      case 'deleteFollowUp':
        result = await queries.deleteFollowUp(executor, session, payload);
        break;
      case 'getFollowUpHistory':
        result = await queries.getFollowUpHistory(executor, session, payload);
        break;
      case 'assignEmployees':
        result = await queries.assignEmployees(executor, session, payload);
        break;
      case 'removeAssignment':
        result = await queries.removeAssignment(executor, session, payload);
        break;
      case 'getMyFollowUps':
        result = await queries.getMyFollowUps(executor, session, payload);
        break;
      case 'getTeamFollowUps':
        result = await queries.getTeamFollowUps(executor, session, payload);
        break;
      case 'createProblem':
        result = await queries.createProblem(executor, session, payload);
        break;
      case 'updateProblem':
        result = await queries.updateProblem(executor, session, payload);
        break;
      case 'deleteProblem':
        result = await queries.deleteProblem(executor, session, payload);
        break;
      case 'getProblems':
        result = await queries.getProblems(executor, session, payload);
        break;
      case 'getProblemDetails':
        result = await queries.getProblemDetails(executor, session, payload);
        break;
      case 'getEmployees':
        result = await queries.getEmployees(executor, session);
        break;
      case 'getEmployeeDetails':
        result = await queries.getEmployeeDetails(executor, session, payload);
        break;
      case 'createEmployee':
        result = await queries.createEmployee(executor, session, payload);
        break;
      case 'updateEmployee':
        result = await queries.updateEmployee(executor, session, payload);
        break;
      case 'disableEmployee':
        result = await queries.disableEmployee(executor, session, payload);
        break;
      case 'deleteEmployee':
        result = await queries.deleteEmployee(executor, session, payload);
        break;
      case 'saveRolePreset':
        result = await queries.saveRolePreset(executor, session, payload);
        break;
      case 'deleteRolePreset':
        result = await queries.deleteRolePreset(executor, session, payload);
        break;
      case 'resetRolePresets':
        result = await queries.resetRolePresets(executor, session);
        break;
      case 'savePermissionDefinition':
        result = await queries.savePermissionDefinition(executor, session, payload);
        break;
      case 'deletePermissionDefinition':
        result = await queries.deletePermissionDefinition(executor, session, payload);
        break;
      case 'getActivityLogs':
        result = await queries.getActivityLogs(executor, session, payload);
        break;
      case 'getNotifications':
        result = await queries.getNotifications(executor, session);
        break;
      case 'markNotificationRead':
        result = await queries.markNotificationRead(executor, session, payload);
        break;
      case 'deleteNotification':
        result = await queries.deleteNotification(executor, session, payload);
        break;
      case 'pullReservations':
        result = await queries.pullOrSyncReservations(executor, session, 'pullReservations', payload);
        break;
      case 'syncRentalGate':
        result = await queries.pullOrSyncReservations(executor, session, 'syncRentalGate', payload);
        break;
      case 'retryFailedSyncRecords':
        result = await queries.retryFailedSyncRecordsAction(executor, session, payload);
        break;
      case 'testConnection':
        result = await queries.testRentalGateConnection(executor, session);
        break;
      case 'testDatabaseHealth':
        result = await queries.testDatabaseHealth(executor, session);
        break;
      case 'saveApiToken':
        result = await queries.saveApiToken(executor, session, payload);
        break;
      case 'saveGlobalConnectionSettings':
        result = await queries.saveGlobalConnectionSettings(executor, session, payload);
        break;
      case 'getSetupCapabilities':
        result = await queries.getSetupCapabilitiesAction(executor, session);
        break;
      case 'applyUnifiedConnectionSetup':
        result = await queries.applyUnifiedConnectionSetupAction(executor, session, payload);
        break;
      case 'getSyncStatus':
        result = await queries.getSyncStatus(executor, session);
        break;
      case 'getTriggerStatus':
        result = await queries.getTriggerStatus(executor, session);
        break;
      case 'getReports':
        result = await queries.getReports(executor, session, payload);
        break;
      case 'exportReportData':
        result = await queries.exportReportData(executor, session, payload);
        break;
      case 'getSettings':
        result = await queries.getSettings(executor, session);
        break;
      case 'updateSettings':
        result = await queries.updateSettings(executor, session, payload);
        break;
      case 'saveUserLayoutPrefs':
        result = await queries.saveUserLayoutPrefs(executor, session, payload);
        break;
      case 'previewDeleteReservations':
        result = await queries.previewDeleteReservations(executor, session, payload);
        break;
      case 'deleteAllReservations':
        result = await queries.deleteAllReservations(executor, session, payload);
        break;
      case 'importReservationsFromExcel':
        result = await queries.importReservationsFromExcel(executor, session, payload);
        break;
      case 'getAnnouncements':
        result = await queries.getAnnouncements(executor, session);
        break;
      case 'saveAnnouncement':
        result = await queries.saveAnnouncement(executor, session, payload);
        break;
      case 'deleteAnnouncement':
        result = await queries.deleteAnnouncement(executor, session, payload);
        break;
      case 'getDelegations':
        result = await queries.getDelegations(executor, session);
        break;
      case 'saveDelegation':
        result = await queries.saveDelegation(executor, session, payload);
        break;
      case 'revokeDelegation':
        result = await queries.revokeDelegation(executor, session, payload);
        break;
      case 'getReservationLocks':
        result = await queries.getReservationLocks(executor, session);
        break;
      case 'acquireReservationLock':
        result = await queries.acquireReservationLock(executor, session, payload);
        break;
      case 'releaseReservationLock':
        result = await queries.releaseReservationLock(executor, session, payload);
        break;
      case 'getDeltaSync':
        result = await queries.getDeltaSync(executor, session, payload);
        break;
      case 'bulkReassignEmployeeReservations':
        result = await queries.bulkReassignEmployeeReservations(executor, session, payload);
        break;
      case 'bulkReassignSelectedReservations':
        result = await queries.bulkReassignSelectedReservations(executor, session, payload);
        break;
      case 'rejectReservation':
        result = await queries.rejectReservation(executor, session, payload);
        break;
      case 'cancelReservation':
        result = await queries.cancelReservation(executor, session, payload);
        break;
      case 'restoreReservation':
        result = await queries.restoreReservation(executor, session, payload);
        break;
      case 'getInactiveReservations':
        result = await queries.getInactiveReservations(executor, session, payload);
        break;
      case 'searchCustomerByNationalId':
        result = await queries.searchCustomerByNationalId(executor, session, payload);
        break;
      case 'saveEmployeeUiOverrides':
        result = await queries.saveEmployeeUiOverrides(executor, session, payload);
        break;
      case 'saveRoleUiDefaults':
        result = await queries.saveRoleUiDefaults(executor, session, payload);
        break;
      case 'restoreUiDefaults':
        result = await queries.restoreUiDefaults(executor, session, payload);
        break;
      case 'getCustomers':
        result = await queries.getCustomers(executor, session, payload);
        break;
      case 'getCustomerDetails':
        result = await queries.getCustomerDetails(executor, session, payload);
        break;
      case 'createCustomer':
        result = await queries.createCustomer(executor, session, payload);
        break;
      case 'updateCustomerProfile':
        result = await queries.updateCustomerProfile(executor, session, payload);
        break;
      case 'getCustomerNotesConfig':
        result = await queries.getCustomerNotesConfig(executor, session);
        break;
      case 'saveCustomerNotesConfig':
        result = await queries.saveCustomerNotesConfig(executor, session, payload);
        break;
      case 'getCustomerNoteStatuses':
        result = await queries.getCustomerNoteStatuses(executor, session);
        break;
      case 'saveCustomerNoteStatus':
        result = await queries.saveCustomerNoteStatus(executor, session, payload);
        break;
      case 'toggleCustomerNoteStatus':
        result = await queries.toggleCustomerNoteStatus(executor, session, payload);
        break;
      case 'deleteCustomerNoteStatus':
        result = await queries.deleteCustomerNoteStatus(executor, session, payload);
        break;
      case 'getCustomerNotes':
        result = await queries.getCustomerNotes(executor, session, payload);
        break;
      case 'addCustomerNote':
        result = await queries.addCustomerNote(executor, session, payload);
        break;
      case 'updateCustomerNote':
        result = await queries.updateCustomerNote(executor, session, payload);
        break;
      case 'changeCustomerNoteStatus':
        result = await queries.changeCustomerNoteStatus(executor, session, payload);
        break;
      case 'assignCustomerNoteEmployee':
        result = await queries.assignCustomerNoteEmployee(executor, session, payload);
        break;
      case 'deleteCustomerNote':
        result = await queries.deleteCustomerNote(executor, session, payload);
        break;
      case 'addCustomerNoteAttachment':
        result = await queries.addCustomerNoteAttachment(executor, session, payload);
        break;
      case 'deleteCustomerNoteAttachment':
        result = await queries.deleteCustomerNoteAttachment(executor, session, payload);
        break;
      case 'getCustomerNoteHistory':
        result = await queries.getCustomerNoteHistory(executor, session, payload);
        break;
      case 'getDataIntegrityReport':
        result = await integrityService.getDataIntegrityReport(executor, session, payload);
        break;
      case 'runDataIntegrityCheck':
        result = await integrityService.runDataIntegrityCheck(executor, session, payload);
        break;
      case 'recheckDataIntegrityRecord':
        result = await integrityService.recheckDataIntegrityRecord(executor, session, payload);
        break;
      case 'resolveDataIntegrityIssue':
        result = await integrityService.resolveDataIntegrityIssue(executor, session, payload);
        break;
      case 'rollbackDataIntegrityAction':
        result = await integrityService.rollbackDataIntegrityAction(executor, session, payload);
        break;
      case 'getDataIntegritySettings':
        result = await integrityService.getDataIntegritySettings(executor, session);
        break;
      case 'saveDataIntegritySettings':
        result = await integrityService.saveDataIntegritySettings(executor, session, payload);
        break;
      case 'controlDataIntegrityMonitor':
        result = await integrityService.controlDataIntegrityMonitor(executor, session, payload);
        break;
      default:
        return {
          success: false,
          message: 'الإجراء المطلوب غير معروف.',
          data: null,
          error: `UNKNOWN_ACTION: ${action}`
        };
    }

    const outResult = result;
    if (
      action === 'saveRolePreset' ||
      action === 'deleteRolePreset' ||
      action === 'resetRolePresets' ||
      action === 'savePermissionDefinition' ||
      action === 'deletePermissionDefinition' ||
      action === 'applyUnifiedConnectionSetup' ||
      action === 'updateSettings' ||
      action === 'saveCustomerNotesConfig' ||
      action === 'saveCustomerNoteStatus' ||
      action === 'toggleCustomerNoteStatus' ||
      action === 'deleteCustomerNoteStatus' ||
      action === 'saveEmployeeUiOverrides' ||
      action === 'saveRoleUiDefaults' ||
      action === 'restoreUiDefaults'
    ) {
      invalidateAuthSessionCache(executor, { all: true });
    }

    if (syncSpec) {
      let version = 0;
      if (syncSpec.scopes.length > 0) {
        version = await invalidateAndBumpVersion(executor, syncSpec.scopes, syncSpec.persistVersion).catch(() => 0);
      }
      const entityIds: string[] = [];
      const candidateResId = String(payload?.reservationId || outResult?.reservation?.id || outResult?.id || '').trim();
      if (candidateResId) entityIds.push(candidateResId);
      const candidateCustId = String(payload?.customerId || outResult?.customer?.id || '').trim();
      if (candidateCustId && !entityIds.includes(candidateCustId)) entityIds.push(candidateCustId);
      const originTabId = String(payload?.originTabId || '').trim() || undefined;
      const rtEvent = {
        type: syncSpec.eventType,
        action,
        scopes: syncSpec.scopes,
        entityIds: entityIds.length ? entityIds : undefined,
        actorId: session.user.id,
        originTabId,
        version: version || undefined,
        at: new Date().toISOString()
      };
      broadcastCrmEvent(rtEvent);
      await publishPgNotify(executor, rtEvent).catch(() => undefined);
    }

    return outResult;
    };

    const useIdempotency = Boolean(syncSpec && syncSpec.eventType !== 'lock' && payload?.clientRequestId);
    const finalResult = useIdempotency
      ? await runWithIdempotency(executor, session.user.id, action, String(payload.clientRequestId), executeAction)
      : await executeAction();

    return {
      success: true,
      message: 'تمت العملية بنجاح.',
      data: finalResult,
      error: null
    };
  } catch (err: any) {
    const msg = String(err?.message || 'حدث خطأ غير متوقع.');
    const errorCode = msg.includes(':') ? msg.split(':')[0].trim() : 'SERVER_ERROR';
    const isExpectedClientErr = /^(UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|NOT_FOUND|INVALID_CREDENTIALS|ACCOUNT_DISABLED|DUPLICATE_USERNAME|NO_RG_TOKEN|DATABASE_CONNECTION_ERROR|CONFLICT_STALE_DATA|RATE_LIMITED|DUPLICATE_SUBMISSION|SYNC_IN_PROGRESS)/.test(errorCode);
    if (!isExpectedClientErr) {
      await logBackendError(executor, 'router', action, err, { payload });
    }
    return {
      success: false,
      message: msg,
      data: null,
      error: isExpectedClientErr ? msg : errorCode
    };
  }
}
