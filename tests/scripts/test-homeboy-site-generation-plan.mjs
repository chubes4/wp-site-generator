import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { evaluateComplexityPolicy, loadPolicy } from '../../.github/scripts/site-generation-complexity-policy.mjs';
import { createHomeboyControllerFixture } from '../helpers/homeboy-fixtures.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-homeboy-controller-'));
const controllerRunSpecPath = path.join(tempDir, 'controller-run-spec.json');
const qualitySignalsPath = path.join(tempDir, 'quality-signals.json');
const homeboyFixturePath = await createHomeboyControllerFixture(tempDir);

const controllerBuilderEnv = (overrides = {}) => ({
	...process.env,
	...overrides,
});

async function materializeControllerSpec({ outputPath, env }) {
	const inputsPath = outputPath.replace(/\.json$/, '.inputs.json');
	const policyResultPath = outputPath.replace(/\.json$/, '.complexity-policy-result.json');
	const materializationPath = outputPath.replace(/\.json$/, '.materialization.json');
	const inputsResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-controller-run-inputs.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: controllerBuilderEnv({
			...env,
			HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: inputsPath,
			HOMEBOY_POLICY_RESULT_PATH: policyResultPath,
		}),
	});
	assert.equal(inputsResult.status, 0, inputsResult.stderr || inputsResult.stdout);
	const materializeResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'materialize', '@.github/homeboy/controllers/static-site-generation-loop.controller.json', '--inputs', `@${inputsPath}`, '--policy-result', `@${policyResultPath}`, '--output', materializationPath], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(materializeResult.status, 0, materializeResult.stderr || materializeResult.stdout);
	const materialization = JSON.parse(await readFile(materializationPath, 'utf8'));
	const spec = materialization.data?.spec || materialization.value?.spec || materialization.spec;
	await writeFile(outputPath, JSON.stringify(spec, null, 2) + '\n');
	return spec;
}

