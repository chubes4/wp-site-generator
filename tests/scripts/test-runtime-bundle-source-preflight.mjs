import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRuntimeBundleSources } from '../../.github/scripts/lib/runtime-bundle-source-preflight.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpsg-runtime-bundle-preflight-'));

try {
	fs.mkdirSync(path.join(root, 'bundles', 'partial-agent'), { recursive: true });
	fs.mkdirSync(path.join(root, 'bundles', 'complete-agent'), { recursive: true });
	fs.writeFileSync(path.join(root, 'bundles', 'complete-agent', 'manifest.json'), JSON.stringify({ schema_version: 1 }));
	fs.writeFileSync(path.join(root, 'complete.json'), '{}');

	const controllerPath = path.join(root, 'controller.json');
	fs.writeFileSync(controllerPath, JSON.stringify({
		workflows: [
			{ workflow_id: 'missing', runtime_execution: { kind: 'bundle', input: { package: { source: 'bundles/missing-agent' } } } },
			{ workflow_id: 'partial', runtime_execution: { kind: 'bundle', input: { package: { source: 'bundles/partial-agent' } } } },
			{ workflow_id: 'complete-dir', runtime_execution: { kind: 'bundle', input: { package: { source: 'bundles/complete-agent' } } } },
			{ workflow_id: 'complete-json', runtime_execution: { kind: 'bundle', input: { package: { source: 'complete.json' } } } },
		],
	}));

	assert.throws(
		() => validateRuntimeBundleSources({ root, controllerSpecPath: 'controller.json' }),
		(error) => {
			assert.match(error.message, /missing: runtime package source does not exist/);
			assert.match(error.message, /partial: runtime package directory must include manifest\.json/);
			assert.doesNotMatch(error.message, /complete-dir/);
			assert.doesNotMatch(error.message, /complete-json/);
			return true;
		},
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}

console.log('runtime bundle source preflight ok');
