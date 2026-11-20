import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('parseIsoDateStrict validates leap years, month lengths, and rejects malformed dates', () => {
  assert.deepEqual(core.parseIsoDateStrict('2024-02-29'), {
    iso: '2024-02-29',
    year: 2024,
    month: 2,
    day: 29
  });
  assert.equal(core.parseIsoDateStrict('2025-02-29'), null);
  assert.equal(core.parseIsoDateStrict('2026-04-31'), null);
  assert.equal(core.parseIsoDateStrict('2026-13-01'), null);
  assert.equal(core.parseIsoDateStrict('2026-00-10'), null);
  assert.equal(core.parseIsoDateStrict('2026-11-5'), null);
  assert.equal(core.parseIsoDateStrict('not-a-date'), null);
  assert.equal(core.parseIsoDateStrict(''), null);
});

test('validateIsoDateInput enforces min/max, required, and custom disabled predicates', () => {
  const emptyAllowed = core.validateIsoDateInput('', { lang: 'en' });
  assert.equal(emptyAllowed.valid, true);
  assert.equal(emptyAllowed.empty, true);

  const emptyReq = core.validateIsoDateInput('', { required: true, lang: 'en' });
  assert.equal(emptyReq.valid, false);
  assert.equal(emptyReq.code, 'REQUIRED');

  const badFormat = core.validateIsoDateInput('2026/11/10', { lang: 'en' });
  assert.equal(badFormat.valid, false);
  assert.equal(badFormat.code, 'INVALID_FORMAT');

  const beforeMin = core.validateIsoDateInput('2026-11-01', { minDate: '2026-11-05', lang: 'ar' });
  assert.equal(beforeMin.valid, false);
  assert.equal(beforeMin.code, 'BEFORE_MIN');

  const afterMax = core.validateIsoDateInput('2026-11-25', { maxDate: '2026-11-20', lang: 'ar' });
  assert.equal(afterMax.valid, false);
  assert.equal(afterMax.code, 'AFTER_MAX');

  const disabledRes = core.validateIsoDateInput('2026-11-15', {
    isDateDisabled: (iso: string) => iso === '2026-11-15',
    lang: 'en'
  });
  assert.equal(disabledRes.valid, false);
  assert.equal(disabledRes.code, 'DISABLED_DATE');

  const ok = core.validateIsoDateInput('٢٠٢٦-١١-١٨', { minDate: '2026-11-01', maxDate: '2026-11-30' });
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, '2026-11-18');
});

test('sanitizeManualDateInput strips non-numeric chars, converts Arabic digits, and auto-formats cleanly', () => {
  assert.equal(core.sanitizeManualDateInput('2026', '202'), '2026-');
  assert.equal(core.sanitizeManualDateInput('2026-11', '2026-1'), '2026-11-');
  assert.equal(core.sanitizeManualDateInput('2026-11', '2026-11-'), '2026-11'); // deleting hyphen is not trapped
  assert.equal(core.sanitizeManualDateInput('٢٠٢٦١١١٨', ''), '2026-11-18');
  assert.equal(core.sanitizeManualDateInput('2026-ab11-cd18xyz', ''), '2026-11-18');
});

test('buildCalendarMonthGrid produces 42 cells with today, selected, range highlights, and disabled bounds', () => {
  const grid = core.buildCalendarMonthGrid(2026, 11, {
    weekStartsOn: 0,
    todayIso: '2026-11-19',
    rangeStart: '2026-11-10',
    rangeEnd: '2026-11-14',
    minDate: '2026-11-05',
    maxDate: '2026-11-25',
    isRange: true
  });

  assert.equal(grid.length, 42);
  // Nov 1, 2026 is a Sunday -> first cell must be 2026-11-01
  assert.equal(grid[0].iso, '2026-11-01');
  assert.equal(grid[0].isCurrentMonth, true);
  assert.equal(grid[0].isDisabled, true); // before minDate 2026-11-05

  const startCell = grid.find((c: any) => c.iso === '2026-11-10');
  const midCell = grid.find((c: any) => c.iso === '2026-11-12');
  const endCell = grid.find((c: any) => c.iso === '2026-11-14');
  const todayCell = grid.find((c: any) => c.iso === '2026-11-19');
  const afterMaxCell = grid.find((c: any) => c.iso === '2026-11-28');

  assert.equal(startCell.isRangeStart, true);
  assert.equal(startCell.isSelected, true);
  assert.equal(midCell.isInRange, true);
  assert.equal(endCell.isRangeEnd, true);
  assert.equal(todayCell.isToday, true);
  assert.equal(afterMaxCell.isDisabled, true);
});

test('resolveRangeSelectionClick supports intuitive start/end picking and reverse click swapping', () => {
  const step1 = core.resolveRangeSelectionClick('', '', '2026-11-10', 'start');
  assert.deepEqual(step1, { start: '2026-11-10', end: '', nextRole: 'end', completed: false });

  const step2 = core.resolveRangeSelectionClick(step1.start, step1.end, '2026-11-18', step1.nextRole);
  assert.deepEqual(step2, { start: '2026-11-10', end: '2026-11-18', nextRole: 'end', completed: true });

  // Clicking earlier than start while picking end swaps smoothly
  const reversed = core.resolveRangeSelectionClick('2026-11-15', '', '2026-11-08', 'end');
  assert.deepEqual(reversed, { start: '2026-11-08', end: '2026-11-15', nextRole: 'end', completed: true });
});

test('clampPdfPage and computePdfZoom enforce page boundaries and compute zoom modes cleanly', () => {
  assert.equal(core.clampPdfPage(0, 5), 1);
  assert.equal(core.clampPdfPage(-3, 5), 1);
  assert.equal(core.clampPdfPage(3, 5), 3);
  assert.equal(core.clampPdfPage(9, 5), 5);
  assert.equal(core.clampPdfPage(2, 0), 1);

  assert.deepEqual(core.computePdfZoom('in', 1), { scale: 1.25, mode: 'custom' });
  assert.deepEqual(core.computePdfZoom('out', 1), { scale: 0.75, mode: 'custom' });
  assert.deepEqual(core.computePdfZoom('reset', 1.75), { scale: 1, mode: 'custom' });

  const fitWidth = core.computePdfZoom('fit-width', 1, {
    viewportWidth: 1040,
    viewportHeight: 700,
    pageWidth: 1000,
    pageHeight: 1400,
    padX: 40,
    padY: 40
  });
  assert.equal(fitWidth.mode, 'fit-width');
  assert.equal(fitWidth.scale, 1);

  const fitPage = core.computePdfZoom('fit-page', 1, {
    viewportWidth: 1040,
    viewportHeight: 740,
    pageWidth: 1000,
    pageHeight: 1400,
    padX: 40,
    padY: 40
  });
  assert.equal(fitPage.mode, 'fit-page');
  assert.equal(fitPage.scale, 0.5);
});
