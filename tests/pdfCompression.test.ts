import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/core.js');

test('clampPdfTargetPages clamps inputs strictly between 1 and 10', () => {
  assert.equal(core.clampPdfTargetPages(0), 1);
  assert.equal(core.clampPdfTargetPages(-5), 1);
  assert.equal(core.clampPdfTargetPages('not-a-number'), 1);
  assert.equal(core.clampPdfTargetPages(1), 1);
  assert.equal(core.clampPdfTargetPages(4.6), 5);
  assert.equal(core.clampPdfTargetPages(10), 10);
  assert.equal(core.clampPdfTargetPages(42), 10);
});

test('resolvePdfExportSettings normalizes presets, quality profiles, and defaults', () => {
  const def = core.resolvePdfExportSettings({});
  assert.deepEqual(def, {
    targetPages: 3,
    preset: 'balanced',
    optimizeFileSize: true,
    quality: 'balanced',
    paperSize: 'a4',
    orientation: 'landscape'
  });

  const compact = core.resolvePdfExportSettings({ preset: 'compact', quality: 'small' });
  assert.equal(compact.targetPages, 1);
  assert.equal(compact.preset, 'compact');
  assert.equal(compact.quality, 'small');

  const comfortable = core.resolvePdfExportSettings({ preset: 'comfortable', paperSize: 'letter', orientation: 'portrait' });
  assert.equal(comfortable.targetPages, 6);
  assert.equal(comfortable.paperSize, 'letter');
  assert.equal(comfortable.orientation, 'portrait');

  const custom = core.resolvePdfExportSettings({ preset: 'custom', targetPages: 99, optimizeFileSize: false });
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.targetPages, 10);
  assert.equal(custom.optimizeFileSize, false);
});

test('layout presets progress cleanly in spacing, margins, and typography from compact -> balanced -> comfortable', () => {
  const compactPlan = core.computePdfLayoutPlan({ preset: 'compact', rowCount: 10, columnCount: 6, chartCount: 0 });
  const balancedPlan = core.computePdfLayoutPlan({ preset: 'balanced', rowCount: 10, columnCount: 6, chartCount: 0 });
  const comfortablePlan = core.computePdfLayoutPlan({ preset: 'comfortable', rowCount: 10, columnCount: 6, chartCount: 0 });

  assert.ok(compactPlan.marginPt < balancedPlan.marginPt);
  assert.ok(balancedPlan.marginPt < comfortablePlan.marginPt);

  assert.ok(compactPlan.baseFont < balancedPlan.baseFont);
  assert.ok(balancedPlan.baseFont < comfortablePlan.baseFont);

  assert.ok(compactPlan.cellPadY < balancedPlan.cellPadY);
  assert.ok(balancedPlan.cellPadY < comfortablePlan.cellPadY);

  assert.ok(compactPlan.estimatedPages <= balancedPlan.estimatedPages);
  assert.ok(balancedPlan.estimatedPages <= comfortablePlan.estimatedPages);
});

test('computePdfLayoutPlan fits modest dataset to 1 page cleanly and triggers readability warning when dataset exceeds safe 1-page floor', () => {
  const smallFit = core.computePdfLayoutPlan({
    preset: 'custom',
    targetPages: 1,
    rowCount: 8,
    columnCount: 6,
    kpiCount: 2,
    chartCount: 0,
    lang: 'en'
  });
  assert.equal(smallFit.estimatedPages, 1);
  assert.equal(smallFit.readabilityWarning, false);
  assert.ok(smallFit.baseFont >= 8.0, 'Readable minimum font floor respected');

  const hugeDataset = core.computePdfLayoutPlan({
    preset: 'custom',
    targetPages: 1,
    rowCount: 140,
    columnCount: 9,
    kpiCount: 4,
    extraSectionsCount: 1,
    extraLinesCount: 20,
    chartCount: 2,
    lang: 'en'
  });
  assert.ok(hugeDataset.estimatedPages > 1, 'Should not clip or drop rows to force 1 page');
  assert.equal(hugeDataset.readabilityWarning, true);
  assert.equal(hugeDataset.warningCode, 'MIN_PAGES_EXCEEDED');
  assert.ok(hugeDataset.warningMessage.includes('readability'));
  assert.ok(hugeDataset.warningMessageAr.length > 0);
  assert.ok(hugeDataset.baseFont >= 7.6, 'Minimum readable font floor enforced for 9 columns');
});

test('computePdfLayoutPlan expands whitespace and distributes rows across higher target pages (e.g. 5 or 10)', () => {
  const argsBase = {
    preset: 'custom',
    rowCount: 24,
    columnCount: 7,
    kpiCount: 2,
    extraSectionsCount: 1,
    extraLinesCount: 12,
    chartCount: 2,
    orientation: 'landscape'
  };

  const densePlan = core.computePdfLayoutPlan({ ...argsBase, targetPages: 2 });
  const midPlan = core.computePdfLayoutPlan({ ...argsBase, targetPages: 5 });
  const airyPlan = core.computePdfLayoutPlan({ ...argsBase, targetPages: 10 });

  assert.ok(midPlan.estimatedPages >= densePlan.estimatedPages);
  assert.ok(airyPlan.estimatedPages > midPlan.estimatedPages);
  assert.ok(airyPlan.estimatedPages <= 10);
  assert.ok(airyPlan.marginPt >= midPlan.marginPt);
  assert.ok(airyPlan.baseFont >= densePlan.baseFont);
});

test('file size optimization & quality profiles monotonically reduce estimated file size and configure compression flags', () => {
  const common = {
    preset: 'balanced',
    targetPages: 3,
    rowCount: 20,
    columnCount: 7,
    chartCount: 2
  };

  const smallOpt = core.computePdfLayoutPlan({ ...common, optimizeFileSize: true, quality: 'small' });
  const balOpt = core.computePdfLayoutPlan({ ...common, optimizeFileSize: true, quality: 'balanced' });
  const highOpt = core.computePdfLayoutPlan({ ...common, optimizeFileSize: true, quality: 'high' });
  const unopt = core.computePdfLayoutPlan({ ...common, optimizeFileSize: false, quality: 'high' });

  assert.ok(smallOpt.estimatedBytes < balOpt.estimatedBytes, 'small < balanced');
  assert.ok(balOpt.estimatedBytes < highOpt.estimatedBytes, 'balanced < high');
  assert.ok(highOpt.estimatedBytes < unopt.estimatedBytes, 'high optimized < unoptimized');

  assert.equal(smallOpt.compressStreams, true);
  assert.equal(smallOpt.stripMetadata, true);
  assert.equal(smallOpt.imageCompression, 'SLOW');
  assert.equal(unopt.compressStreams, false);
  assert.equal(unopt.stripMetadata, false);
  assert.equal(unopt.imageCompression, 'FAST');
});