try {
	const controllerRunSpec = await materializeControllerSpec({
		outputPath: controllerRunSpecPath,
		env: {
			GITHUB_RUN_ID: '409',
		},
	});

	const serialized = JSON.stringify(controllerRunSpec);
	const storeIdeaInputs = controllerRunSpec.workflows.find((workflow) => workflow.workflow_id === 'store-idea').inputs;
	const complexityPolicy = storeIdeaInputs.policy_results['wpsg-complexity-policy'];

	assert.equal(controllerRunSpec.schema, 'homeboy/agent-task-loop-spec/v1');
	assert.equal(controllerRunSpec.loop_id, 'wp-site-generator/static-site-generation-loop');
	assert.equal(storeIdeaInputs.run_id, '409');
	assert.equal(storeIdeaInputs.repository, 'chubes4/wp-site-generator');
	assert.equal(storeIdeaInputs.randomness_seed, complexityPolicy.randomness_seed, 'controller inputs persist the effective replay seed');
	assert.equal(storeIdeaInputs.randomness_profile, 'steady', 'controller inputs persist the effective randomness profile');
	assert.equal(storeIdeaInputs.source.ref_type, 'commit', 'controller inputs persist immutable source provenance');
	assert.equal(storeIdeaInputs.source.sha.length, 40, 'controller inputs include the source checkout SHA');
	assert.equal(storeIdeaInputs.runtime_input_contract, 'homeboy-agent-runtime-env');
	assert.equal(complexityPolicy.schema, 'wp-site-generator/site-generation-complexity-policy/v1');
	assert.equal(complexityPolicy.current_tier, 'foundation');
	assert.equal(complexityPolicy.selected_tier, 'foundation');
	assert.equal(complexityPolicy.decision, 'hold');
	assert.equal(complexityPolicy.randomness_profile.id, 'steady');
	assert.equal(complexityPolicy.randomness_seed.length, 12);
	assert.deepEqual(complexityPolicy.site_kind_mix, ['store', 'website']);
	assert.equal(controllerRunSpec.metadata.policy_materialization['wpsg-complexity-policy'].provenance.run_id, '409');
	assert.equal(controllerRunSpec.metadata.run.generated_by, '.github/scripts/build-homeboy-controller-run-inputs.mjs');
	assert.equal(controllerRunSpec.metadata.run.randomness_seed, complexityPolicy.randomness_seed, 'run metadata persists deterministic replay seed');
	assert.equal(controllerRunSpec.metadata.run.source.sha, storeIdeaInputs.source.sha, 'run metadata persists source commit');
	assert.equal(controllerRunSpec.metadata.run.materialized_by, 'homeboy agent-task controller materialize');
	assert.equal(controllerRunSpec.metadata.run.controller_spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
	assert.equal(controllerRunSpec.metadata.authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs');

	assert.doesNotMatch(serialized, /metadata\/codebox\/datamachine/);
	assert.doesNotMatch(serialized, /scenarios\/0/);
	assert.doesNotMatch(serialized, /\.ci\/wp-codebox/, 'controller spec does not bake a controller-local WP Codebox path');
	assert.doesNotMatch(serialized, /ai-provider-for-openai/, 'controller spec defers provider plugin selection to Homeboy/runtime policy');
	assert.doesNotMatch(serialized, /OPENAI_API_KEY/, 'controller spec defers provider auth selection to Homeboy/runtime policy');
	assert.equal(serialized.includes(repoRoot), false, 'controller spec does not bake the local checkout path');

	const localMissingIdentityResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-controller-run-inputs.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: controllerBuilderEnv({
			GITHUB_RUN_ID: '',
			WPSG_REPLAY_ID: '',
			HOMEBOY_REPLAY_ID: '',
			WPSG_RANDOMNESS_SEED: 'local-seed',
			HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: path.join(tempDir, 'missing-local-identity.json'),
		}),
	});
	assert.notEqual(localMissingIdentityResult.status, 0, 'local controller run input generation requires an explicit replay identity');
	assert.match(localMissingIdentityResult.stderr, /WPSG_REPLAY_ID or HOMEBOY_REPLAY_ID/, 'local replay identity error explains the required input');

	const localMissingSeedResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-controller-run-inputs.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: controllerBuilderEnv({
			GITHUB_RUN_ID: '',
			WPSG_REPLAY_ID: 'local-replay-409',
			WPSG_RANDOMNESS_SEED: '',
			HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: path.join(tempDir, 'missing-local-seed.json'),
		}),
	});
	assert.notEqual(localMissingSeedResult.status, 0, 'local site generation controller inputs require an explicit randomness seed');
	assert.match(localMissingSeedResult.stderr, /WPSG_RANDOMNESS_SEED is required/, 'local replay seed error explains the required input');

	const localReplaySpecPath = path.join(tempDir, 'local-replay-controller.json');
	const localReplaySpec = await materializeControllerSpec({
		outputPath: localReplaySpecPath,
		env: {
			GITHUB_RUN_ID: '',
			WPSG_REPLAY_ID: 'local-replay-409',
			WPSG_RANDOMNESS_SEED: 'local-seed',
		},
	});
	const localReplayInputs = localReplaySpec.workflows.find((workflow) => workflow.workflow_id === 'store-idea').inputs;
	assert.equal(localReplayInputs.run_id, 'local-replay-409', 'local replay identity replaces timestamp fallback');
	assert.equal(localReplayInputs.policy_results['wpsg-complexity-policy'].randomness_seed, 'local-seed', 'local replay seed is explicit');

	assert.ok(controllerRunSpec.workflows.find((workflow) => workflow.workflow_id === 'revalidation').artifacts.includes('revalidation_attempt'), 'controller checkpoints revalidation attempts');
	assert.deepEqual(
		controllerRunSpec.artifact_flow.map((edge) => `${edge.edge_id}:${edge.artifact}`),
		[
			'concept-to-design:concept_packet',
			'design-to-static:design_packet',
			'concept-to-static:concept_packet',
			'static-to-validation:static_site_candidate',
			'validation-to-publication-gate:import_validation_result',
			'visual-to-publication-gate:visual_parity_artifact',
			'static-to-publication:static_site_candidate',
			'validation-to-publication:import_validation_result',
			'publication-gate-to-publication:static_site_publish_gate',
			'candidate-to-revalidation:static_site_candidate',
			'validation-to-revalidation:import_validation_result',
			'visual-to-revalidation:visual_parity_artifact',
			'findings-to-revalidation:finding_packet_set',
			'candidate-to-reviewer:static_site_candidate',
			'validation-to-reviewer:import_validation_result',
			'static-run-to-reviewer:static_validation_run',
			'visual-to-reviewer:visual_parity_artifact',
			'findings-to-reviewer:finding_packet_set',
			'publication-pr-evidence:static_site_pull_request',
			'validation-to-findings:static_validation_run',
			'visual-to-findings:visual_parity_artifact',
			'findings-to-iterator-groups:finding_group',
			'revalidation-to-reviewer:revalidation_attempt',
			'iterator-issue-evidence-to-reviewer:iterator_upstream_issue',
			'iterator-pr-evidence-to-reviewer:iterator_upstream_pull_request',
		],
		'controller records the enforceable artifact handoff chain'
	);
	assert.deepEqual(controllerRunSpec.artifact_flow.filter((edge) => edge.fan_out).map((edge) => edge.edge_id), ['findings-to-iterator-groups'], 'only grouped findings fan out iterator work');
	assert.deepEqual(controllerRunSpec.iterator_groups, {
		artifact: 'finding_group',
		group_by: ['owner_repo', 'root_cause', 'group_id'],
		fan_out_workflow: 'iterator',
		join_workflows: ['revalidation', 'reviewer'],
	}, 'iterator fan-out is scoped by finding group ownership and joined before review');

	const workflows = Object.fromEntries(controllerRunSpec.workflows.map((workflow) => [workflow.workflow_id, workflow]));
	assert.deepEqual(Object.keys(workflows), [
		'store-idea',
		'website-idea',
		'design-store',
		'design-website',
		'static-store',
		'static-site',
		'static-validation',
		'static-publication-gate',
		'static-publication',
		'finding-packets',
		'iterator',
		'revalidation',
		'reviewer',
	], 'controller records the full static-site generation loop order');
	assert.deepEqual(workflows['design-store'].consumes, ['concept_packet'], 'design-store consumes concept packets explicitly');
	assert.deepEqual(workflows['static-site'].consumes, ['concept_packet', 'design_packet'], 'static generation consumes concept and design packets explicitly');
	assert.equal(workflows['store-idea'].runtime_execution.input.workflow.id, 'store-idea-artifact-flow', 'store concept generation selects the artifact workflow');
	assert.equal(workflows['static-site'].runtime_execution.input.workflow.id, 'static-site-candidate-flow', 'static generation selects the candidate artifact workflow');
	assert.equal(workflows['store-idea'].abilities.includes('github_issue_publish'), false, 'concept generation does not publish GitHub issues');
	assert.equal(workflows['static-site'].abilities.includes('github_pull_request_publish'), false, 'candidate generation does not publish GitHub pull requests');
	assert.deepEqual(workflows['static-publication-gate'].publish_gate.requires, ['publish_allowed', 'gates.fallback_blocks.passed', 'gates.conversion_findings.passed', 'gates.visual_parity.passed'], 'publication gate requires explicit pass/fail fields');
	assert.deepEqual(workflows['static-publication'].publish_gate, {
		artifact: 'static_site_publish_gate',
		requires: ['publish_allowed'],
		passing_value: true,
	}, 'publication requires publish_allowed=true');
	assert.deepEqual(workflows.iterator.fan_out.group_by, ['owner_repo', 'root_cause', 'group_id'], 'iterator fan-out is grouped by owner/root cause/group id');
	assert.deepEqual(workflows.reviewer.consumes, ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt'], 'reviewer consumes candidate, validation, visual, finding, and revalidation artifacts');
	assert.equal(controllerRunSpec.artifacts.find((artifact) => artifact.artifact_id === 'static_site_pull_request').required, false, 'generated PR artifact is not required runtime transport');
	assert.equal(controllerRunSpec.artifacts.find((artifact) => artifact.artifact_id === 'iterator_upstream_pull_request').evidence_only, true, 'upstream iterator PR is optional evidence only');
	assert.equal(controllerRunSpec.abilities.some((ability) => ability.ability_id === 'wpsg_materialize_packet'), false, 'controller does not expose the WPSG model-facing packet materializer ability');
	assert.doesNotMatch(serialized, /wpsg_materialize_packet|wp-site-generator\/materialize-packet|wpsg_packets/, 'controller no longer uses the custom WPSG packet materializer transport');

	const staticPipeline = JSON.parse(await readFile(path.join(repoRoot, 'bundles/static-site-agent/pipelines/static-site-pipeline.json'), 'utf8'));
	const staticAiStep = staticPipeline.steps.find((step) => step.step_type === 'ai');
	assert.match(staticAiStep.step_config.system_prompt, /preserve the remaining title text verbatim/, 'static agent preserves full source concept title text');

	const packetPipelines = [
		['bundles/store-idea-agent/pipelines/store-idea-artifact-pipeline.json', 'concept_packet', 'wp-site-generator/ConceptPacket/v1'],
		['bundles/website-idea-agent/pipelines/website-idea-artifact-pipeline.json', 'concept_packet', 'wp-site-generator/ConceptPacket/v1'],
		['bundles/design-agent/pipelines/design-artifact-pipeline.json', 'design_packet', 'wp-site-generator/DesignPacket/v1'],
		['bundles/static-site-agent/pipelines/static-site-candidate-pipeline.json', 'static_site_candidate', 'wp-site-generator/StaticSiteCandidate/v1'],
	];
	for (const [pipelinePath, outputKey, schema] of packetPipelines) {
		const packetPipeline = JSON.parse(await readFile(path.join(repoRoot, pipelinePath), 'utf8'));
		const assertions = packetPipeline.steps[0].step_config.completion_assertions;
		assert.equal(assertions.required_artifact_outputs[0].output_key, outputKey, `${pipelinePath} asserts the typed packet output key`);
		assert.equal(assertions.required_artifact_outputs[0].schema, schema, `${pipelinePath} asserts the typed packet schema`);
		assert.equal(assertions.required_tool_names, undefined, `${pipelinePath} no longer requires the WPSG tool`);
	}

	const pluginShim = await readFile(path.join(repoRoot, 'wp-site-generator.php'), 'utf8');
	assert.match(pluginShim, /Plugin Name:\s*WP Site Generator CI Fixture/, 'repo exposes a plugin header for Homeboy bench component mounting');
	assert.doesNotMatch(pluginShim, /wp-site-generator\/materialize-packet/, 'plugin no longer registers the WPSG packet materializer ability');
	assert.doesNotMatch(pluginShim, /datamachine_ability_tool_projections/, 'WPSG plugin does not know Data Machine projection internals');
	assert.doesNotMatch(pluginShim, /datamachine_register_ability_tool/, 'WPSG plugin does not call Data Machine ability-tool helpers');

	const policy = loadPolicy(path.join(repoRoot, '.github/site-generation-complexity-policy.json'));
	const stableDecision = evaluateComplexityPolicy({
		policy,
		runId: 'stable-run',
		qualitySignals: {
			current_tier: 'foundation',
			recent_results: Array.from({ length: 4 }, () => ({ status: 'passed', fallback_block_count: 0, visual_mismatch_ratio: 0.01, actionable_findings: 0 })),
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

	assert.throws(
		() => evaluateComplexityPolicy({ policy, qualitySignals: [{ status: 'passed' }], runId: 'legacy-array' }),
		/recent_results/,
		'quality signals no longer accept array compatibility shape'
	);
	assert.throws(
		() => evaluateComplexityPolicy({ policy, qualitySignals: { results: [{ status: 'passed' }] }, runId: 'legacy-results' }),
		/recent_results/,
		'quality signals no longer accept results compatibility shape'
	);

	await writeFile(qualitySignalsPath, JSON.stringify({
		current_tier: 'foundation',
		recent_results: Array.from({ length: 4 }, () => ({ status: 'passed', fallback_block_count: 0, visual_mismatch_ratio: 0.01, actionable_findings: 0 })),
	}));
	const qualitySpecPath = path.join(tempDir, 'controller-stable.json');
	const stableSpec = await materializeControllerSpec({
		outputPath: qualitySpecPath,
		env: {
			GITHUB_RUN_ID: '410',
			WPSG_QUALITY_SIGNALS_PATH: qualitySignalsPath,
		},
	});
	const stableInputs = stableSpec.workflows.find((workflow) => workflow.workflow_id === 'store-idea').inputs;
	assert.equal(stableInputs.policy_results['wpsg-complexity-policy'].selected_tier, 'composed', 'controller input builder consumes quality-signal file');
	assert.equal(stableInputs.policy_results['wpsg-complexity-policy'].target_parallel_candidates, 2, 'composed tier raises active candidate budget input');
} finally {
	await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation controller smoke passed');
