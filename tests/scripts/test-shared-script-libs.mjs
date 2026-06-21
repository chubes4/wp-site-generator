import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from '../../bundles/php-transformer-iterator-agent/scripts/lib/agent-ai-workflow.mjs';
import {
	codeboxPluginMountTarget,
	codeboxRuntimePackageAbility,
	codeboxRuntimePackageProfiles,
	codeboxRuntimeProfileId,
	codeboxRuntimeProvider,
	codeboxRuntimeToolProfileInputs,
	codeboxRuntimeWorkflowInputs,
	codeboxWorkspaceRecipeSchema,
	envOrArg,
	numberValue,
	parseArgs,
	readJsonOrNull,
	repoPathResolver,
	resolveCodeboxCliPath,
	resolveCodeboxVisualParityOutputRoot,
	textValue,
} from '../../.github/scripts/lib/ci-runtime-utils.mjs';
import { loadRecoveredSsiImportSummary, recoveredSsiScenarioFromImportSummary } from '../../.github/scripts/lib/ssi-import-summary.mjs';
import { ssiPrBodyMetrics, validationMetricValue } from '../../.github/scripts/lib/ssi-metrics.mjs';

const args = parseArgs(['--repo', 'owner/repo', '--dry-run']);
assert.equal(envOrArg(args, '--repo', { SOURCE_REPO: 'env/repo' }, 'SOURCE_REPO'), 'owner/repo');
assert.equal(envOrArg(new Map(), '--repo', { SOURCE_REPO: 'env/repo' }, 'SOURCE_REPO'), 'env/repo');
assert.equal(envOrArg(new Map(), '--ref', {}, 'REF', 'main'), 'main');
assert.equal(args.get('--dry-run'), '1');
assert.equal(repoPathResolver('/tmp/repo')('.ci', 'artifact.json'), path.join('/tmp/repo', '.ci', 'artifact.json'));
assert.equal(textValue(' ok '), 'ok');
assert.equal(numberValue('4'), 4);
assert.equal(numberValue('bad', 9), 9);
assert.equal(codeboxRuntimeProvider(), 'wp-codebox', 'WP Codebox public runtime is selected by default');
assert.equal(codeboxRuntimeProfileId(), 'wpsg-agent-runtime-package', 'consumer-facing runtime package profile is generic');
assert.equal(codeboxRuntimePackageAbility(), 'agents/run-runtime-package', 'Codebox runtime exposes the generic runtime package ability through a named helper');
assert.equal(resolveCodeboxCliPath('/tmp/repo', {}), path.join('/tmp/repo', '.ci/wp-codebox/packages/cli/dist/index.js'));
assert.equal(resolveCodeboxCliPath('/tmp/repo', { WP_CODEBOX_CLI: '/custom/codebox.js' }), '/custom/codebox.js');
assert.equal(resolveCodeboxVisualParityOutputRoot({}), 'visual-parity-artifacts');
assert.equal(resolveCodeboxVisualParityOutputRoot({ VISUAL_PARITY_OUTPUT: 'custom-artifacts' }), 'custom-artifacts');
assert.equal(codeboxPluginMountTarget(), '/wordpress/wp-content/plugins/wp-site-generator');
assert.equal(codeboxWorkspaceRecipeSchema(), 'wp-codebox/workspace-recipe/v1');
assert.deepEqual(codeboxRuntimePackageProfiles(), {
	'wpsg-agent-runtime-package': {
		schema: 'homeboy/runtime-profile/v1',
		id: 'wpsg-agent-runtime-package',
		runtime_task_ability: 'agents/run-runtime-package',
		runtime_bundle_ability: 'agents/run-runtime-package',
		runtime_workflow_ability: 'agents/run-runtime-package',
		ability_requirements: ['agents/run-runtime-package'],
	},
	'wpsg-codebox-runtime-package': {
		schema: 'homeboy/runtime-profile/v1',
		id: 'wpsg-codebox-runtime-package',
		runtime_task_ability: 'agents/run-runtime-package',
		runtime_bundle_ability: 'agents/run-runtime-package',
		runtime_workflow_ability: 'agents/run-runtime-package',
		ability_requirements: ['agents/run-runtime-package'],
	},
}, 'runtime package profiles derive from the generic runtime package API');
const workspaceIterationInputs = codeboxRuntimeToolProfileInputs('workspace-iteration');
const workspaceIterationTools = JSON.parse(workspaceIterationInputs.ability_tools);
const workspaceIterationRequirements = JSON.parse(workspaceIterationInputs.ability_requirements);
assert.deepEqual(workspaceIterationTools.map((tool) => tool.name), [
	'workspace_clone',
	'workspace_worktree_add',
	'workspace_read',
	'workspace_write',
	'workspace_edit',
	'workspace_git_status',
	'workspace_git_commit',
	'workspace_git_push',
	'create_github_pull_request',
	'create_github_issue',
]);
assert.deepEqual(workspaceIterationRequirements, ['agents/run-runtime-package', 'wp-codebox/runner-workspace-command', 'wp-codebox/runner-workspace-publish']);
assert.deepEqual(codeboxRuntimeToolProfileInputs('workspace-publication'), {
	ability_requirements: '["agents/run-runtime-package","wp-codebox/runner-workspace-publish"]',
	ability_tools: '[]',
});
assert.deepEqual(codeboxRuntimeWorkflowInputs('workspace-iteration'), {
	runtime_provider: 'wp-codebox',
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(codeboxRuntimePackageProfiles()),
	ability_requirements: workspaceIterationInputs.ability_requirements,
	ability_tools: workspaceIterationInputs.ability_tools,
});
assert.throws(() => codeboxRuntimeToolProfileInputs('missing-profile'), /Unknown WPSG Codebox runtime tool profile/);

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
assert.equal(await readJsonOrNull(path.join(tempDir, 'missing.json')), null);
assert.deepEqual(await readJsonOrNull(recoveredPath), {
	importReadiness: {
		import_result: {
			report_path: '/wordpress/wp-content/themes/example/import-report.json',
			quality: { fallback_count: 1, core_html_block_count: 2, freeform_block_count: 3, invalid_block_count: 4, diagnostic_count: 10 },
			import_report_summary: { status: 'completed' },
		},
	},
});
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
