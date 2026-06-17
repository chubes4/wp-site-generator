import assert from 'node:assert/strict';

import { evaluateStaticSitePublishGate } from '../../.github/scripts/evaluate-static-site-publish-gate.mjs';

const passing = evaluateStaticSitePublishGate({
	validation: {
		metrics: {
			fallback_blocks: 0,
			conversion_findings: { actionable: 0 },
		},
	},
	visualParity: {
		summary: {
			status: 'pass',
			mismatch_count: 0,
			max_delta_ratio: 0,
		},
	},
});
assert.equal(passing.publish_allowed, true, 'clean validation allows publication');
assert.equal(passing.gates.fallback_blocks.passed, true, 'fallback gate passes');
assert.equal(passing.gates.conversion_findings.passed, true, 'conversion gate passes');
assert.equal(passing.gates.visual_parity.passed, true, 'visual parity gate passes');

const failing = evaluateStaticSitePublishGate({
	validation: {
		metrics: {
			fallback_block_count: 1,
			conversion_findings: { actionable_count: 2 },
		},
	},
	visualParity: {
		summary: {
			status: 'fail',
			mismatch_count: 1,
			max_delta_ratio: 0.12,
		},
	},
});
assert.equal(failing.publish_allowed, false, 'failed validation blocks publication');
assert.deepEqual(failing.failed_gates, ['fallback_blocks', 'conversion_findings', 'visual_parity'], 'all failed gates are explicit');
assert.equal(failing.gates.fallback_blocks.passed, false, 'fallback failures are deterministic');
assert.equal(failing.gates.conversion_findings.passed, false, 'conversion failures are deterministic');
assert.equal(failing.gates.visual_parity.passed, false, 'visual parity failures are deterministic');

console.log('static site publish gate tests passed');
