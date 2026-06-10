import assert from 'node:assert/strict';

import { normalizeValidationMetrics, renderStaticSitePrBody } from '../../.github/scripts/render-static-site-pr-body.mjs';

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

const body = renderStaticSitePrBody({
	candidate: {
		title: 'Kiln Ledger',
		site_id: 'issue-367-kiln-ledger',
		summary: 'Adds the generated Kiln Ledger static site.',
	},
	validation,
	closes: 'Closes #367',
});

assert.match(body, /## Import validation/, 'PR body includes validation section at creation time');
assert.match(body, /\| Fallback blocks \| 0 \|/, 'PR body includes fallback block count');
assert.match(body, /\| Core HTML blocks \| 2 \|/, 'PR body includes conversion finding counts');
assert.match(body, /import-ready: artifact:\/\/import-ready\.json/, 'PR body includes validation artifact references');
assert.match(body, /Closes #367/, 'PR body preserves close reference when supplied');

console.log('static site PR body renderer passed');
