import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from '../../bundles/php-transformer-iterator-agent/scripts/lib/agent-ai-workflow.mjs';
import {
	buildRuntimePreviewUrl,
	envOrArg,
	homeboyRuntimeProviderProfile,
	numberValue,
	parseArgs,
	readAgentRuntimeContract,
	readJsonOrNull,
	repoPathResolver,
	renderRuntimeWorkflowInputs,
	resolveVisualParityOutputRoot,
	runtimeApiAbilities,
	runtimeBundleExecution,
	runtimePackageAbility,
	runtimePackageProfile,
	runtimePackageProfiles,
	runtimeProviderInvocationContract,
	runtimeValidationArtifactEnvelopeSchema,
	runtimeWorkspaceCommandAbility,
	runtimeWorkspacePublishAbility,
	runtimeWorkspaceRecipeSchema,
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
const genericRuntimeEnv = {
	HOMEBOY_AGENT_RUNTIME_TASK_ABILITY: 'runtime-package/run',
};
const codeboxContractFixture = JSON.parse(await readFile(path.join(repoRoot, 'tests/fixtures/codebox-provider-runtime-contract.json'), 'utf8'));
const codeboxProvider = codeboxContractFixture.schema.split('/')[0];
const codeboxFixtureEnv = {
	HOMEBOY_AGENT_RUNTIME_PROVIDER_INVOCATION_CONTRACT: JSON.stringify(codeboxContractFixture),
	HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON: JSON.stringify({ id: codeboxProvider, provider: codeboxProvider }),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA: `${codeboxProvider}/workspace-recipe/v1`,
	HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA: codeboxContractFixture.result_schemas.evidence_artifact_envelope.replace('evidence', 'validation'),
};
const runtimePackageAbilityId = runtimePackageAbility(genericRuntimeEnv);
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
assert.equal(runtimeValidationArtifactEnvelopeSchema(codeboxFixtureEnv), codeboxFixtureEnv.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA, 'validation artifact schema is consumed from the runtime contract');
assert.deepEqual(runtimeProviderInvocationContract(codeboxFixtureEnv), codeboxContractFixture, 'provider runtime invocation contract matches the upstream fixture');
assert.equal(runtimeWorkspaceCommandAbility(codeboxFixtureEnv), codeboxContractFixture.abilities.workspaceCommand, 'workspace command ability is read from the provider runtime contract');
assert.equal(runtimeWorkspacePublishAbility(codeboxFixtureEnv), codeboxContractFixture.abilities.workspacePublish, 'workspace publish ability is read from the provider runtime contract');
assert.deepEqual(homeboyRuntimeProviderProfile(codeboxFixtureEnv), {
	id: codeboxProvider,
	provider: codeboxProvider,
	workspaceCommandAbility: codeboxContractFixture.abilities.workspaceCommand,
	workspacePublishAbility: codeboxContractFixture.abilities.workspacePublish,
}, 'provider profile vocabulary is supplied by the runtime contract');
assert.equal(wordpressRuntimeBlueprintSchema(), 'https://playground.wordpress.net/blueprint-schema.json');
assert.equal(wordpressRuntimeSettingsDescriptor().settings_fields.blueprint, 'wordpress_runtime_blueprint');
assert.deepEqual(wordpressRuntimeSettingsFields(), { blueprint: 'wordpress_runtime_blueprint', workloads: 'wordpress_runtime_workloads' });
assert.deepEqual(wordpressRuntimePhpStep('do_work();'), { type: 'php', code: 'do_work();' });
assert.deepEqual(wordpressRuntimePhpFileStep('script.php'), { type: 'php', file: 'script.php' });
assert.equal(wordpressRuntimeRequireWpLoadPhp(), "require_once '/wordpress/wp-load.php';");
assert.equal(wordpressRuntimeAbilityId('importWebsiteArtifact'), 'static-site-importer/import-website-artifact');
assert.throws(() => wordpressRuntimeAbilityId('missing'), /Unknown WordPress runtime ability/);
assert.equal(runtimePackageProfile.id, 'wpsg-agent-runtime-package', 'consumer-facing runtime package profile is generic');
assert.equal(runtimeApiAbilities.runRuntimePackage, '', 'runtime package ability is supplied by the upstream runtime contract');
assert.equal(runtimePackageProfile.runtimeTaskAbility, '', 'runtime package profile does not hard-code an execution ability');
assert.equal(runtimePackageAbilityId, genericRuntimeEnv.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY, 'runtime package ability is read from the runtime env contract');
assert.equal(resolveVisualParityOutputRoot({}), 'visual-parity-artifacts');
assert.equal(resolveVisualParityOutputRoot({ VISUAL_PARITY_OUTPUT: 'custom-artifacts' }), 'custom-artifacts');
assert.equal(runtimeWorkspaceRecipeSchema(codeboxFixtureEnv), codeboxFixtureEnv.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA);
assert.equal(buildRuntimePreviewUrl({ evidenceRefs: [{ preview_url: 'https://example.com/preview' }] }), 'https://example.com/preview');
assert.equal(buildRuntimePreviewUrl({ evidenceRefs: { preview_url: 'https://example.com/single-preview' } }), 'https://example.com/single-preview');
assert.equal(buildRuntimePreviewUrl({ env: { HOMEBOY_RUNTIME_PREVIEW_URL: 'https://example.com/runtime-preview' } }), 'https://example.com/runtime-preview');
assert.throws(() => buildRuntimePreviewUrl({ blueprint: { steps: [] } }), /preview evidence refs|preview_url_base|runtime preview URLs/);
const defaultRuntimeContract = readAgentRuntimeContract(genericRuntimeEnv);
assert.equal(runtimeWorkspaceRecipeSchema(defaultRuntimeContract), 'homeboy/runtime-workspace-recipe/v1', 'runtime workspace recipe schema defaults to the generic Homeboy contract');
assert.equal(runtimeValidationArtifactEnvelopeSchema(defaultRuntimeContract), 'homeboy/validation-artifact-envelope/v1', 'validation artifact envelope schema defaults to the generic Homeboy contract');
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
	...genericRuntimeEnv,
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: runtimeWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: runtimeWorkspacePublishAbility(codeboxFixtureEnv),
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
assert.deepEqual(workspaceIterationRequirements, [runtimePackageAbilityId, runtimeWorkspaceCommandAbility(codeboxFixtureEnv), runtimeWorkspacePublishAbility(codeboxFixtureEnv)]);
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', readAgentRuntimeContract({ ...genericRuntimeEnv, HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: runtimeWorkspacePublishAbility(codeboxFixtureEnv) })), {
	ability_requirements: JSON.stringify([runtimePackageAbilityId, runtimeWorkspacePublishAbility(codeboxFixtureEnv)]),
	ability_tools: '[]',
});
assert.deepEqual(runtimeWorkflowInputs('workspace-iteration', readAgentRuntimeContract({
	...genericRuntimeEnv,
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: runtimeWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: runtimeWorkspacePublishAbility(codeboxFixtureEnv),
})), {
	runtime_provider: codeboxProvider,
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(readAgentRuntimeContract({ ...genericRuntimeEnv, HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider }))),
	ability_requirements: workspaceIterationInputs.ability_requirements,
	ability_tools: workspaceIterationInputs.ability_tools,
});
const renderedWorkspaceWorkflowInputs = renderRuntimeWorkflowInputs({
	runtime_provider: codeboxProvider,
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: runtimePackageProfiles(readAgentRuntimeContract({ ...genericRuntimeEnv, HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider })),
	tool_profile: runtimeToolProfiles.workspaceIteration,
}, {});
assert.equal(renderedWorkspaceWorkflowInputs.schema, 'homeboy/runtime-workflow-inputs/v1');
assert.equal(renderedWorkspaceWorkflowInputs.workflow_inputs.runtime, codeboxProvider);
assert.equal(renderedWorkspaceWorkflowInputs.workflow_inputs.profile, 'wpsg-agent-runtime-package');
assert.deepEqual(renderedWorkspaceWorkflowInputs.workflow_inputs.runtime_profiles, runtimePackageProfiles(readAgentRuntimeContract({ ...genericRuntimeEnv, HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider })));
assert.deepEqual(renderedWorkspaceWorkflowInputs.tool_profile.tools.map(([name]) => name), runtimeToolProfiles.workspaceIteration.tools.map(([name]) => name));
assert.deepEqual(runtimeWorkflowInputs('workspace-publication', readAgentRuntimeContract({
	...genericRuntimeEnv,
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: runtimeWorkspacePublishAbility(codeboxFixtureEnv),
})), {
	runtime_provider: codeboxProvider,
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(readAgentRuntimeContract({ ...genericRuntimeEnv, HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider }))),
	ability_requirements: JSON.stringify([runtimePackageAbilityId, runtimeWorkspacePublishAbility(codeboxFixtureEnv)]),
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
	ability: runtimePackageAbilityId,
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
	...genericRuntimeEnv,
	HOMEBOY_AGENT_RUNTIME_PROVIDER: codeboxProvider,
	HOMEBOY_AGENT_RUNTIME_BACKEND: 'codebox',
	HOMEBOY_AGENT_RUNTIME_PROVIDER_ID: 'openai',
	HOMEBOY_AGENT_RUNTIME_SELECTOR: 'sandbox',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: runtimeWorkspaceCommandAbility(codeboxFixtureEnv),
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: runtimeWorkspacePublishAbility(codeboxFixtureEnv),
});
assert.deepEqual(runtimePackageProfiles(configuredRuntimeContract)['wpsg-agent-runtime-package'].runtime_selection, {
	backend: 'codebox',
	provider_id: 'openai',
	selector: 'sandbox',
}, 'runtime backend/provider/selector are config inputs, not WPSG constants');
assert.deepEqual(runtimeToolProfileInputs('workspace-publication', configuredRuntimeContract), {
	ability_requirements: JSON.stringify([runtimePackageAbilityId, runtimeWorkspacePublishAbility(codeboxFixtureEnv)]),
	ability_tools: '[]',
}, 'provider-compatible abilities can still be supplied externally');

