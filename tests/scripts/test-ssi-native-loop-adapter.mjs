import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-ssi-native-loop-'));
const settingsPath = path.join(tempDir, 'settings.json');
const workflowPath = path.join(tempDir, 'workflow.json');
const planPath = path.join(tempDir, 'iterator-plan.json');
const dispatchPath = path.join(tempDir, 'dispatch.json');
const controllerPath = path.join(tempDir, 'controller.json');

const controllerResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-ssi-loop-controller.mjs', '--output', controllerPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(controllerResult.status, 0, controllerResult.stderr || controllerResult.stdout);

const controller = JSON.parse(await readFile(controllerPath, 'utf8'));
assert.equal(controller.schema, 'homeboy/controller-spec/v1', 'native controller builder emits a Homeboy controller spec');
assert.ok(controller.phases.some((phase) => phase.id === 'iterator_subloops'), 'controller includes iterator subloop phase');
assert.ok(controller.phases.some((phase) => phase.id === 'revalidation'), 'controller includes revalidation phase');

const settingsResult = spawnSync(process.execPath, ['.github/scripts/build-static-validation-settings.mjs', '--site', 'issue-123-native-loop', '--output', settingsPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(settingsResult.status, 0, settingsResult.stderr || settingsResult.stdout);

const settingsPayload = JSON.parse(await readFile(settingsPath, 'utf8'));
assert.equal(settingsPayload.workloads[0].id, 'ssi-import', 'native validation adapter emits SSI bench workload');
assert.match(settingsPayload.workloads[0].run[0].command, /static-site-importer import-theme/, 'workload runs SSI import command');
assert.deepEqual(
	settingsPayload.settings.wp_codebox_blueprint.steps.map((step) => step.options.targetFolderName).slice(0, 4),
	['woocommerce', 'block-artifact-compiler', 'block-format-bridge', 'static-site-importer'],
	'validation settings preserve dependency install order',
);

const groupResult = spawnSync(process.execPath, ['.github/scripts/group-ssi-finding-packets.mjs', 'tests/fixtures/ssi-finding-packets.json'], {
	cwd: repoRoot,
	encoding: 'utf8',
	env: { ...process.env, FINDING_GROUPS_PATH: path.join(tempDir, 'groups.json') },
});
assert.equal(groupResult.status, 0, groupResult.stderr || groupResult.stdout);

const workflowResult = spawnSync(process.execPath, ['.github/scripts/build-datamachine-iterator-workflow.mjs', path.join(tempDir, 'groups.json'), workflowPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(workflowResult.status, 0, workflowResult.stderr || workflowResult.stdout);

const planResult = spawnSync(
	process.execPath,
	['.github/scripts/build-homeboy-php-transformer-iterator-plan.mjs', '--workflow', workflowPath, '--output', planPath],
	{
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_RUN_ID: '515',
			SOURCE_REPO: 'chubes4/wp-site-generator',
			SOURCE_PR: '456',
			SOURCE_HEAD_SHA: 'abc1234',
			VALIDATION_RUN_ID: '9999',
		},
	},
);
assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);

const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.equal(plan.schema, 'homeboy/agent-task-plan/v1', 'native iterator adapter emits a Homeboy plan');
assert.equal(plan.tasks[0].executor.config.runtime_task.ability, 'datamachine/run-agent-bundle', 'iterator runs through a WP Codebox runtime task');
assert.equal(plan.tasks[0].executor.config.wp_codebox_bin, undefined, 'iterator plan defers WP Codebox binary selection to the runner by default');
assert.equal(plan.tasks[0].executor.model, undefined, 'iterator plan defers executor model selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.provider, undefined, 'iterator plan defers provider selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.model, undefined, 'iterator plan defers config model selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.provider_plugin_paths, undefined, 'iterator plan defers provider plugin selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.secret_env, undefined, 'iterator plan defers provider secret env selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.runtime_task.input.execute_workflow_path, workflowPath, 'iterator consumes prebuilt grouped finding workflow');
assert.equal(plan.tasks[0].executor.config.runtime_component_paths.agents_api, '.ci/agents-api', 'iterator uses a repo-relative Agents API component path');
assert.equal(plan.tasks[0].executor.config.runtime_component_paths.agent_runtime, '.ci/data-machine', 'iterator uses a repo-relative Data Machine component path');
assert.equal(plan.tasks[0].executor.config.runtime_component_paths.agent_runtime_tools, '.ci/data-machine-code', 'iterator uses a repo-relative Data Machine Code component path');
assert.equal(plan.tasks[0].executor.config.homeboy_extensions, '.ci/homeboy-extensions/wordpress', 'iterator uses a repo-relative Homeboy Extensions component path');
assert.equal(plan.tasks[0].executor.config.agent_bundles[0].source, '/workspace/wp-site-generator/bundles/php-transformer-iterator-agent', 'iterator imports a sandbox-local bundle path');
assert.equal(plan.tasks[0].executor.config.runtime_task.input.source, '/workspace/wp-site-generator/bundles/php-transformer-iterator-agent', 'iterator runs a sandbox-local bundle path');
assert.equal(plan.tasks[0].executor.config.runtime_task.input.wait_for_completion, true, 'iterator waits for typed bundle outputs');
assert.match(plan.tasks[0].executor.config.runtime_task.input.artifacts, /^\.ci\/homeboy-agent-task-artifacts\//, 'iterator uses a repo-relative artifact directory');
assert.deepEqual(plan.tasks[0].executor.config.runtime_task.input.success_completion_outcomes, ['pull_request_path'], 'native iterator keeps PR-first completion gate');
assert.equal(plan.tasks[0].inputs.source_pr, '456', 'source PR metadata flows into native plan');

const explicitIteratorPlanPath = path.join(tempDir, 'iterator-plan-codebox.json');
const explicitIteratorResult = spawnSync(
	process.execPath,
	['.github/scripts/build-homeboy-php-transformer-iterator-plan.mjs', '--workflow', workflowPath, '--output', explicitIteratorPlanPath],
	{
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_RUN_ID: '516',
			HOMEBOY_WP_CODEBOX_BIN: '/runner/wp-codebox/packages/cli/dist/index.js',
		},
	},
);
assert.equal(explicitIteratorResult.status, 0, explicitIteratorResult.stderr || explicitIteratorResult.stdout);
const explicitIteratorPlan = JSON.parse(await readFile(explicitIteratorPlanPath, 'utf8'));
assert.equal(explicitIteratorPlan.tasks[0].executor.config.wp_codebox_bin, '/runner/wp-codebox/packages/cli/dist/index.js', 'iterator plan preserves explicit runner WP Codebox path');

const explicitProviderIteratorPlanPath = path.join(tempDir, 'iterator-plan-provider.json');
const explicitProviderIteratorResult = spawnSync(
	process.execPath,
	['.github/scripts/build-homeboy-php-transformer-iterator-plan.mjs', '--workflow', workflowPath, '--output', explicitProviderIteratorPlanPath],
	{
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_RUN_ID: '517',
			HOMEBOY_WP_CODEBOX_PROVIDER: 'opencode',
			HOMEBOY_WP_CODEBOX_MODEL: 'opencode-go/kimi-k2.6',
			HOMEBOY_WP_CODEBOX_PROVIDER_PLUGIN_PATHS: '/runner/ai-provider-for-opencode-current',
			HOMEBOY_WP_CODEBOX_SECRET_ENV: 'OPENCODE_API_KEY,GITHUB_TOKEN',
			HOMEBOY_WP_CODEBOX_RUNTIME_ENV: JSON.stringify({ XDG_CONFIG_HOME: '/runtime/config', XDG_STATE_HOME: '/runtime/state' }),
			HOMEBOY_WP_CODEBOX_RUNTIME_CONFIG_MOUNTS: JSON.stringify([{ source: '/runner/config', target: '/runtime/config', mode: 'readonly' }]),
			HOMEBOY_WP_CODEBOX_RUNTIME_STATE_MOUNTS: JSON.stringify([{ source: '/runner/state', target: '/runtime/state', mode: 'readonly' }]),
		},
	},
);
assert.equal(explicitProviderIteratorResult.status, 0, explicitProviderIteratorResult.stderr || explicitProviderIteratorResult.stdout);
const explicitProviderIteratorPlan = JSON.parse(await readFile(explicitProviderIteratorPlanPath, 'utf8'));
const explicitProviderIteratorConfig = explicitProviderIteratorPlan.tasks[0].executor.config;
assert.equal(explicitProviderIteratorConfig.provider, 'opencode', 'iterator preserves explicit provider override');
assert.equal(explicitProviderIteratorConfig.model, 'opencode-go/kimi-k2.6', 'iterator preserves explicit provider model override');
assert.equal(explicitProviderIteratorConfig.runtime_task.input.provider, 'opencode', 'iterator passes explicit provider to runtime task');
assert.equal(explicitProviderIteratorConfig.runtime_task.input.model, 'opencode-go/kimi-k2.6', 'iterator passes explicit model to runtime task');
assert.deepEqual(explicitProviderIteratorConfig.provider_plugin_paths, ['/runner/ai-provider-for-opencode-current'], 'iterator preserves explicit provider plugin override');
assert.deepEqual(explicitProviderIteratorConfig.secret_env, ['OPENCODE_API_KEY', 'GITHUB_TOKEN'], 'iterator preserves explicit secret env override');
assert.deepEqual(explicitProviderIteratorConfig.runtime_env, { XDG_CONFIG_HOME: '/runtime/config', XDG_STATE_HOME: '/runtime/state' }, 'iterator preserves explicit runtime env override');
assert.deepEqual(explicitProviderIteratorConfig.runtime_config_mounts, [{ source: '/runner/config', target: '/runtime/config', mode: 'readonly' }], 'iterator preserves explicit runtime config mounts');
assert.deepEqual(explicitProviderIteratorConfig.runtime_state_mounts, [{ source: '/runner/state', target: '/runtime/state', mode: 'readonly' }], 'iterator preserves explicit runtime state mounts');

const dispatchResult = spawnSync(
	process.execPath,
	[
		'.github/scripts/dispatch-php-transformer-iterator.mjs',
		'--dry-run',
		'--repo',
		'chubes4/wp-site-generator',
		'--source-pr',
		'456',
		'--source-head-sha',
		'abc1234',
		'--validation-run-id',
		'9999',
		'--artifact-name',
		'ssi-validation-issue-123-native-loop',
		'--visual-artifact-name',
		'visual-parity-issue-123-native-loop',
	],
	{ cwd: repoRoot, encoding: 'utf8' },
);
assert.equal(dispatchResult.status, 0, dispatchResult.stderr || dispatchResult.stdout);
await writeFile(dispatchPath, dispatchResult.stdout);
const dispatch = JSON.parse(await readFile(dispatchPath, 'utf8'));
assert.equal(dispatch.workflow, 'php-transformer-iterator.yml', 'dispatch adapter preserves Actions iterator workflow target');
assert.equal(dispatch.payload.inputs.source_pr, '456', 'dispatch adapter preserves source PR input');
assert.equal(dispatch.payload.inputs.openai_model, 'gpt-5.5', 'dispatch adapter preserves model default');

const validationWorkflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
assert.match(validationWorkflow, /build-static-validation-settings\.mjs/, 'Actions validation uses shared Homeboy settings adapter');
assert.match(validationWorkflow, /build-static-preview-blueprint\.mjs/, 'Actions validation uses shared preview adapter');

console.log('SSI native loop adapter smoke passed');
