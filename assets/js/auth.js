/**
 * RENTAL GATE CRM — Authentication & Session Management
 */
(function (root) {
  'use strict';

  var currentUser = null;
  var pendingBootstrap = null;
  var restoredLayoutPrefs = null;

  function getUser() {
    return currentUser;
  }

  function setUser(user) {
    currentUser = user;
  }

  function updateCurrentUser(patch) {
    if (!currentUser || !patch || typeof patch !== 'object') return currentUser;
    currentUser = Object.assign({}, currentUser, patch);
    return currentUser;
  }

  function primeBootstrapCaches(bs, range) {
    if (!bs || !root.RGApi || !root.RGApi.primeCache) return;
    var r = range || '30d';
    if (bs.user) {
      root.RGApi.primeCache('getMe', {}, {
        user: bs.user,
        layoutPrefs: bs.layoutPrefs || null
      });
    }
    if (bs.dashboard) root.RGApi.primeCache('getDashboard', { range: r }, bs.dashboard);
    if (bs.employees) root.RGApi.primeCache('getEmployees', {}, bs.employees);
    if (bs.notifications) root.RGApi.primeCache('getNotifications', {}, bs.notifications);
    if (bs.problems) root.RGApi.primeCache('getProblems', {}, bs.problems);
    if (bs.uiSimplification && root.RGApp && root.RGApp.applyUiSimplification) {
      root.RGApp.applyUiSimplification(bs.uiSimplification);
    }
  }

  function consumeBootstrap() {
    var out = pendingBootstrap;
    pendingBootstrap = null;
    return out;
  }

  function consumeRestoredLayoutPrefs() {
    var out = restoredLayoutPrefs;
    restoredLayoutPrefs = null;
    return out;
  }

  async function restoreSession() {
    var token = root.RGApi.getToken();
    if (!token) return null;
    try {
      var res = await root.RGApi.callApi('getMe', {});
      if (res && res.success && res.data && res.data.user) {
        currentUser = res.data.user;
        restoredLayoutPrefs = res.data.layoutPrefs || null;
        return currentUser;
      }
    } catch (e) {}
    root.RGApi.setToken('');
    currentUser = null;
    restoredLayoutPrefs = null;
    return null;
  }

  async function login(username, password, opts) {
    var cleanUser = (root.RGCrmCore && root.RGCrmCore.normalizeLoginUsername)
      ? root.RGCrmCore.normalizeLoginUsername(username)
      : String(username || '').trim().toLowerCase();
    var cleanPass = String(password || '');
    var range = (opts && opts.range) || '30d';
    if (!cleanUser || !cleanPass) {
      return {
        success: false,
        message: 'يرجى إدخال اسم المستخدم وكلمة المرور.',
        data: null,
        error: 'VALIDATION'
      };
    }
    try {
      var res = await root.RGApi.callApi('login', {
        username: cleanUser,
        password: cleanPass,
        includeBootstrap: true,
        range: range
      });
      if (res && res.success && res.data && res.data.token && res.data.user) {
        root.RGApi.setToken(res.data.token);
        currentUser = res.data.user;
        restoredLayoutPrefs = (res.data.bootstrap && res.data.bootstrap.layoutPrefs) || null;
        if (res.data.bootstrap) {
          pendingBootstrap = { range: range, data: res.data.bootstrap };
          primeBootstrapCaches(res.data.bootstrap, range);
        } else {
          pendingBootstrap = null;
        }
      }
      return res || { success: false, message: 'تعذر إتمام تسجيل الدخول.' };
    } catch (err) {
      return {
        success: false,
        message: 'حدث خطأ أثناء تسجيل الدخول: ' + (err && err.message ? err.message : err),
        data: null,
        error: 'LOGIN_EXCEPTION'
      };
    }
  }

  async function logout() {
    pendingBootstrap = null;
    restoredLayoutPrefs = null;
    try {
      if (root.RGApi.getToken()) {
        await root.RGApi.callApi('logout', {});
      }
    } catch (e) {}
    root.RGApi.setToken('');
    currentUser = null;
  }

  root.RGAuth = {
    getUser: getUser,
    setUser: setUser,
    updateCurrentUser: updateCurrentUser,
    restoreSession: restoreSession,
    login: login,
    logout: logout,
    consumeBootstrap: consumeBootstrap,
    consumeRestoredLayoutPrefs: consumeRestoredLayoutPrefs,
    primeBootstrapCaches: primeBootstrapCaches
  };
})(window);
