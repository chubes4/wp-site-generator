#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const renderer = path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs');

const bench = {
	data: {
		results: {
			scenarios: [
				{
					id: 'ssi-import',
					metrics: {
						ssi_signal_total_count: 0,
						ssi_fallback_count: 0,
					},
					metadata: {
						import_report_summary: {
							path: '/tmp/import-report.json',
							readable: true,
							top_level_keys: ['runtime_dependency_parity'],
							runtime_dependency_parity: {
								status: 'failed',
								script_count: 3,
								materialized_script_count: 1,
								missing_target_count: 1,
								unsupported_runtime_target_count: 1,
								vendor_script_count: 1,
								top_findings: [
									{
										type: 'missing_runtime_target',
										target: '#canvas',
										script: 'script.js',
										message: 'script.js references #canvas, but the target was not materialized.',
									},
									{
										type: 'unsupported_runtime_target',
										target: 'canvas',
										script: 'script.js',
										message: 'Canvas runtime target is unsupported by the importer.',
									},
								],
							},
						},
					},
				},
			],
		},
	},
};

const output = await runRenderer(renderer, bench);

assert.match(output, /### Runtime Dependency Parity/, 'runtime dependency parity section is rendered');
assert.match(output, /\| status \| failed \|/, 'runtime dependency parity status is rendered');
assert.match(output, /\| script count \| 3 \|/, 'script count is rendered');
assert.match(output, /\| materialized script count \| 1 \|/, 'materialized script count is rendered');
assert.match(output, /\| missing target count \| 1 \|/, 'missing target count is rendered');
assert.match(output, /\| unsupported runtime target count \| 1 \|/, 'unsupported runtime target count is rendered');
assert.match(output, /\| vendor script count \| 1 \|/, 'vendor script count is rendered');
assert.match(output, /missing_runtime_target/, 'top missing-target finding is rendered');
assert.match(output, /#canvas/, 'lost DOM target is rendered');
assert.match(output, /script\.js references #canvas/, 'finding message is rendered');
assert.match(output, /unsupported_runtime_target/, 'unsupported target finding is rendered');

const metricsOutput = await runRenderer(renderer, {
	data: {
		results: {
			scenarios: [
				{
					id: 'ssi-import',
					metrics: {
						ssi_signal_total_count: 0,
						ssi_runtime_dependency_parity_script_count: 2,
						ssi_runtime_dependency_parity_materialized_script_count: 1,
						ssi_runtime_dependency_parity_missing_target_count: 1,
						ssi_runtime_dependency_parity_unsupported_runtime_target_count: 0,
						ssi_runtime_dependency_parity_vendor_script_count: 1,
						ssi_runtime_dependency_parity_status: 'failed',
					},
					metadata: {},
				},
			],
		},
	},
});

assert.match(metricsOutput, /### Runtime Dependency Parity/, 'flat runtime dependency metrics render a parity section');
assert.match(metricsOutput, /\| status \| failed \|/, 'flat runtime dependency status is rendered');
assert.match(metricsOutput, /\| script count \| 2 \|/, 'flat runtime dependency script count is rendered');
assert.doesNotMatch(metricsOutput, /ssi_runtime_dependency_parity_script_count/, 'consumed parity metrics are not duplicated as other metrics');

console.log('render SSI validation runtime dependency parity passed');

function runRenderer(scriptPath, payload) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath], {
			env: { ...process.env, BENCH_PATH: '-' },
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`renderer exited with ${code}: ${stderr}`));
				return;
			}
			resolve(stdout);
		});
		child.stdin.end(JSON.stringify(payload));
	});
}
