#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tmp = await mkdtemp(path.join(tmpdir(), 'ssi-freeform-packets-'));
const benchPath = path.join(tmp, 'bench.json');
const outputPath = path.join(tmp, 'finding-packets.json');

await writeFile(
	benchPath,
	JSON.stringify({
		success: true,
		data: {
			payload: {
				status: 'success',
				results: {
					scenarios: [
						{
							id: 'ssi-import',
							metadata: {
								import_report_summary: {
									path: 'import-report.json',
									diagnostics: [
										{
											diagnostic_id: 'diag-freeform-header',
											type: 'freeform_block',
											source_path: 'parts/header.html',
											severity: 'warning',
											category: 'fallback_block',
											reason_code: 'generated_document_contains_core_freeform',
											suggested_repair_class: 'replace_fallback_block',
											block_path: '1',
											selector: 'a.nav-logo',
											excerpt: 'Field Notes Live',
											source_html_preview: '<a href="#" class="nav-logo">Field Notes Live</a>',
											emitted_block_preview: '<!-- wp:freeform --><a href="#" class="nav-logo">Field Notes Live</a><!-- /wp:freeform -->',
											block_name: 'core/freeform',
											converter: 'html-to-blocks-converter',
											stage: 'generated_theme_block_analysis',
											message: 'generated_document_contains_core_freeform',
										},
									],
								},
							},
						},
					],
				},
			},
		},
	})
);

const result = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-ssi-finding-packets.mjs')], {
	cwd: repoRoot,
	env: {
		...process.env,
		SITE: 'demo-store',
		SOURCE_REPO: 'chubes4/wp-site-generator',
		BENCH_PATH: benchPath,
		VISUAL_DIFF_PATH: path.join(tmp, 'missing-visual-diff.json'),
		FINDING_PACKETS_PATH: outputPath,
		DESIGN_DISTRIBUTION_PATH: path.join(tmp, 'design-distribution.json'),
	},
	encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const packets = JSON.parse(await readFile(outputPath, 'utf8'));
const concrete = packets.find((packet) => packet.kind === 'freeform_block' && packet.source_html_preview);

assert.ok(concrete, 'Expected concrete freeform diagnostic packet');
assert.equal(concrete.schema_version, 3);
assert.equal(concrete.candidate_repo, 'Automattic/blocks-engine');
assert.equal(concrete.category, 'fallback_block');
assert.equal(concrete.reason_code, 'generated_document_contains_core_freeform');
assert.equal(concrete.suggested_repair_class, 'replace_fallback_block');
assert.equal(concrete.block_name, 'core/freeform');
assert.equal(concrete.block_path, '1');
assert.equal(concrete.selector, 'a.nav-logo');
assert.equal(concrete.converter, 'html-to-blocks-converter');
assert.equal(concrete.stage, 'generated_theme_block_analysis');
assert.equal(concrete.reason, 'generated_document_contains_core_freeform');
assert.equal(concrete.artifact_names.finding_packet_set, 'finding-packets.json');
assert.equal(concrete.artifact_names.finding_packets_file, undefined);
assert.match(concrete.emitted_block_preview, /wp:freeform/);
assert.equal(concrete.repair_mode, 'pr_or_issue');

console.log('build SSI freeform finding packets smoke passed');
