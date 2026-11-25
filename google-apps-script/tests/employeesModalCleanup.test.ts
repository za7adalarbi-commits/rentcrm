import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

test('openEmployeeSectionsModal removes old ui_overrides card and dropdowns while preserving all 4 core permission groups', () => {
  const empSrc = readRepoFile('assets/js/employees.js');
  const srcEmpSrc = readRepoFile('src/assets/js/employees.js');
  const styleSrc = readRepoFile('assets/css/style.css');
  const respSrc = readRepoFile('assets/css/responsive.css');

  assert.equal(empSrc, srcEmpSrc, 'employees.js mirror parity must hold');

  // Removed old UI overrides card and dropdown controls
  assert.equal(empSrc.includes('data-esec-group="ui_overrides"'), false);
  assert.equal(empSrc.includes('uiOverridesCardHtml'), false);
  assert.equal(empSrc.includes('esec-ui-ov-sel'), false);
  assert.equal(empSrc.includes('esec-restore-ui-btn'), false);
  assert.equal(empSrc.includes('draftUiOverridesByEmpId'), false);
  assert.equal(styleSrc.includes('.esec-ui-ov-sel'), false);
  assert.equal(respSrc.includes('.esec-ui-ov-sel'), false);

  // Preserved all 4 protected EMPLOYEE_SECTION_GROUPS cards & controls
  assert.equal(Array.isArray(core.EMPLOYEE_SECTION_GROUPS), true);
  assert.deepEqual(
    core.EMPLOYEE_SECTION_GROUPS.map((g: any) => g.id),
    ['main_sections', 'sub_sections', 'dashboard_cards', 'table_actions']
  );
  assert.ok(empSrc.includes('core.EMPLOYEE_SECTION_GROUPS'));
  assert.ok(empSrc.includes('esec-item-cb'));
  assert.ok(empSrc.includes('esec-group-toggle'));
  assert.ok(empSrc.includes('esec-appear-in-stats'));
  assert.ok(empSrc.includes('esec-view-stats'));
  assert.ok(empSrc.includes('esec-jump-actions-btn'));
  assert.ok(empSrc.includes('esec-preview-btn'));
  assert.ok(empSrc.includes('ef-permissions-grid'));
  assert.ok(respSrc.includes('.rg-esec-item-row .rg-switch-label'));

  // Preserved role-level UI defaults & core simplification catalog
  assert.ok(Array.isArray(core.UI_SIMPLIFICATION_OPTIONS) && core.UI_SIMPLIFICATION_OPTIONS.length > 0);
});

test('executeSaveEmployee releases submit lock on empty name/username and employees table header matches cell visibility', () => {
  const empSrc = readRepoFile('assets/js/employees.js');
  const apiSrc = readRepoFile('assets/js/api.js');

  assert.match(
    empSrc,
    /if \(!payload\.name\) \{\s*errEl\.textContent = '[^']+';\s*errEl\.classList\.remove\('hidden'\);\s*releaseEmpFormLock\(\);\s*return false;\s*\}/
  );
  assert.match(
    empSrc,
    /if \(!payload\.username\) \{\s*errEl\.textContent = '[^']+';\s*errEl\.classList\.remove\('hidden'\);\s*releaseEmpFormLock\(\);\s*return false;\s*\}/
  );
  assert.ok(
    empSrc.includes("((canManage || canCustomizeUi) ? '<th>الإجراءات</th>' : '')"),
    'employees table actions header must match body cell condition'
  );
  assert.ok(
    apiSrc.includes("(action !== 'createEmployee' && s === 'employees')"),
    'api.js must preserve employees cache before optimistic createEmployee patching'
  );
});
