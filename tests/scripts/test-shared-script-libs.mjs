import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from '../../bundles/php-transformer-iterator-agent/scripts/lib/agent-ai-workflow.mjs';
import {
	buildCodeboxPlaygroundPreviewUrl,
	codeboxAgentRuntimeContract,
	codeboxPluginMountTarget,
	codeboxRuntimeApi,
	codeboxRuntimePackageAbility,
	codeboxRuntimePackageProfiles,
	codeboxRuntimeProvider,
	codeboxRuntimeToolProfileInputs,
	codeboxRuntimeWorkflowInputs,
	codeboxWorkspaceRecipeSchema,
	envOrArg,
	numberValue,
	parseArgs,
	readAgentRuntimeContract,
	readJsonOrNull,
	repoPathResolver,
	resolveCodeboxCliPath,
	resolveCodeboxVisualParityOutputRoot,
	resolveVisualParityOutputRoot,
	resolveWpCodeboxCliPath,
	runtimeApiAbilities,
	runtimeBundleExecution,
	runtimePackageProfile,
	runtimePackageProfiles,
	runtimeToolProfileInputs,
	runtimeToolProfiles,
	runtimeWorkflowBuilderExecution,
	runtimeWorkflowInputs,
	textValue,
	wordpressRuntimeAbilityId,
	wordpressRuntimeApi,
	wordpressRuntimeBlueprintSchema,
	wordpressRuntimePhpFileStep,
	wordpressRuntimePhpStep,
	wordpressRuntimeRequireWpLoadPhp,
	wordpressRuntimeSettingsDescriptor,
	wordpressRuntimeSettingsFields,
	wpSiteGeneratorPluginMountTarget,
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
assert.equal(codeboxRuntimeApi.runtimeSchemas.workspaceRecipe, 'wp-codebox/workspace-recipe/v1', 'runtime recipe schema is centralized');
assert.equal(wordpressRuntimeApi.paths.wpLoadPhp, '/wordpress/wp-load.php', 'WordPress runtime path constants are centralized');
assert.equal(wordpressRuntimeBlueprintSchema(), 'https://playground.wordpress.net/blueprint-schema.json');
assert.equal(wordpressRuntimeSettingsDescriptor().settings_fields.blueprint, 'wordpress_runtime_blueprint');
assert.deepEqual(wordpressRuntimeSettingsFields(), { blueprint: 'wordpress_runtime_blueprint', workloads: 'wordpress_runtime_workloads' });
assert.deepEqual(wordpressRuntimePhpStep('do_work();'), { type: 'php', code: 'do_work();' });
assert.deepEqual(wordpressRuntimePhpFileStep('script.php'), { type: 'php', file: 'script.php' });
assert.equal(wordpressRuntimeRequireWpLoadPhp(), "require_once '/wordpress/wp-load.php';");
assert.equal(wordpressRuntimeAbilityId('importWebsiteArtifact'), 'static-site-importer/import-website-artifact');
assert.throws(() => wordpressRuntimeAbilityId('missing'), /Unknown WordPress runtime ability/);
assert.equal(runtimePackageProfile.id, 'wpsg-agent-runtime-package', 'consumer-facing runtime package profile is generic');
assert.equal(runtimePackageProfile.runtimeTaskAbility, runtimeApiAbilities.runRuntimePackage, 'runtime package profile uses the generic runtime package ability');
assert.equal(resolveCodeboxCliPath('/tmp/repo', {}), path.join('/tmp/repo', '.ci/wp-codebox/packages/cli/dist/index.js'));
assert.equal(resolveCodeboxCliPath('/tmp/repo', { WP_CODEBOX_CLI: '/custom/codebox.js' }), '/custom/codebox.js');
assert.equal(resolveWpCodeboxCliPath('/tmp/repo', {}), path.join('/tmp/repo', '.ci/wp-codebox/packages/cli/dist/index.js'));
assert.equal(resolveWpCodeboxCliPath('/tmp/repo', { WP_CODEBOX_CLI: '/custom/codebox.js' }), '/custom/codebox.js');
assert.equal(resolveCodeboxVisualParityOutputRoot({}), 'visual-parity-artifacts');
assert.equal(resolveCodeboxVisualParityOutputRoot({ VISUAL_PARITY_OUTPUT: 'custom-artifacts' }), 'custom-artifacts');
assert.equal(resolveVisualParityOutputRoot({}), 'visual-parity-artifacts');
assert.equal(resolveVisualParityOutputRoot({ VISUAL_PARITY_OUTPUT: 'custom-artifacts' }), 'custom-artifacts');
assert.equal(codeboxPluginMountTarget(), '/wordpress/wp-content/plugins/wp-site-generator');
assert.equal(wpSiteGeneratorPluginMountTarget(), '/wordpress/wp-content/plugins/wp-site-generator');
assert.equal(codeboxWorkspaceRecipeSchema(), 'wp-codebox/workspace-recipe/v1');
assert.equal(buildCodeboxPlaygroundPreviewUrl({ steps: [{ step: 'login' }] }), 'https://playground.wordpress.net/#%7B%22steps%22%3A%5B%7B%22step%22%3A%22login%22%7D%5D%7D');
assert.deepEqual(codeboxAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_BACKEND: 'codebox', HOMEBOY_AGENT_RUNTIME_SELECTOR: 'sandbox' }), {
	provider: 'wp-codebox',
	profile: 'wpsg-agent-runtime-package',
	profiles: '',
	backend: 'codebox',
	providerId: '',
	selector: 'sandbox',
	runtimeTaskAbility: 'agents/run-runtime-package',
	runtimeBundleAbility: 'agents/run-runtime-package',
	runtimeWorkflowAbility: 'agents/run-runtime-package',
	workspaceCommandAbility: 'wp-codebox/runner-workspace-command',
	workspacePublishAbility: 'wp-codebox/runner-workspace-publish',
}, 'Codebox runtime contract applies canonical provider and workspace wrapper defaults while preserving selection hints');
const defaultRuntimeContract = readAgentRuntimeContract({});
assert.equal(defaultRuntimeContract.provider, '', 'WPSG does not select a runtime provider by default');
assert.deepEqual(runtimePackageProfiles(defaultRuntimeContract), {
	'wpsg-agent-runtime-package': {
		schema: 'homeboy/runtime-profile/v1',
		id: 'wpsg-agent-runtime-package',
		runtime_task_ability: 'agents/run-runtime-package',
		runtime_bundle_ability: 'agents/run-runtime-package',
		runtime_workflow_ability: 'agents/run-runtime-package',
		ability_requirements: ['agents/run-runtime-package'],
	},
}, 'runtime package profiles derive from the generic runtime package API');
const workspaceIterationInputs = codeboxRuntimeToolProfileInputs('workspace-iteration');
const workspaceIterationTools = JSON.parse(workspaceIterationInputs.ability_tools);
const workspaceIterationRequirements = JSON.parse(workspaceIterationInputs.ability_requirements);
assert.equal(codeboxRuntimeProvider(), 'wp-codebox', 'WP Codebox compatibility helper selects the WP Codebox provider');
assert.equal(codeboxRuntimePackageAbility(), 'agents/run-runtime-package', 'Codebox runtime exposes the generic runtime package ability through a named helper');
assert.deepEqual(codeboxRuntimePackageProfiles(), runtimePackageProfiles(readAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_PROVIDER: 'wp-codebox' })));
assert.equal(runtimeToolProfiles.workspaceIteration.id, 'workspace-iteration');
assert.deepEqual(runtimeToolProfiles.workspaceIteration.tools.map(([name]) => name), [
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
assert.deepEqual(workspaceIterationTools.map((tool) => tool.name), runtimeToolProfiles.workspaceIteration.tools.map(([name]) => name));
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
assert.deepEqual(codeboxRuntimeWorkflowInputs('workspace-publication'), {
	runtime_provider: 'wp-codebox',
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(codeboxRuntimePackageProfiles()),
	ability_requirements: '["agents/run-runtime-package","wp-codebox/runner-workspace-publish"]',
	ability_tools: '[]',
}, 'Codebox publication workload profile exposes only the canonical publish wrapper');
assert.deepEqual(runtimeToolProfiles.workspacePublication.tools, []);
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', defaultRuntimeContract), {
	ability_requirements: '["agents/run-runtime-package"]',
	ability_tools: '[]',
});
assert.deepEqual(runtimeWorkflowInputs('workspace-iteration', defaultRuntimeContract), {
	runtime_provider: '',
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(defaultRuntimeContract)),
	ability_requirements: '["agents/run-runtime-package"]',
	ability_tools: '[]',
});
assert.throws(() => codeboxRuntimeToolProfileInputs('missing-profile'), /Unknown WPSG runtime tool profile/);
assert.deepEqual(runtimeBundleExecution({
	packageSource: 'bundles/example-agent',
	packageSlug: 'example-agent',
	workflowId: 'example-flow',
	input: { wait_for_completion: true },
}), {
	runtime_execution: {
		kind: 'bundle',
		ability: 'agents/run-runtime-package',
		input: {
			package: { source: 'bundles/example-agent', slug: 'example-agent' },
			workflow: { id: 'example-flow' },
			input: { wait_for_completion: true },
		},
	},
});
assert.throws(() => runtimeBundleExecution({ packageSource: 'bundles/example-agent' }), /packageSource, packageSlug, and workflowId/);
assert.deepEqual(runtimeWorkflowBuilderExecution({
	kind: 'wpsg-example',
	workflowBuilder: 'bundles/example-agent/scripts/build-workflow.mjs',
	artifacts_dir: '.ci/artifacts',
}), {
	runtime_execution: {
		kind: 'wpsg-example',
		workflow_builder: 'bundles/example-agent/scripts/build-workflow.mjs',
		artifacts_dir: '.ci/artifacts',
	},
});
assert.throws(() => runtimeWorkflowBuilderExecution({ kind: 'wpsg-example' }), /kind and workflowBuilder/);

const configuredRuntimeContract = readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_PROVIDER: 'wp-codebox',
	HOMEBOY_AGENT_RUNTIME_BACKEND: 'codebox',
	HOMEBOY_AGENT_RUNTIME_PROVIDER_ID: 'openai',
	HOMEBOY_AGENT_RUNTIME_SELECTOR: 'sandbox',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: 'wp-codebox/runner-workspace-command',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: 'wp-codebox/runner-workspace-publish',
});
assert.deepEqual(runtimePackageProfiles(configuredRuntimeContract)['wpsg-agent-runtime-package'].runtime_selection, {
	backend: 'codebox',
	provider_id: 'openai',
	selector: 'sandbox',
}, 'runtime backend/provider/selector are config inputs, not WPSG constants');
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', configuredRuntimeContract), {
	ability_requirements: '["agents/run-runtime-package","wp-codebox/runner-workspace-publish"]',
	ability_tools: '[]',
}, 'Codebox-compatible abilities can still be supplied externally');

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
