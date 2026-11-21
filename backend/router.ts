import { handleLogin, handleLogout, hashToken, requireAuth, type AuthSession } from './auth.js';
import { getMutationSyncSpec, invalidateAndBumpVersion } from './cache.js';
import { ensureSchemaInitialized, type DbExecutor } from './db.js';
import { logBackendError } from './logger.js';
import { broadcastCrmEvent } from './realtime.js';
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
    let result: any = null;

    switch (action) {
      case 'logout':
        result = await handleLogout(executor, session);
        break;
      case 'getMe':
        result = {
          user: session.user,
          layoutPrefs: await queries.getUserLayoutPrefs(executor, session)
        };
        break;
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
      case 'pullReservations':
        result = await queries.pullOrSyncReservations(executor, session, 'pullReservations', payload);
        break;
      case 'syncRentalGate':
        result = await queries.pullOrSyncReservations(executor, session, 'syncRentalGate', payload);
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
      default:
        return {
          success: false,
          message: 'الإجراء المطلوب غير معروف.',
          data: null,
          error: `UNKNOWN_ACTION: ${action}`
        };
    }

    const syncSpec = getMutationSyncSpec(action);
    if (syncSpec) {
      let version = 0;
      if (syncSpec.scopes.length > 0) {
        version = await invalidateAndBumpVersion(executor, syncSpec.scopes, syncSpec.persistVersion).catch(() => 0);
      }
      const entityIds: string[] = [];
      const candidateResId = String(payload?.reservationId || result?.reservation?.id || result?.id || '').trim();
      if (candidateResId) entityIds.push(candidateResId);
      broadcastCrmEvent({
        type: syncSpec.eventType,
        action,
        scopes: syncSpec.scopes,
        entityIds: entityIds.length ? entityIds : undefined,
        actorId: session.user.id,
        version: version || undefined,
        at: new Date().toISOString()
      });
    }

    return {
      success: true,
      message: 'تمت العملية بنجاح.',
      data: result,
      error: null
    };
  } catch (err: any) {
    const msg = String(err?.message || 'حدث خطأ غير متوقع.');
    const errorCode = msg.includes(':') ? msg.split(':')[0].trim() : 'SERVER_ERROR';
    const isExpectedClientErr = /^(UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|NOT_FOUND|INVALID_CREDENTIALS|ACCOUNT_DISABLED|DUPLICATE_USERNAME|NO_RG_TOKEN|DATABASE_CONNECTION_ERROR|CONFLICT_STALE_DATA)/.test(errorCode);
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
