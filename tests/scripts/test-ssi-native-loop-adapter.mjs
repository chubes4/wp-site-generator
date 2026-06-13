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
assert.equal(controller.authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs', 'controller records its repo-owned builder');
assert.equal(controller.state.store, 'homeboy_controller_state', 'controller records resumable state store');
assert.ok(controller.state.tracked_entities.includes('revalidation_attempt'), 'controller tracks revalidation attempts');
assert.equal(controller.quality_gates.fallback_blocks.pass_when, 'value === 0', 'fallback block gate is explicit');
assert.equal(controller.quality_gates.conversion_findings.pass_when, 'value === 0', 'conversion finding gate is explicit');
assert.equal(controller.quality_gates.visual_parity.pass_when, 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0', 'visual parity gate is explicit');
assert.equal(controller.phases.find((phase) => phase.id === 'iterator_subloops').dedupe_by.length, 2, 'iterator subloops have dedupe keys');
assert.equal(controller.phases.find((phase) => phase.id === 'revalidation').on_fail, 'iterator_subloops', 'failed revalidation loops back to iterator subloops');
assert.equal(controller.tracking.issue, 'https://github.com/chubes4/wp-site-generator/issues/639', 'controller links issue 639');

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
assert.equal(plan.tasks[0].executor.config.execution_kind, 'datamachine_bundle', 'iterator runs through Homeboy Data Machine bundle executor');
assert.equal(plan.tasks[0].executor.config.wp_codebox_bin, undefined, 'iterator plan defers WP Codebox binary selection to the runner by default');
assert.equal(plan.tasks[0].executor.config.execute_workflow_path, workflowPath, 'iterator consumes prebuilt grouped finding workflow');
assert.deepEqual(plan.tasks[0].executor.config.success_completion_outcomes, ['pull_request_path'], 'native iterator keeps PR-first completion gate');
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
assert.match(validationWorkflow, /dispatch-php-transformer-iterator\.mjs/, 'Actions validation uses shared iterator dispatch adapter');

console.log('SSI native loop adapter smoke passed');
