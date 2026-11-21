import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface MockRange {
  setValues(vals: unknown[][]): MockRange;
  getValues(): unknown[][];
  getValue(): unknown;
  setFontWeight(): MockRange;
  setBackground(): MockRange;
  setHorizontalAlignment(): MockRange;
  setNumberFormat(): MockRange;
  setDataValidation(): MockRange;
  setWrap(): MockRange;
  setBorder(): MockRange;
  clearFormat(): MockRange;
  clearDataValidations(): MockRange;
}

function createMockGasEnv(options: {
  props?: Record<string, string>;
  fetchHandler?: (url: string, opts?: Record<string, unknown>) => { code: number; body: unknown };
}) {
  const propsStore: Record<string, string> = Object.assign({}, options.props || {});
  const sheets = new Map<string, { name: string; grid: unknown[][]; frozenRows: number }>();
  const uiAlerts: string[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  const fetchCalls: string[] = [];

  function ensureSheet(name: string) {
    if (!sheets.has(name)) {
      sheets.set(name, { name, grid: [], frozenRows: 0 });
    }
    const sh = sheets.get(name)!;
    const api = {
      getName: () => sh.name,
      getLastRow: () => sh.grid.length,
      getLastColumn: () => sh.grid.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => Math.max(sh.grid.length, 50),
      getMaxColumns: () => Math.max(sh.grid.reduce((m, r) => Math.max(m, r.length), 0), 40),
      insertColumnsAfter: () => api,
      insertRowsBefore: (pos: number, howMany: number) => {
        for (let i = 0; i < howMany; i++) sh.grid.splice(Math.max(0, pos - 1), 0, []);
      },
      insertRowsAfter: (afterPos: number, howMany: number) => {
        for (let i = 0; i < howMany; i++) sh.grid.splice(afterPos, 0, []);
      },
      clearContents: () => {
        sh.grid = [];
      },
      clear: () => {
        sh.grid = [];
      },
      setFrozenRows: (n: number) => {
        sh.frozenRows = n;
      },
      getRange: (row: number, col: number, numRows = 1, numCols = 1): MockRange => {
        const rangeObj: MockRange = {
          setValues: (vals: unknown[][]) => {
            for (let r = 0; r < vals.length; r++) {
              const targetRow = row - 1 + r;
              while (sh.grid.length <= targetRow) sh.grid.push([]);
              for (let c = 0; c < vals[r].length; c++) {
                sh.grid[targetRow][col - 1 + c] = vals[r][c];
              }
            }
            return rangeObj;
          },
          getValues: () => {
            const out: unknown[][] = [];
            for (let r = 0; r < numRows; r++) {
              const srcRow = sh.grid[row - 1 + r] || [];
              const rowOut: unknown[] = [];
              for (let c = 0; c < numCols; c++) {
                rowOut.push(srcRow[col - 1 + c] ?? '');
              }
              out.push(rowOut);
            }
            return out;
          },
          getValue: () => {
            const srcRow = sh.grid[row - 1] || [];
            return srcRow[col - 1] ?? '';
          },
          setFontWeight: () => rangeObj,
          setBackground: () => rangeObj,
          setHorizontalAlignment: () => rangeObj,
          setNumberFormat: () => rangeObj,
          setDataValidation: () => rangeObj,
          setWrap: () => rangeObj,
          setBorder: () => rangeObj,
          clearFormat: () => rangeObj,
          clearDataValidations: () => rangeObj
        };
        return rangeObj;
      }
    };
    return api;
  }

  const spreadsheet = {
    getSheetByName: (name: string) => (sheets.has(name) ? ensureSheet(name) : null),
    insertSheet: (name: string) => ensureSheet(name),
    toast: (msg: string) => {
      toasts.push(String(msg));
    }
  };

  function makeRes(res: { code: number; body: unknown }) {
    return {
      getResponseCode: () => res.code,
      getContentText: () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body))
    };
  }

  const dvBuilder = {
    requireValueInList: () => dvBuilder,
    requireDate: () => dvBuilder,
    setAllowInvalid: () => dvBuilder,
    setHelpText: () => dvBuilder,
    build: () => ({})
  };

  const sandbox: Record<string, unknown> = {
    Logger: { log: (m: string) => logs.push(String(m)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => propsStore[k] ?? null,
        setProperties: (obj: Record<string, string>) => Object.assign(propsStore, obj)
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({
        alert: (m: string) => {
          uiAlerts.push(String(m));
          throw new Error('BLOCKING_UI_ALERT_SHOULD_NOT_HANG');
        },
        ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
        Button: { OK: 'OK' }
      }),
      newDataValidation: () => dvBuilder,
      BorderStyle: { SOLID_MEDIUM: 'SOLID_MEDIUM' }
    },
    UrlFetchApp: {
      fetch: (url: string, opts?: Record<string, unknown>) => {
        fetchCalls.push(url);
        const r = options.fetchHandler ? options.fetchHandler(url, opts) : { code: 200, body: { content: [], totalPages: 1, last: true } };
        return makeRes(r);
      },
      fetchAll: (reqs: Array<{ url: string }>) =>
        reqs.map((req) => {
          fetchCalls.push(req.url);
          const r = options.fetchHandler ? options.fetchHandler(req.url, req) : { code: 200, body: { content: [], totalPages: 1, last: true } };
          return makeRes(r);
        })
    },
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    RegExp,
    Error
  };

  const gsPath = path.resolve(process.cwd(), 'google-apps-script/SheetSyncMenu.gs');
  const code = fs.readFileSync(gsPath, 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return { sandbox: sandbox as Record<string, any>, sheets, uiAlerts, toasts, logs, fetchCalls };
}

test('SheetSyncMenu.gs handles empty and malformed tokens without hanging or calling API', () => {
  const envEmpty = createMockGasEnv({ props: { RG_TOKEN: '   ' } });
  const resEmpty = envEmpty.sandbox.fetchBookingsFromAPI(20261101);
  assert.equal(resEmpty.success, false);
  assert.equal(resEmpty.error, 'EMPTY_TOKEN');
  assert.equal(envEmpty.fetchCalls.length, 0);
  assert.equal(envEmpty.uiAlerts.length, 0);
  assert.equal(envEmpty.toasts.length, 1);

  const envBearerOnly = createMockGasEnv({ props: { RENTAL_TOKEN: 'Bearer   ' } });
  const resBearer = envBearerOnly.sandbox.fetchBookingsFromAPI(20261101);
  assert.equal(resBearer.success, false);
  assert.equal(resBearer.error, 'EMPTY_TOKEN');
  assert.equal(envBearerOnly.fetchCalls.length, 0);

  const envMalformed = createMockGasEnv({ props: { RG_TOKEN: 'not-a-jwt-token' } });
  const resMalformed = envMalformed.sandbox.fetchBookingsFromAPI(20261101);
  assert.equal(resMalformed.success, false);
  assert.equal(resMalformed.error, 'INVALID_TOKEN');
  assert.equal(envMalformed.fetchCalls.length, 0);
});

test('SheetSyncMenu.gs fetches all nested multi-page reservations and applies STATUS_AR accurately', () => {
  const validToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.sig';
  const resPages: Record<number, any[]> = {
    0: [
      {
        reservationId: 101,
        reservationNumber: 'RG-100101',
        reservationDate: '2026-11-15T10:00:00',
        clientName: 'عميل 1',
        clientMobile: '966500000001',
        companyArName: 'بدجت',
        receiveBranchArName: 'الرياض',
        carNameAr: 'إلنترا',
        startDate: '2026-11-16T10:00:00',
        endDate: '2026-11-18T10:00:00',
        reservationDays: 2,
        receiveType: 'BRANCH',
        deliverType: 'AIRPORT',
        reservationStatus: 'HOLD',
        total: 500
      }
    ],
    1: [
      {
        reservationId: 102,
        reservationNumber: 'RG-100102',
        reservationDate: '2026-11-16T11:00:00',
        clientName: 'عميل 2',
        clientMobile: '966500000002',
        companyArName: 'ذيب',
        receiveBranchArName: 'جدة',
        carNameAr: 'سوناتا',
        startDate: '2026-11-17T09:00:00',
        endDate: '2026-11-20T09:00:00',
        reservationDays: 3,
        receiveType: 'MY_LOCATION',
        deliverType: 'BRANCH',
        status: 'on-hold',
        total: 750
      }
    ],
    2: [
      {
        reservationId: 103,
        reservationNumber: 'RG-100103',
        reservationDate: '2026-11-17T12:00:00',
        clientName: 'عميل 3',
        clientMobile: '966500000003',
        companyArName: 'يلو',
        receiveBranchArName: 'الدمام',
        carNameAr: 'كامري',
        startDate: '2026-11-18T08:00:00',
        endDate: '2026-11-19T08:00:00',
        reservationDays: 1,
        receiveType: 'BRANCH',
        deliverType: 'BRANCH',
        reservationStatus: 'FINISHED_BY_DRIVER',
        total: 300
      }
    ]
  };

  const env = createMockGasEnv({
    props: { RG_TOKEN: validToken },
    fetchHandler: (url) => {
      const m = url.match(/[?&]page=(\d+)/);
      const page = m ? Number(m[1]) : 0;
      if (url.includes('reservation-extends/filter')) {
        return {
          code: 200,
          body: {
            data: {
              content: page === 0 ? [{ extendId: 901, reservationId: 103, extendDate: '2026-11-19', reservationStatus: 'PAID_BY_WALLET', extensionType: 'CLIENT', total: 100 }] : [],
              totalPages: 1,
              last: true
            }
          }
        };
      }
      return {
        code: 200,
        body: {
          data: {
            content: resPages[page] || [],
            totalPages: 3,
            last: page >= 2
          }
        }
      };
    }
  });

  const out = env.sandbox.fetchBookingsFromAPI(20261110, { silent: true });
  assert.equal(out.success, true);
  assert.equal(out.totalFetched, 3);
  assert.equal(out.filteredCount, 3);
  assert.equal(out.addedFollowUps, 3);
  assert.equal(out.statusCountsAr['معلق'], 2);
  assert.equal(out.statusCountsAr['تم التسليم من قبل السائق'], 1);

  const dataGrid = env.sheets.get('Data')!.grid;
  assert.equal(dataGrid.length, 4); // 1 header + 3 reservations
  assert.equal(dataGrid[1][1], 'RG-100103');
  assert.equal(dataGrid[1][15], 'تم التسليم من قبل السائق');
  assert.equal(dataGrid[2][1], 'RG-100102');
  assert.equal(dataGrid[2][15], 'معلق');
  assert.equal(dataGrid[3][1], 'RG-100101');
  assert.equal(dataGrid[3][15], 'معلق');

  const fuGrid = env.sheets.get('FollowUps')!.grid;
  assert.equal(fuGrid.length, 4);
  assert.equal(fuGrid[1][0], 'RG-100103');
  assert.equal(fuGrid[1][13], 'تم التسليم من قبل السائق');
  assert.equal(fuGrid[2][13], 'معلق');
});

test('SheetSyncMenu.gs sequentially paginates when totalPages is omitted and last=false', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.sig';
  const env = createMockGasEnv({
    props: { RG_TOKEN: validToken },
    fetchHandler: (url) => {
      if (url.includes('reservation-extends/filter')) {
        return { code: 404, body: 'Not Found' }; // non-fatal extension error should not abort sync
      }
      const m = url.match(/[?&]page=(\d+)/);
      const page = m ? Number(m[1]) : 0;
      if (page === 0) {
        return {
          code: 200,
          body: { content: [{ reservationId: 201, reservationDate: '2026-11-15', reservationStatus: 'READY_FOR_PICKUP' }], last: false }
        };
      }
      if (page === 1) {
        return {
          code: 200,
          body: { content: [{ reservationId: 202, reservationDate: '2026-11-16', reservationStatus: 'ACTIVE' }], last: false }
        };
      }
      return {
        code: 200,
        body: { content: [{ reservationId: 203, reservationDate: '2026-11-17', reservationStatus: 'CONFIRMED' }], last: true }
      };
    }
  });

  const out = env.sandbox.fetchBookingsFromAPI(20261110, { silent: true });
  assert.equal(out.success, true);
  assert.equal(out.totalFetched, 3);
  assert.equal(out.statusCountsAr['جاهز للاستلام'], 1);
  assert.equal(out.statusCountsAr['نشط الآن'], 1);
  assert.equal(out.statusCountsAr['مؤكد'], 1);
});

