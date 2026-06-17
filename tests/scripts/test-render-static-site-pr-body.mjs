import assert from 'node:assert/strict';

import { normalizePublishGateRows, normalizeValidationMetrics, renderStaticSitePrBody } from '../../.github/scripts/render-static-site-pr-body.mjs';

const validation = {
	status: 'passed',
	metrics: {
		ssi_fallback_count: 0,
		ssi_core_html_count: 2,
		ssi_freeform_block_count: 1,
		ssi_invalid_block_count: 0,
		ssi_signal_total_count: 3,
	},
	artifacts: {
		'import-ready': 'artifact://import-ready.json',
		'report': 'artifact://ssi-report.json',
	},
};

const metrics = normalizeValidationMetrics(validation);
assert.deepEqual(metrics, [
	['Status', 'passed'],
	['Fallback blocks', 0],
	['Core HTML blocks', 2],
	['Freeform blocks', 1],
	['Invalid blocks', 0],
	['Total findings', 3],
]);

const publishGate = {
	publish_allowed: true,
	gates: {
		fallback_blocks: { passed: true, value: 0, target: 'value === 0' },
		conversion_findings: { passed: true, value: 0, target: 'value === 0' },
		visual_parity: { passed: true, status: 'pass', mismatch_count: 0, max_delta_ratio: 0, target: 'status passes' },
	},
};

assert.deepEqual(normalizePublishGateRows(publishGate).map((row) => [row.label, row.passed]), [
	['Fallback blocks', true],
	['Conversion findings', true],
	['Visual parity', true],
]);

const body = renderStaticSitePrBody({
	candidate: {
		title: 'Kiln Ledger',
		site_id: 'issue-367-kiln-ledger',
		summary: 'Adds the generated Kiln Ledger static site.',
	},
	validation,
	publishGate,
	closes: 'Closes #367',
});

assert.match(body, /## Import validation/, 'PR body includes validation section at creation time');
assert.match(body, /\| Fallback blocks \| 0 \|/, 'PR body includes fallback block count');
assert.match(body, /\| Core HTML blocks \| 2 \|/, 'PR body includes conversion finding counts');
assert.match(body, /import-ready: artifact:\/\/import-ready\.json/, 'PR body includes validation artifact references');
assert.match(body, /## Publication gate/, 'PR body includes deterministic publication gate section');
assert.match(body, /Publish allowed: true/, 'PR body includes publish_allowed result');
assert.match(body, /\| Visual parity \| pass \| status=pass; mismatches=0; max_delta=0 \| status passes \|/, 'PR body includes visual parity gate result');
assert.match(body, /Closes #367/, 'PR body preserves close reference when supplied');

console.log('static site PR body renderer passed');
