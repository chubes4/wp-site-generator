#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const renderer = path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-render-semantic-parity-'));
const benchPath = path.join(tempDir, 'bench.json');

await mkdir(tempDir, { recursive: true });
await writeJson(benchPath, {
	success: true,
	data: {
		results: {
			scenarios: [
				{
					id: 'ssi-import',
					metrics: {
						ssi_signal_total_count: 1,
						ssi_core_html_count: 0,
						ssi_fallback_count: 0,
						ssi_freeform_block_count: 0,
						ssi_invalid_block_count: 0,
					},
					metadata: {
						import_report_summary: {
							path: '/tmp/import-report.json',
							readable: true,
							top_level_keys: ['semantic_parity'],
							semantic_parity: {
								status: 'fail',
								source_nav_count: 1,
								generated_navigation_count: 0,
								nav_item_mismatch_count: 4,
								landmark_mismatch_count: 1,
								top_findings: [
									{
										code: 'navigation_missing',
										severity: 'error',
										message: 'Source navigation landmark was not preserved in generated WordPress blocks.',
									},
								],
							},
						},
					},
				},
			],
		},
	},
});

const result = spawnSync(process.execPath, [renderer], {
	cwd: repoRoot,
	env: {
		...process.env,
		BENCH_PATH: benchPath,
		SSI_STACK_MANIFEST_PATH: path.join(tempDir, 'missing-manifest.json'),
	},
	encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /### Semantic Parity/, 'semantic parity section is rendered');
assert.match(result.stdout, /semantic_parity\.status \| fail/, 'semantic parity status is rendered');
assert.match(result.stdout, /source_nav_count \| 1/, 'source nav count is rendered');
assert.match(result.stdout, /generated_navigation_count \| 0/, 'generated navigation count is rendered');
assert.match(result.stdout, /nav_item_mismatch_count \| 4/, 'nav item mismatches are rendered');
assert.match(result.stdout, /landmark_mismatch_count \| 1/, 'landmark mismatches are rendered');
assert.match(result.stdout, /navigation_missing/, 'top semantic parity finding code is rendered');
assert.match(result.stdout, /Source navigation landmark was not preserved/, 'top semantic parity finding message is rendered');

console.log('render SSI validation semantic parity passed');

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
