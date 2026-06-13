import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-homeboy-plan-'));
const planPath = path.join(tempDir, 'plan.json');

try {
  const result = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_RUN_ID: '409',
      HOMEBOY_PLAN_PATH: planPath,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const serialized = JSON.stringify(plan);

  assert.equal(plan.schema, 'homeboy/agent-task-plan/v1');
  assert.doesNotMatch(serialized, /metadata\/codebox\/datamachine/);
  assert.doesNotMatch(serialized, /scenarios\/0/);

	assert.equal(plan.metadata.artifact_driven, true, 'normal loop is artifact-driven');
	assert.deepEqual(plan.metadata.artifact_stages, ['ConceptPacket', 'DesignPacket', 'StaticSiteCandidate', 'ImportValidationResult', 'StaticSitePullRequest']);
	assert.equal(plan.metadata.controller_spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
	assert.equal(plan.metadata.controller_contract, 'wp-site-generator/static-site-generation-loop');

	const controllerSpec = JSON.parse(await readFile(path.join(repoRoot, '.github/homeboy/controllers/static-site-generation-loop.controller.json'), 'utf8'));
	assert.equal(controllerSpec.schema, 'homeboy/controller-spec/v1');
	assert.equal(controllerSpec.controller_id, 'wp-site-generator/static-site-generation-loop');
	assert.equal(controllerSpec.authority.execution_surface, 'homeboy_lab');
	assert.equal(controllerSpec.authority.github_actions_role, 'trigger_and_reporting_compatibility');
	assert.equal(controllerSpec.runtime.backend, 'codebox');
	assert.equal(controllerSpec.runtime.provider.kind, 'codex');
	assert.equal(controllerSpec.runtime.provider.location, 'in_sandbox');
	assert.deepEqual(
		controllerSpec.stages.map((stage) => stage.id),
		[
			'concept',
			'design',
			'candidate',
			'import_validation',
			'publish_pr',
			'static_validation',
			'finding_packets',
			'iterator_upstream_pr',
			'reviewer_gate',
		],
		'controller records the full static-site generation loop order'
	);
	assert.deepEqual(
		controllerSpec.lineage_entities.map((entity) => entity.id),
		[
			'concept_packet',
			'design_packet',
			'static_site_candidate',
			'import_validation_result',
			'static_site_pull_request',
			'static_validation_run',
			'visual_parity_artifact',
			'finding_packet_set',
			'iterator_upstream_pull_request',
			'reviewer_gate_outcome',
		],
		'controller records all source, validation, iterator, and reviewer lineage entities'
	);
	assert.deepEqual(
		controllerSpec.blockers.map((blocker) => `${blocker.repo}#${blocker.issue}`),
		[
			'Extra-Chill/homeboy#3905',
			'Extra-Chill/homeboy#3904',
			'Extra-Chill/homeboy#4216',
			'Extra-Chill/homeboy#4218',
			'Extra-Chill/homeboy-extensions#1319',
		],
		'controller records known native Lab blockers'
	);

	for (const taskId of ['design-store-packet', 'design-website-packet']) {
		assert.equal(
			plan.output_dependencies[taskId].bindings.concept_packet.path,
			'/outputs/concept_packet',
			`${taskId} binds to ConceptPacket output`
		);
	}

	assert.equal(plan.output_dependencies['generate-store-candidate'].depends_on[0], 'design-store-packet');
	assert.equal(plan.output_dependencies['generate-website-candidate'].depends_on[0], 'design-website-packet');
	assert.equal(
		plan.output_dependencies['generate-store-candidate'].bindings.design_packet.task_id,
		'design-store-packet',
		'store candidate receives DesignPacket from design task'
	);
	assert.equal(
		plan.output_dependencies['generate-store-candidate'].bindings.design_packet.path,
		'/outputs/design_packet',
		'store candidate binds to DesignPacket output'
	);
	assert.equal(
		plan.output_dependencies['validate-store-candidate'].bindings.static_site_candidate.path,
		'/outputs/static_site_candidate',
		'validation consumes StaticSiteCandidate before PR publication'
	);
	assert.deepEqual(
		plan.output_dependencies['publish-store-pr'].depends_on,
		['generate-store-candidate', 'validate-store-candidate'],
		'PR publication waits for candidate generation and validation'
	);
	assert.equal(
		plan.output_dependencies['publish-store-pr'].bindings.import_validation_result.path,
		'/outputs/import_validation_result',
		'PR publication consumes ImportValidationResult'
	);

	for (const taskId of ['design-store-packet', 'design-website-packet']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		assert.deepEqual(config.success_completion_outcomes, ['design_packet'], `${taskId} requires DesignPacket completion`);
		assert.match(config.prompt, /ConceptPacket/, `${taskId} consumes ConceptPacket`);
		assert.doesNotMatch(config.prompt, /create_github_issue/, `${taskId} does not create a design handoff issue`);
		assert.deepEqual(config.tool_recorders, [], `${taskId} has no design issue recorder`);
		assert.equal(config.artifact_outputs.design_packet.schema, 'wp-site-generator/DesignPacket/v1');
		assert.equal(config.engine_data_outputs.design_packet, 'metadata.artifacts.DesignPacket');
	}

	for (const taskId of ['generate-store-candidate', 'generate-website-candidate']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		assert.deepEqual(config.success_completion_outcomes, ['static_site_candidate'], `${taskId} stops at candidate artifact`);
		assert.equal(config.success_requires_pr, false, `${taskId} does not publish a PR`);
		assert.equal(config.artifact_outputs.static_site_candidate.schema, 'wp-site-generator/StaticSiteCandidate/v1');
		assert.match(config.prompt, /Do not open a pull request/, `${taskId} separates candidate generation from publication`);
	}

	for (const taskId of ['validate-store-candidate', 'validate-website-candidate']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		assert.equal(config.execution_kind, 'wp_codebox_ability', `${taskId} delegates validation to WP Codebox ability bridge`);
		assert.equal(config.ability, 'static-site-importer/import-website-artifact', `${taskId} calls SSI artifact import ability`);
		assert.equal(config.ability_input.artifact, '{{outputs.static_site_candidate}}', `${taskId} passes StaticSiteCandidate as ability input`);
		assert.equal(config.output_mappings.import_validation_result, 'result.import_validation_result', `${taskId} maps SSI validation result`);
		assert.equal(config.output_mappings.finding_packets, 'result.finding_packets', `${taskId} maps SSI finding packets`);
		assert.equal(config.artifact_outputs.import_validation_result.schema, 'wp-site-generator/ImportValidationResult/v1');
		assert.equal(config.engine_data_outputs.import_validation_result, 'outputs.import_validation_result', `${taskId} requires mapped validation output`);
		assert.equal(config.engine_data_outputs.finding_packets, 'outputs.finding_packets', `${taskId} requires mapped finding packets`);
	}

	for (const taskId of ['publish-store-pr', 'publish-website-pr']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		assert.equal(config.success_requires_pr, true, `${taskId} is the first GitHub-visible publication step`);
		assert.deepEqual(config.success_completion_outcomes, ['static_site_pr'], `${taskId} completes on PR publication`);
		assert.match(config.prompt, /ImportValidationResult/, `${taskId} consumes import validation metrics`);
		assert.match(config.prompt, /render-static-site-pr-body\.mjs/, `${taskId} renders initial PR body metrics`);
	}

  const staticPipeline = JSON.parse(await readFile(path.join(repoRoot, 'bundles/static-site-agent/pipelines/static-site-pipeline.json'), 'utf8'));
  const staticAiStep = staticPipeline.steps.find((step) => step.step_type === 'ai');
  assert.match(staticAiStep.step_config.system_prompt, /preserve the remaining title text verbatim/, 'static agent preserves full source concept title text');
  assert.match(staticAiStep.step_config.system_prompt, /full source concept title without its leading emoji\/icon marker/, 'static agent PR title formula keeps full source concept title');

  const loopWorkflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');
  assert.match(loopWorkflow, /actions:\s+write/, 'site generation loop can dispatch validation workflows');
  assert.match(loopWorkflow, /HOMEBOY_CONTROLLER_SPEC_PATH/, 'site generation loop points at the controller spec contract');
  assert.match(loopWorkflow, /dispatch-static-validation\.mjs/, 'site generation loop dispatches static validation for generated PRs');

  const validationWorkflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
  assert.match(validationWorkflow, /workflow_dispatch:[\s\S]*pr_number:/, 'static validation supports explicit PR dispatch');
  assert.match(validationWorkflow, /gh pr diff "\$PR_NUMBER"/, 'static validation detects changed sites from dispatched PR number');
  assert.match(validationWorkflow, /build-static-validation-settings\.mjs/, 'static validation delegates Homeboy settings to the shared adapter');

  const validationSettings = await readFile(path.join(repoRoot, '.github/scripts/build-static-validation-settings.mjs'), 'utf8');
  assert.match(validationSettings, /block-artifact-compiler[\s\S]*block-format-bridge[\s\S]*static-site-importer/, 'static validation installs BAC, BFB, then SSI');
  assert.match(validationSettings, /block-format-bridge/, 'static validation installs Block Format Bridge before Static Site Importer');

  const visualParity = await readFile(path.join(repoRoot, '.github/scripts/static-visual-parity.mjs'), 'utf8');
  assert.match(visualParity, /block-artifact-compiler[\s\S]*block-format-bridge[\s\S]*static-site-importer/, 'visual parity recipe installs BAC, BFB, then SSI');
  assert.match(visualParity, /block-format-bridge/, 'visual parity recipe installs Block Format Bridge before Static Site Importer');

  const pluginShim = await readFile(path.join(repoRoot, 'wp-site-generator.php'), 'utf8');
  assert.match(pluginShim, /Plugin Name:\s*WP Site Generator CI Fixture/, 'repo exposes a plugin header for Homeboy bench component mounting');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation plan smoke passed');