const runtimeProfileManifest = {
	profiles: [
		{
			id: 'example-runtime-package',
			provider: 'example-runtime',
			runtime_task_ability: 'example-runtime/run-package',
			workspace_command_ability: runtimeWorkspaceCommandAbility(codeboxFixtureEnv),
			workspace_publish_ability: runtimeWorkspacePublishAbility(codeboxFixtureEnv),
			workspace_recipe_schema: 'example-runtime/workspace-recipe/v1',
			validation_artifact_envelope_schema: 'example-runtime/validation-artifact-envelope/v1',
			preview_url_base: 'https://preview.example.com/',
		},
	],
};
const manifestRuntimeContract = readAgentRuntimeContract({ HOMEBOY_AGENT_RUNTIME_MANIFEST: JSON.stringify(runtimeProfileManifest) });
assert.equal(runtimePackageAbility(manifestRuntimeContract), 'example-runtime/run-package', 'runtime package ability can be supplied by a Homeboy runtime manifest');
assert.equal(runtimeWorkspaceRecipeSchema(manifestRuntimeContract), 'example-runtime/workspace-recipe/v1', 'runtime recipe schemas come from the runtime manifest');
assert.equal(runtimeValidationArtifactEnvelopeSchema(manifestRuntimeContract), 'example-runtime/validation-artifact-envelope/v1', 'runtime validation schemas come from the runtime manifest');
assert.equal(buildRuntimePreviewUrl({ blueprint: { steps: [{ step: 'login' }] } }, manifestRuntimeContract), 'https://preview.example.com/#%7B%22steps%22%3A%5B%7B%22step%22%3A%22login%22%7D%5D%7D', 'preview URL shape is supplied by the runtime contract');

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
const hbeRendererPath = path.join(tempDir, 'runtime-workflow-inputs.cjs');
await writeFile(hbeRendererPath, `
'use strict';
exports.renderRuntimeWorkflowInputs = (options) => ({
  schema: 'homeboy/runtime-workflow-inputs/v1',
  runtime_id: 'hbe-runtime',
  runtime_profile: options.runtime_profile,
  runtime_profiles: options.runtime_profiles,
  runtime_requirements: options.runtime_profiles[options.runtime_profile],
  workflow_inputs: {
    runtime: 'hbe-runtime',
    profile: options.runtime_profile,
    runtime_profiles: options.runtime_profiles,
  },
});
`);
assert.deepEqual(runtimeWorkflowInputs('workspace-publication', readAgentRuntimeContract(genericRuntimeEnv), { HOMEBOY_EXTENSIONS_RUNTIME_WORKFLOW_INPUTS: hbeRendererPath }), {
	runtime_provider: 'hbe-runtime',
	runtime_profile: 'wpsg-agent-runtime-package',
	runtime_profiles: JSON.stringify(runtimePackageProfiles(defaultRuntimeContract)),
	ability_requirements: JSON.stringify([runtimePackageAbilityId]),
	ability_tools: '[]',
}, 'WPSG delegates Homeboy runtime workflow input rendering while keeping domain ability inputs local');
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