test('SheetSyncMenu.gs returns INVALID_TOKEN cleanly when API responds 401', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.sig';
  const env = createMockGasEnv({
    props: { RG_TOKEN: validToken },
    fetchHandler: () => ({ code: 401, body: 'Unauthorized' })
  });

  const out = env.sandbox.fetchBookingsFromAPI(20261110, { silent: true });
  assert.equal(out.success, false);
  assert.equal(out.error, 'INVALID_TOKEN');
  assert.equal(env.uiAlerts.length, 0);
});

test('assets/js and src/assets/js copies of app.js and employees.js stay identical and export EmployeeManager + state store', () => {
  const appRoot = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/app.js'), 'utf8');
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/assets/js/app.js'), 'utf8');
  const empRoot = fs.readFileSync(path.resolve(process.cwd(), 'assets/js/employees.js'), 'utf8');
  const empSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/assets/js/employees.js'), 'utf8');

  assert.equal(appRoot, appSrc);
  assert.equal(empRoot, empSrc);
  assert.match(empRoot, /function EmployeeManager\(options\)/);
  assert.match(empRoot, /id="employee-manager-table"/);
  assert.match(empRoot, /emp-del-btn"[^>]*>حذف<\/button>/);
  assert.match(appRoot, /subscribeEmployees:\s*subscribeEmployees/);
  assert.match(appRoot, /deleteEmployeeFromState:\s*deleteEmployeeFromState/);
  assert.match(appRoot, /upsertEmployeeInState:\s*upsertEmployeeInState/);
});

test('SheetSyncMenu.gs handles object-shaped statuses, Arabic statuses, and under-reported totalPages', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.sig';
  const env = createMockGasEnv({
    props: { RG_TOKEN: 'Bearer   ', RENTAL_TOKEN: validToken },
    fetchHandler: (url) => {
      if (url.includes('reservation-extends/filter')) {
        return { code: 200, body: { data: { content: [], totalPages: 1, last: true } } };
      }
      const m = url.match(/[?&]page=(\d+)/);
      const page = m ? Number(m[1]) : 0;
      if (page === 0) {
        return {
          code: 200,
          body: {
            payload: {
              records: [
                { reservationId: 301, reservationDate: '2026-11-15', status: { code: 'in-rent' } }
              ],
              totalPages: 2,
              last: false
            }
          }
        };
      }
      if (page === 1) {
        return {
          code: 200,
          body: {
            payload: {
              records: [
                { reservationId: 302, reservationDate: '2026-11-16', reservationStatus: 'مؤكد' }
              ],
              totalPages: 2,
              last: false
            }
          }
        };
      }
      if (page === 2) {
        return {
          code: 200,
          body: {
            payload: {
              records: [
                { reservationId: 303, reservationDate: '2026-11-17', reservationStatus: 'CHECKED_OUT' }
              ],
              last: true
            }
          }
        };
      }
      return { code: 200, body: { payload: { records: [], last: true } } };
    }
  });

  const out = env.sandbox.fetchBookingsFromAPI(20261110, { silent: true });
  assert.equal(out.success, true);
  assert.equal(out.totalFetched, 3);
  assert.equal(out.statusCountsAr['نشط الآن'], 2);
  assert.equal(out.statusCountsAr['مؤكد'], 1);
  assert.equal(out.unmapped.length, 0);
});

