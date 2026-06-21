#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ssiSignalMetrics } from '../../.github/scripts/lib/ssi-metrics.mjs';
import { writeJson } from '../helpers/artifact-contracts.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const diagnostics = await readFile(path.join(repoRoot, '.github/homeboy/ssi-import-diagnostics.php'), 'utf8');
const tmp = await mkdtemp(path.join(tmpdir(), 'ssi-import-diagnostics-contract-'));
const benchPath = path.join(tmp, 'bench.json');

assert.match(diagnostics, /'ssi_freeform_block_count'\s*=>\s*0/, 'diagnostics initializes a freeform block metric');
assert.match(diagnostics, /'diagnostics'\s*=>\s*\$diagnostics/, 'diagnostics exposes modern diagnostic rows');
assert.match(diagnostics, /'ssi_bac_available'\s*=>\s*0/, 'diagnostics initializes BAC availability metric');
assert.doesNotMatch(diagnostics, /freeform_diagnostics/, 'diagnostics does not expose legacy freeform diagnostic rows');
assert.doesNotMatch(diagnostics, /fallback_diagnostics/, 'diagnostics does not expose legacy fallback diagnostic rows');
assert.doesNotMatch(diagnostics, /'findings'/, 'diagnostics does not expose legacy finding rows');
assert.deepEqual(ssiSignalMetrics.find(([key]) => key === 'ssi_freeform_block_count'), ['ssi_freeform_block_count', 'freeform blocks'], 'validation report displays freeform block counts with the other SSI signals');

await writeJson(benchPath, {
	data: {
		results: {
			scenarios: [
				{
					id: 'ssi-import',
					metrics: {
						ssi_signal_total_count: 1,
						ssi_freeform_block_count: 1,
						ssi_bac_available: 1,
					},
					metadata: {
						import_report_summary: {
							path: '/tmp/import-report.json',
							readable: true,
							top_level_keys: ['quality', 'diagnostics', 'block_artifact_compiler'],
							block_artifact_compiler: {
								status: 'success',
								website_artifact_summary: { component_count: 4 },
							},
							diagnostics: [
								{
									diagnostic_id: 'diag-freeform-header',
									severity: 'warning',
									category: 'fallback_block',
									format: 'html',
									source_path: 'parts/header.html',
									block_name: 'core/freeform',
									converter: 'blocks-engine-php-transformer',
									stage: 'generated_theme_block_analysis',
									reason_code: 'generated_document_contains_core_freeform',
									suggested_repair_class: 'replace_fallback_block',
									message: 'generated_document_contains_core_freeform',
									source_html_preview: '<a class="nav-logo">Field Notes Live</a>',
								},
							],
						},
					},
				},
			],
		},
	},
});

const rendered = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs')], {
	cwd: repoRoot,
	env: { ...process.env, BENCH_PATH: benchPath },
	encoding: 'utf8',
});

assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
assert.match(rendered.stdout, /\| freeform blocks \| 1 \|/, 'validation report renders freeform block counts from the artifact contract');
assert.match(rendered.stdout, /### Blocks Engine Artifact Compiler/, 'validation report displays Blocks Engine compiler status from the import report');
assert.match(rendered.stdout, /Website Artifact Summary/, 'validation report displays BAC website artifact summary');
assert.match(rendered.stdout, /Reason Code/, 'validation report displays modern diagnostic fields');
assert.match(rendered.stdout, /diag-freeform-header/, 'validation report renders modern diagnostic rows');

console.log('ssi import diagnostics freeform smoke passed');
