import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from '../../.github/scripts/lib/datamachine-ai-workflow.mjs';
import { githubToken } from '../../.github/scripts/lib/github-api.mjs';
import { loadRecoveredSsiImportSummary, recoveredSsiScenarioFromImportSummary } from '../../.github/scripts/lib/ssi-import-summary.mjs';
import { ssiPrBodyMetrics, validationMetricValue } from '../../.github/scripts/lib/ssi-metrics.mjs';

assert.equal(githubToken({ GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' }), 'gh');
assert.equal(githubToken({ GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' }, ['GITHUB_TOKEN', 'GH_TOKEN']), 'github');

const workflow = buildSingleAiWorkflow({
	step: buildSingleAiWorkflowStep({
		aiConfig: { label: 'Repair transformer findings', system_prompt: 'system', disabled_tools: ['create_issue'] },
		flowStep: { enabled_tools: ['comment_github_pull_request'] },
		prompt: 'repair these findings',
		addedAt: 'test-build',
	}),
	initialData: { job_source: 'system' },
});

assert.deepEqual(workflow, {
	workflow: {
		steps: [
			{
				step_type: 'ai',
				label: 'Repair transformer findings',
				system_prompt: 'system',
				prompt_queue: [{ prompt: 'repair these findings', added_at: 'test-build' }],
				queue_mode: 'static',
				enabled_tools: ['comment_github_pull_request'],
				disabled_tools: ['create_issue'],
				completion_assertions: {},
				tool_runtime_rules: [],
			},
		],
	},
	initial_data: { job_source: 'system' },
});

const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-shared-libs-'));
const recoveredPath = path.join(tempDir, 'summary.json');
await mkdir(path.dirname(recoveredPath), { recursive: true });
await writeFile(recoveredPath, `${JSON.stringify({
	importReadiness: {
		import_result: {
			report_path: '/wordpress/wp-content/themes/example/import-report.json',
			quality: { fallback_count: 1, core_html_block_count: 2, freeform_block_count: 3, invalid_block_count: 4, diagnostic_count: 10 },
			import_report_summary: { status: 'completed' },
		},
	},
}, null, 2)}\n`);

const recovered = await loadRecoveredSsiImportSummary([path.join(tempDir, 'missing.json'), recoveredPath]);
const scenario = recoveredSsiScenarioFromImportSummary(recovered);
assert.equal(scenario.id, 'ssi-import');
assert.equal(scenario.metadata.import_report_summary.path, '/wordpress/wp-content/themes/example/import-report.json');
assert.deepEqual(scenario.metrics, {
	ssi_signal_total_count: 10,
	ssi_core_html_count: 2,
	ssi_fallback_count: 1,
	ssi_freeform_block_count: 3,
	ssi_invalid_block_count: 4,
});

assert.deepEqual(ssiPrBodyMetrics.map(([label]) => label), [
	'Fallback blocks',
	'Core HTML blocks',
	'Freeform blocks',
	'Invalid blocks',
	'Total findings',
]);
assert.equal(validationMetricValue({ conversion_findings: { core_html_blocks: 7 } }, 'ssi_core_html_count'), 7);
assert.equal(validationMetricValue({ metrics: { ssi_fallback_count: 5 } }, 'ssi_fallback_count'), 5);

console.log('shared script libs passed');
