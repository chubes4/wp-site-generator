import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateComplexityPolicy, loadPolicy } from '../../.github/scripts/site-generation-complexity-policy.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-homeboy-plan-'));
const planPath = path.join(tempDir, 'plan.json');
const qualitySignalsPath = path.join(tempDir, 'quality-signals.json');

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
  assert.doesNotMatch(serialized, /\.ci\/wp-codebox/, 'Lab plans do not bake a controller-local WP Codebox path by default');
  assert.doesNotMatch(serialized, /ai-provider-for-openai/, 'Lab plans defer provider plugin selection to runner settings by default');
  assert.doesNotMatch(serialized, /OPENAI_API_KEY/, 'Lab plans defer provider auth selection to runner settings by default');
  assert.equal(serialized.includes(repoRoot), false, 'default Lab plan does not bake the local checkout path');

  for (const request of plan.tasks) {
    assert.equal(request.executor.model, undefined, `${request.task_id} defers executor model selection to runner settings by default`);
    assert.equal(request.executor.config.provider, undefined, `${request.task_id} defers provider selection to runner settings by default`);
    assert.equal(request.executor.config.model, undefined, `${request.task_id} defers config model selection to runner settings by default`);
    assert.equal(request.executor.config.provider_plugin_paths, undefined, `${request.task_id} defers provider plugin selection to runner settings by default`);
    assert.equal(request.executor.config.secret_env, undefined, `${request.task_id} defers provider secret env selection to runner settings by default`);
    if (request.executor.config.execution_kind === 'datamachine_bundle') {
      assert.equal(request.executor.config.agents_api, '.ci/agents-api', `${request.task_id} uses a repo-relative Agents API component path`);
      assert.equal(request.executor.config.data_machine, '.ci/data-machine', `${request.task_id} uses a repo-relative Data Machine component path`);
      assert.equal(request.executor.config.data_machine_code, '.ci/data-machine-code', `${request.task_id} uses a repo-relative Data Machine Code component path`);
      assert.equal(request.executor.config.homeboy_extensions, '.ci/homeboy-extensions/wordpress', `${request.task_id} uses a repo-relative Homeboy Extensions component path`);
      assert.match(request.executor.config.bundle_host_path, /^bundles\//, `${request.task_id} uses a repo-relative bundle path`);
      assert.match(request.executor.config.artifacts, /^\.ci\/homeboy-agent-task-artifacts\//, `${request.task_id} uses a repo-relative artifact directory`);
    }
  }

	assert.equal(plan.metadata.artifact_driven, true, 'normal loop is artifact-driven');
	assert.deepEqual(plan.metadata.artifact_stages, ['ConceptPacket', 'DesignPacket', 'StaticSiteCandidate', 'ImportValidationResult', 'StaticSitePullRequest']);
	assert.equal(plan.metadata.controller_spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
	assert.equal(plan.metadata.controller_contract, 'wp-site-generator/static-site-generation-loop');
	assert.equal(plan.metadata.complexity_policy.schema, 'wp-site-generator/site-generation-complexity-policy/v1');
	assert.equal(plan.metadata.complexity_policy.current_tier, 'foundation');
	assert.equal(plan.metadata.complexity_policy.selected_tier, 'foundation');
	assert.equal(plan.metadata.complexity_policy.decision, 'hold');
	assert.equal(plan.metadata.complexity_policy.randomness_profile.id, 'steady');
	assert.equal(plan.metadata.complexity_policy.randomness_seed.length, 12);
	assert.deepEqual(plan.metadata.complexity_policy.site_kind_mix, ['store', 'website']);
	assert.equal(plan.options.max_concurrency, 1, 'foundation tier keeps one active candidate by default');

	const controllerSpec = JSON.parse(await readFile(path.join(repoRoot, '.github/homeboy/controllers/static-site-generation-loop.controller.json'), 'utf8'));
	assert.equal(controllerSpec.schema, 'homeboy/controller-spec/v1');
	assert.equal(controllerSpec.controller_id, 'wp-site-generator/static-site-generation-loop');
	assert.equal(controllerSpec.authority.execution_surface, 'homeboy_lab');
	assert.equal(controllerSpec.authority.github_actions_role, 'trigger_and_reporting_compatibility');
	assert.equal(controllerSpec.runtime.backend, 'codebox');
	assert.equal(controllerSpec.runtime.provider.kind, 'codex');
	assert.equal(controllerSpec.runtime.provider.location, 'in_sandbox');
	assert.equal(controllerSpec.authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs');
	assert.equal(controllerSpec.state.store, 'homeboy_controller_state', 'controller declares resumable state storage');
	assert.ok(controllerSpec.state.checkpoint_events.includes('revalidation.completed'), 'controller checkpoints revalidation attempts');
	assert.equal(controllerSpec.tracking.issue, 'https://github.com/chubes4/wp-site-generator/issues/639', 'controller links issue 639');
	assert.deepEqual(
		controllerSpec.phases.map((phase) => phase.id),
		[
			'generation',
			'import_validation',
			'publish_pr',
			'static_validation',
			'finding_packets',
			'iterator_subloops',
			'revalidation',
			'reviewer_gate',
		],
		'controller records the full static-site generation loop order'
	);
	assert.deepEqual(Object.keys(controllerSpec.quality_gates), ['fallback_blocks', 'conversion_findings', 'visual_parity', 'reviewer_evidence'], 'controller declares explicit quality gates');
	assert.equal(controllerSpec.quality_gates.fallback_blocks.pass_when, 'value === 0');
	assert.equal(controllerSpec.quality_gates.conversion_findings.pass_when, 'value === 0');
	assert.equal(controllerSpec.quality_gates.visual_parity.pass_when, 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0');
	assert.deepEqual(controllerSpec.quality_gates.reviewer_evidence.forbids, ['localhost', '127.0.0.1', '/Users/']);
	assert.equal(controllerSpec.phases.find((phase) => phase.id === 'iterator_subloops').fan_out.per, 'finding_group', 'iterator phase fans out per grouped finding');
	assert.equal(controllerSpec.phases.find((phase) => phase.id === 'revalidation').max_attempts, 3, 'revalidation attempts are bounded');
	assert.deepEqual(
		controllerSpec.phases.find((phase) => phase.id === 'revalidation').gates,
		['fallback_blocks', 'conversion_findings', 'visual_parity'],
		'revalidation reruns all quality gates'
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
			'finding_group',
			'iterator_worktree',
			'iterator_upstream_issue',
			'iterator_upstream_pull_request',
			'revalidation_attempt',
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
		assert.match(config.prompt, /Generation complexity policy:/, `${taskId} records policy guidance in prompt`);
		assert.equal(config.complexity_policy.selected_tier, 'foundation', `${taskId} records selected complexity tier`);
		assert.equal(plan.tasks.find((task) => task.task_id === taskId).inputs.complexity_policy.randomness_seed.length, 12, `${taskId} carries reproducible randomness seed`);
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
		assert.match(config.prompt, /Record the tier, randomness profile, randomness seed/, `${taskId} asks candidate to preserve policy metadata`);
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
	assert.match(loopWorkflow, /WPSG_COMPLEXITY_TIER/, 'site generation loop exposes WPSG complexity override');
	assert.match(loopWorkflow, /WPSG_QUALITY_SIGNALS_PATH/, 'site generation loop exposes quality-signal input');
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

	const policy = loadPolicy(path.join(repoRoot, '.github/site-generation-complexity-policy.json'));
	const stableDecision = evaluateComplexityPolicy({
		policy,
		runId: 'stable-run',
		qualitySignals: {
			current_tier: 'foundation',
			recent_results: Array.from({ length: 4 }, () => ({
				status: 'passed',
				fallback_block_count: 0,
				visual_mismatch_ratio: 0.01,
				actionable_findings: 0,
			})),
		},
	});
	assert.equal(stableDecision.decision, 'raise', 'stable quality raises one tier');
	assert.equal(stableDecision.selected_tier, 'composed', 'stable foundation quality ramps to composed');
	assert.equal(stableDecision.randomness_profile.id, 'varied', 'composed tier uses varied randomness profile');

	const regressionDecision = evaluateComplexityPolicy({
		policy,
		runId: 'regression-run',
		qualitySignals: {
			current_tier: 'composed',
			recent_results: [
				{ status: 'failed', fallback_block_count: 3, visual_mismatch_ratio: 0.11, actionable_findings: 5 },
				{ status: 'passed', fallback_block_count: 2, visual_mismatch_ratio: 0.04, actionable_findings: 3 },
			],
		},
	});
	assert.equal(regressionDecision.decision, 'lower', 'regression lowers one tier');
	assert.equal(regressionDecision.selected_tier, 'foundation', 'regression drops composed quality to foundation');

	const overrideDecision = evaluateComplexityPolicy({
		policy,
		runId: 'override-run',
		qualitySignals: { current_tier: 'foundation' },
		overrides: { tier: 'stress', randomnessProfile: 'exploratory', seed: 'manual-seed', siteKindMix: ['publication'] },
	});
	assert.equal(overrideDecision.decision, 'override', 'explicit tier override wins over signals');
	assert.equal(overrideDecision.selected_tier, 'stress', 'explicit tier override selects requested tier');
	assert.equal(overrideDecision.randomness_seed, 'manual-seed', 'explicit seed override is recorded');
	assert.deepEqual(overrideDecision.site_kind_mix, ['publication'], 'explicit site-kind mix override is recorded');

	await writeFile(qualitySignalsPath, JSON.stringify({ current_tier: 'foundation', recent_results: stableDecision.quality_summary.count ? Array.from({ length: 4 }, () => ({ status: 'passed', fallback_block_count: 0, visual_mismatch_ratio: 0.01, actionable_findings: 0 })) : [] }));
	const qualityResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_RUN_ID: '410',
			HOMEBOY_PLAN_PATH: path.join(tempDir, 'plan-stable.json'),
			WPSG_QUALITY_SIGNALS_PATH: qualitySignalsPath,
		},
	});
	assert.equal(qualityResult.status, 0, qualityResult.stderr || qualityResult.stdout);
	const stablePlan = JSON.parse(await readFile(path.join(tempDir, 'plan-stable.json'), 'utf8'));
	assert.equal(stablePlan.metadata.complexity_policy.selected_tier, 'composed', 'plan builder consumes quality-signal file');
	assert.equal(stablePlan.options.max_concurrency, 2, 'composed tier raises active candidate budget');

	const explicitCodeboxPath = '/runner/wp-codebox/packages/cli/dist/index.js';
	const explicitCodeboxPlanPath = path.join(tempDir, 'plan-codebox.json');
	const explicitCodeboxResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			GITHUB_RUN_ID: '411',
			HOMEBOY_PLAN_PATH: explicitCodeboxPlanPath,
			HOMEBOY_WP_CODEBOX_BIN: explicitCodeboxPath,
		},
	});
	assert.equal(explicitCodeboxResult.status, 0, explicitCodeboxResult.stderr || explicitCodeboxResult.stdout);
  const explicitCodeboxPlan = JSON.parse(await readFile(explicitCodeboxPlanPath, 'utf8'));
  assert.equal(explicitCodeboxPlan.tasks[0].executor.config.wp_codebox_bin, explicitCodeboxPath, 'explicit runner WP Codebox path is preserved');

  const explicitProviderPlanPath = path.join(tempDir, 'plan-provider.json');
  const explicitProviderResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_RUN_ID: '412',
      HOMEBOY_PLAN_PATH: explicitProviderPlanPath,
      HOMEBOY_WP_CODEBOX_PROVIDER: 'opencode',
      HOMEBOY_WP_CODEBOX_MODEL: 'opencode-go/kimi-k2.6',
      HOMEBOY_WP_CODEBOX_PROVIDER_PLUGIN_PATHS: '/runner/ai-provider-for-opencode-current',
      HOMEBOY_WP_CODEBOX_SECRET_ENV: 'OPENCODE_API_KEY,GITHUB_TOKEN',
    },
  });
  assert.equal(explicitProviderResult.status, 0, explicitProviderResult.stderr || explicitProviderResult.stdout);
  const explicitProviderPlan = JSON.parse(await readFile(explicitProviderPlanPath, 'utf8'));
  const explicitProviderConfig = explicitProviderPlan.tasks[0].executor.config;
  assert.equal(explicitProviderConfig.provider, 'opencode', 'explicit provider override is preserved');
  assert.equal(explicitProviderConfig.model, 'opencode-go/kimi-k2.6', 'explicit provider model override is preserved');
  assert.deepEqual(explicitProviderConfig.provider_plugin_paths, ['/runner/ai-provider-for-opencode-current'], 'explicit provider plugin override is preserved');
  assert.deepEqual(explicitProviderConfig.secret_env, ['OPENCODE_API_KEY', 'GITHUB_TOKEN'], 'explicit secret env override is preserved');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation plan smoke passed');
