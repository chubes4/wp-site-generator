#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const renderer = path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-render-visual-summary-'));
const site = 'issue-356-kiln-shelf-commons';
const visualDir = path.join(tempDir, 'visual-parity-artifacts', site);

await mkdir(visualDir, { recursive: true });
await writeJson(path.join(visualDir, 'summary.json'), {
	site,
	importReadiness: {
		import_result: {
			report_path: `/wordpress/wp-content/themes/${site}/import-report.json`,
			import_report_summary: {
				status: 'completed',
				entry_file: `/wordpress/wp-content/plugins/wp-site-generator/static-sites/${site}/index.html`,
				quality_pass: true,
				fallback_count: 0,
				core_html_block_count: 0,
				freeform_block_count: 0,
				invalid_block_count: 0,
				content_loss_count: 0,
				diagnostic_count: 0,
			},
		},
	},
});

const result = spawnSync(process.execPath, [renderer], {
	cwd: repoRoot,
	env: {
		...process.env,
		SITE: site,
		BENCH_PATH: path.join(tempDir, 'homeboy-ci-results/bench.json'),
		VISUAL_SUMMARY_PATH: path.join(visualDir, 'summary.json'),
		IMPORT_READY_PATH: path.join(visualDir, 'import-ready.json'),
	},
	encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.doesNotMatch(result.stdout, /SSI workload did not run/, 'visual import readiness suppresses missing workload noise');
assert.match(result.stdout, /### SSI Signals/, 'visual import readiness renders the normal SSI report sections');
assert.match(result.stdout, /fallback blocks \| 0/, 'recovered quality metrics are rendered');
assert.match(result.stdout, /### SSI Import Report/, 'recovered import report summary is rendered');
assert.match(result.stdout, new RegExp(`/wordpress/wp-content/themes/${site}/import-report\\.json`), 'recovered report path is rendered');

console.log('render SSI validation visual summary fallback passed');

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
