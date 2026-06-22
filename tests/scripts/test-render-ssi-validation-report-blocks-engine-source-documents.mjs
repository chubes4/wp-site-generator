#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runtimeValidationArtifactEnvelopeSchema } from '../../.github/scripts/lib/ci-runtime-utils.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const renderer = path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs');
const codeboxContractFixture = JSON.parse(await readFile(path.join(repoRoot, 'tests/fixtures/codebox-provider-runtime-contract.json'), 'utf8'));
const validationArtifactSchema = codeboxContractFixture.result_schemas.evidence_artifact_envelope.replace('evidence', 'validation');

const bench = {
	data: {
		results: {
			scenarios: [
				{
					id: 'ssi-import',
					metrics: {
						ssi_signal_total_count: 3,
						ssi_fallback_count: 1,
						ssi_freeform_block_count: 2,
						ssi_blocks_engine_available: 1,
						ssi_blocks_engine_component_count: 4,
					},
					metadata: {
						import_report_summary: {
							path: '/tmp/import-report.json',
							readable: true,
							top_level_keys: ['source_documents', 'blocks_engine', 'diagnostics'],
							source_documents: {
								total_count: 4,
								counts_by_kind: {
									html: 1,
									markdown: 2,
									mdx: 1,
								},
								skipped_mdx_count: 1,
							},
							blocks_engine: {
								available: true,
								status: 'success_with_warnings',
								source_documents: {
									total_count: 3,
									counts_by_kind: {
										html: 1,
										markdown: 1,
										mdx: 1,
									},
									skipped_mdx_count: 1,
								},
								candidate_counts: {
									component_candidate_count: 5,
									block_candidate_count: 8,
								},
							},
							validation_artifact_envelope: {
								schema: runtimeValidationArtifactEnvelopeSchema({ HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA: validationArtifactSchema }),
								status: 'passed',
								validation_hash: 'runtime-validation-fixture',
								artifacts: [{ name: 'import-report.json' }, { name: 'visual-summary.json' }],
							},
							diagnostics: [
								{
									diagnostic_id: 'unsupported-source-doc-docs-widget-mdx',
									type: 'unsupported_source_document',
									severity: 'warning',
									format: 'mdx',
									source_path: 'docs/widget.mdx',
									message: 'MDX source documents are not supported and were skipped.',
								},
							],
						},
					},
				},
			],
		},
	},
};

const output = await runRenderer(renderer, bench);

assert.match(output, /### SSI Signals/, 'existing SSI metrics remain visible');
assert.match(output, /fallback blocks/, 'existing fallback metric remains visible');
assert.match(output, /### Blocks Engine Transformer/, 'Blocks Engine status section remains visible');
assert.match(output, /\*\*Status:\*\* `success_with_warnings`/, 'Blocks Engine status is rendered');
assert.match(output, /Blocks Engine Source Documents/, 'Blocks Engine source-document counts are rendered');
assert.match(output, /\| markdown \| 1 \|/, 'Blocks Engine source-document counts include Markdown');
assert.match(output, /\| mdx \| 1 \|/, 'Blocks Engine source-document counts include MDX');
assert.match(output, /\| component candidate count \| 5 \|/, 'Blocks Engine component candidate count is rendered');
assert.match(output, /\| block candidate count \| 8 \|/, 'Blocks Engine block candidate count is rendered');
assert.match(output, /### Runtime Validation Artifact Envelope/, 'optional runtime validation artifact envelope is rendered');
assert.match(output, new RegExp(escapeRegExp(validationArtifactSchema)), 'validation artifact envelope schema is rendered from the runtime contract');
assert.match(output, /runtime-validation-fixture/, 'validation artifact envelope hash is rendered');
assert.match(output, /### Source Documents/, 'SSI source-document section is rendered');
assert.match(output, /Skipped\/Unsupported MDX/, 'MDX diagnostics table is rendered');
assert.match(output, /docs\/widget\.mdx/, 'MDX diagnostic includes source path');
assert.match(output, /MDX source documents are not supported and were skipped\./, 'MDX diagnostic includes message');

console.log('render SSI validation Blocks Engine source documents smoke passed');

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

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
