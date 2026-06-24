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
							path: 'homeboy-ci-results/import-report.json',
							readable: true,
							top_level_keys: ['visual_fidelity', 'semantic_fidelity'],
							visual_fidelity: {
								status: 'requires_runtime_visual_parity_check',
								not_captured_reason: 'Playwright screenshots are captured by the offloaded validation workflow.',
								viewports: [
									{ name: 'desktop', width: 1440, height: 1200 },
									{ name: 'mobile', width: 390, height: 844 },
								],
								diff: {
									status: 'not_captured',
								},
							},
							semantic_fidelity: {
								status: 'requires_external_render_check',
								reason: 'Imported DOM must be rendered before semantic comparison.',
								dom_semantic_fingerprint: {
									status: 'not_captured',
								},
							},
						},
						visual_artifact: {
							artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/456',
							summary_path: 'visual-parity-artifacts/demo/summary.json',
							visual_diff_path: 'visual-parity-artifacts/demo/visual-diff.json',
						},
					},
				},
			],
		},
	},
};

const output = await runRenderer(renderer, bench);

assert.match(output, /### Visual\/Semantic Evidence/, 'visual and semantic evidence section is rendered');
assert.match(output, /requires_runtime_visual_parity_check/, 'visual pending status is visible');
assert.match(output, /Playwright screenshots are captured by the offloaded validation workflow\./, 'visual not-captured reason is visible');
assert.match(output, /desktop \(1440x1200\)/, 'desktop viewport is visible');
assert.match(output, /mobile \(390x844\)/, 'mobile viewport is visible');
assert.match(output, /source screenshot/, 'expected source screenshot slot is visible');
assert.match(output, /visual-diff\.json/, 'expected visual diff slot/path is visible');
assert.match(output, /requires_external_render_check/, 'semantic pending status is visible');
assert.match(output, /DOM semantic fingerprint/, 'semantic fingerprint status is visible');
assert.match(output, /https:\/\/github\.com\/chubes4\/wp-site-generator\/actions\/runs\/123\/artifacts\/456/, 'runner artifact URL is visible when present');

console.log('render SSI validation visual/semantic pending evidence passed');

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
