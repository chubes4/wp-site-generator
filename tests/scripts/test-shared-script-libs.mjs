import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from '../../bundles/php-transformer-iterator-agent/scripts/lib/agent-ai-workflow.mjs';
import {
	codeboxProviderRuntimeInvocationContract,
	codeboxRuntimeProviderProfile,
	codeboxRuntimeWorkspaceRecipeSchema,
	codeboxRunnerWorkspaceCommandAbility,
	codeboxRunnerWorkspacePublishAbility,
	codeboxValidationArtifactEnvelopeSchema,
	codeboxWorkspaceRecipeSchema,
	buildRuntimePreviewUrl,
	envOrArg,
	numberValue,
	parseArgs,
	readAgentRuntimeContract,
	readJsonOrNull,
	repoPathResolver,
	resolveVisualParityOutputRoot,
	runtimeApiAbilities,
	runtimeBundleExecution,
	runtimePackageAbility,
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
	wordpressRuntimePluginMountTarget,
	wordpressRuntimePhpFileStep,
	wordpressRuntimePhpStep,
	wordpressRuntimeRequireWpLoadPhp,
	wordpressRuntimeSettingsDescriptor,
	wordpressRuntimeSettingsFields,
} from '../../.github/scripts/lib/ci-runtime-utils.mjs';
import { loadRecoveredSsiImportSummary, recoveredSsiScenarioFromImportSummary } from '../../.github/scripts/lib/ssi-import-summary.mjs';
import { ssiPrBodyMetrics, validationMetricValue } from '../../.github/scripts/lib/ssi-metrics.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const args = parseArgs(['--repo', 'owner/repo', '--dry-run']);
const codeboxContractFixture = JSON.parse(await readFile(path.join(repoRoot, 'tests/fixtures/codebox-provider-runtime-contract.json'), 'utf8'));
const codeboxProvider = codeboxContractFixture.schema.split('/')[0];
const codeboxFixtureEnv = {
	HOMEBOY_AGENT_RUNTIME_PROVIDER_INVOCATION_CONTRACT: JSON.stringify(codeboxContractFixture),
	HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON: JSON.stringify({ id: codeboxProvider, provider: codeboxProvider }),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA: `${codeboxProvider}/workspace-recipe/v1`,
	HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA: codeboxContractFixture.result_schemas.evidence_artifact_envelope.replace('evidence', 'validation'),
};
const runtimePackageAbilityId = runtimePackageAbility();
assert.equal(envOrArg(args, '--repo', { SOURCE_REPO: 'env/repo' }, 'SOURCE_REPO'), 'owner/repo');
assert.equal(envOrArg(new Map(), '--repo', { SOURCE_REPO: 'env/repo' }, 'SOURCE_REPO'), 'env/repo');
assert.equal(envOrArg(new Map(), '--ref', {}, 'REF', 'main'), 'main');
assert.equal(args.get('--dry-run'), '1');
assert.equal(repoPathResolver('/tmp/repo')('.ci', 'artifact.json'), path.join('/tmp/repo', '.ci', 'artifact.json'));
assert.equal(textValue(' ok '), 'ok');
assert.equal(numberValue('4'), 4);
assert.equal(numberValue('bad', 9), 9);
assert.equal(wordpressRuntimeApi.paths.wpLoadPhp, '/wordpress/wp-load.php', 'WordPress runtime path constants are centralized');
assert.equal(wordpressRuntimePluginMountTarget(), '/wordpress/wp-content/plugins/wp-site-generator', 'WordPress plugin mount target is centralized');
assert.equal(codeboxValidationArtifactEnvelopeSchema(codeboxFixtureEnv), codeboxFixtureEnv.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA, 'validation artifact schema is consumed from the runtime contract');
assert.deepEqual(codeboxProviderRuntimeInvocationContract(codeboxFixtureEnv), codeboxContractFixture, 'Codebox provider runtime invocation contract matches the upstream fixture');
assert.equal(codeboxRunnerWorkspaceCommandAbility(codeboxFixtureEnv), codeboxContractFixture.abilities.workspaceCommand, 'Codebox workspace command ability is read from the provider runtime contract');
assert.equal(codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv), codeboxContractFixture.abilities.workspacePublish, 'Codebox workspace publish ability is read from the provider runtime contract');
assert.deepEqual(codeboxRuntimeProviderProfile(codeboxFixtureEnv), {
	id: codeboxProvider,
	provider: codeboxProvider,
	workspaceCommandAbility: codeboxContractFixture.abilities.workspaceCommand,
	workspacePublishAbility: codeboxContractFixture.abilities.workspacePublish,
}, 'Codebox provider profile vocabulary is supplied by the runtime contract');
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
assert.equal(runtimePackageAbilityId, runtimeApiAbilities.runRuntimePackage, 'runtime package ability is centralized behind the runtime facade');
assert.equal(resolveVisualParityOutputRoot({}), 'visual-parity-artifacts');
assert.equal(resolveVisualParityOutputRoot({ VISUAL_PARITY_OUTPUT: 'custom-artifacts' }), 'custom-artifacts');
assert.equal(codeboxRuntimeWorkspaceRecipeSchema(codeboxFixtureEnv), codeboxFixtureEnv.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA);
assert.equal(codeboxWorkspaceRecipeSchema(codeboxFixtureEnv), codeboxFixtureEnv.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA);
assert.equal(buildRuntimePreviewUrl({ evidenceRefs: [{ preview_url: 'https://example.com/preview' }] }), 'https://example.com/preview');
assert.equal(buildRuntimePreviewUrl({ evidenceRefs: { preview_url: 'https://example.com/single-preview' } }), 'https://example.com/single-preview');
assert.equal(buildRuntimePreviewUrl({ env: { HOMEBOY_RUNTIME_PREVIEW_URL: 'https://example.com/runtime-preview' } }), 'https://example.com/runtime-preview');
assert.throws(() => buildRuntimePreviewUrl({ blueprint: { steps: [] } }), /preview evidence refs/);
const defaultRuntimeContract = readAgentRuntimeContract({});
assert.equal(defaultRuntimeContract.provider, '', 'WPSG does not select a runtime provider by default');
assert.deepEqual(runtimePackageProfiles(defaultRuntimeContract), {
	'wpsg-agent-runtime-package': {
		schema: 'homeboy/runtime-profile/v1',
		id: 'wpsg-agent-runtime-package',
		runtime_task_ability: runtimePackageAbilityId,
		runtime_bundle_ability: runtimePackageAbilityId,
		runtime_workflow_ability: runtimePackageAbilityId,
		ability_requirements: [runtimePackageAbilityId],
	},
}, 'runtime package profiles derive from the generic runtime package API');
const workspaceIterationInputs = runtimeToolProfileInputs('workspace-iteration', readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: codeboxRunnerWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv),
}));
const workspaceIterationTools = JSON.parse(workspaceIterationInputs.ability_tools);
const workspaceIterationRequirements = JSON.parse(workspaceIterationInputs.ability_requirements);
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
assert.deepEqual(workspaceIterationRequirements, [runtimePackageAbilityId, codeboxRunnerWorkspaceCommandAbility(codeboxFixtureEnv), codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv)]);
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', readAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv) })), {
	ability_requirements: JSON.stringify([runtimePackageAbilityId, codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv)]),
	ability_tools: '[]',
});
assert.deepEqual(runtimeWorkflowInputs('workspace-iteration', readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: codeboxRunnerWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv),
})), {
	runtime_provider: codeboxProvider,
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(readAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider }))),
	ability_requirements: workspaceIterationInputs.ability_requirements,
	ability_tools: workspaceIterationInputs.ability_tools,
});
assert.deepEqual(runtimeWorkflowInputs('workspace-publication', readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv),
})), {
	runtime_provider: codeboxProvider,
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(readAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider }))),
	ability_requirements: JSON.stringify([runtimePackageAbilityId, codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv)]),
	ability_tools: '[]',
}, 'publication workload profile can consume externally supplied publish wrappers');
assert.deepEqual(runtimeToolProfiles.workspacePublication.tools, []);
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', defaultRuntimeContract), {
	ability_requirements: JSON.stringify([runtimePackageAbilityId]),
	ability_tools: '[]',
});
assert.deepEqual(runtimeWorkflowInputs('workspace-iteration', defaultRuntimeContract), {
	runtime_provider: '',
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(defaultRuntimeContract)),
	ability_requirements: JSON.stringify([runtimePackageAbilityId]),
	ability_tools: '[]',
});
assert.throws(() => runtimeToolProfileInputs('missing-profile'), /Unknown WPSG runtime tool profile/);
assert.deepEqual(runtimeBundleExecution({
	packageSource: 'bundles/example-agent',
	packageSlug: 'example-agent',
	workflowId: 'example-flow',
	input: { wait_for_completion: true },
}), {
	runtime_execution: {
		kind: 'bundle',
		ability: runtimePackageAbilityId,
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
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_BACKEND: 'codebox',
	HOMEBOY_AGENT_RUNTIME_PROVIDER_ID: 'openai',
	HOMEBOY_AGENT_RUNTIME_SELECTOR: 'sandbox',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: codeboxRunnerWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv),
});
assert.deepEqual(runtimePackageProfiles(configuredRuntimeContract)['wpsg-agent-runtime-package'].runtime_selection, {
	backend: 'codebox',
	provider_id: 'openai',
	selector: 'sandbox',
}, 'runtime backend/provider/selector are config inputs, not WPSG constants');
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', configuredRuntimeContract), {
	ability_requirements: JSON.stringify([runtimePackageAbilityId, codeboxRunnerWorkspacePublishAbility(codeboxFixtureEnv)]),
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
