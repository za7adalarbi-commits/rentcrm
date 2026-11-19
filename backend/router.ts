import { handleLogin, handleLogout, requireAuth } from './auth';
import { ensureSchemaInitialized, type DbExecutor } from './db';
import { logBackendError } from './logger';
import * as queries from './queries';

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
      return { success: true, message: 'تم تسجيل الدخول بنجاح.', data: loginData, error: null };
    }

    const session = await requireAuth(executor, token);
    let result: any = null;

    switch (action) {
      case 'logout':
        result = await handleLogout(executor, session);
        break;
      case 'getMe':
        result = { user: session.user };
        break;
      case 'getAppBootstrap':
        result = await queries.getAppBootstrap(executor, session, payload);
        break;
      case 'getDashboard':
        result = await queries.getDashboard(executor, session, payload);
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
      default:
        return {
          success: false,
          message: 'الإجراء المطلوب غير معروف.',
          data: null,
          error: `UNKNOWN_ACTION: ${action}`
        };
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
    const isExpectedClientErr = /^(UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|NOT_FOUND|INVALID_CREDENTIALS|ACCOUNT_DISABLED|DUPLICATE_USERNAME|NO_RG_TOKEN|DATABASE_CONNECTION_ERROR)/.test(errorCode);
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
