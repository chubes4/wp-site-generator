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
    if (request.executor.config.runtime_task?.ability === 'datamachine/run-agent-bundle') {
      assert.equal(request.executor.config.runtime_component_paths.agents_api, '.ci/agents-api', `${request.task_id} uses a repo-relative Agents API component path`);
      assert.equal(request.executor.config.runtime_component_paths.agent_runtime, '.ci/data-machine', `${request.task_id} uses a repo-relative Data Machine component path`);
      assert.equal(request.executor.config.runtime_component_paths.agent_runtime_tools, '.ci/data-machine-code', `${request.task_id} uses a repo-relative Data Machine Code component path`);
      assert.equal(request.executor.config.homeboy_extensions, '.ci/homeboy-extensions/wordpress', `${request.task_id} uses a repo-relative Homeboy Extensions component path`);
      assert.deepEqual(request.executor.config.component_contracts, [{ slug: 'wp-site-generator', path: '.', activate: true }], `${request.task_id} loads the WPSG packet materializer component`);
      assert.match(request.executor.config.agent_bundles[0].source, /^\/workspace\/wp-site-generator\/bundles\//, `${request.task_id} imports a sandbox-local agent bundle path`);
      assert.match(request.executor.config.runtime_task.input.source, /^\/workspace\/wp-site-generator\/bundles\//, `${request.task_id} runs a sandbox-local agent bundle path`);
      assert.equal(request.executor.config.runtime_task.input.wait_for_completion, true, `${request.task_id} waits for typed bundle outputs`);
      assert.match(request.executor.config.runtime_task.input.artifacts, /^\.ci\/homeboy-agent-task-artifacts\//, `${request.task_id} uses a repo-relative artifact directory`);
    }
  }

	assert.equal(plan.metadata.artifact_driven, true, 'normal loop is artifact-driven');
	assert.deepEqual(plan.metadata.artifact_stages, ['ConceptPacket', 'DesignPacket', 'StaticSiteCandidate', 'ImportValidationResult', 'StaticSitePublishGate']);
	assert.deepEqual(plan.metadata.publication_evidence_outputs, ['StaticSitePullRequest']);
	assert.equal(plan.metadata.controller_spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
	assert.equal(plan.metadata.controller_contract, 'wp-site-generator/static-site-generation-loop');
	assert.deepEqual(plan.metadata.controller_authority, {
		spec: '.github/homeboy/controllers/static-site-generation-loop.controller.json',
		contract: 'wp-site-generator/static-site-generation-loop',
		builder: '.github/scripts/build-homeboy-ssi-loop-controller.mjs',
	});
	assert.equal(plan.metadata.runtime_input_contract, 'homeboy-agent-runtime-env', 'plan records the Homeboy agent runtime env contract');
	assert.equal(plan.metadata.complexity_policy.schema, 'wp-site-generator/site-generation-complexity-policy/v1');
	assert.equal(plan.metadata.complexity_policy.current_tier, 'foundation');
	assert.equal(plan.metadata.complexity_policy.selected_tier, 'foundation');
	assert.equal(plan.metadata.complexity_policy.decision, 'hold');
	assert.equal(plan.metadata.complexity_policy.randomness_profile.id, 'steady');
	assert.equal(plan.metadata.complexity_policy.randomness_seed.length, 12);
	assert.deepEqual(plan.metadata.complexity_policy.site_kind_mix, ['store', 'website']);
	assert.equal(plan.options.max_concurrency, 1, 'foundation tier keeps one active candidate by default');

	const controllerSpec = JSON.parse(await readFile(path.join(repoRoot, '.github/homeboy/controllers/static-site-generation-loop.controller.json'), 'utf8'));
	assert.equal(controllerSpec.schema, 'homeboy/agent-task-loop-spec/v1');
	assert.equal(controllerSpec.loop_id, 'wp-site-generator/static-site-generation-loop');
	assert.ok(controllerSpec.workflows.find((workflow) => workflow.workflow_id === 'revalidation').artifacts.includes('revalidation_attempt'), 'controller checkpoints revalidation attempts');
	assert.deepEqual(
		controllerSpec.artifact_flow.map((edge) => `${edge.edge_id}:${edge.artifact}`),
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
	assert.deepEqual(
		controllerSpec.artifact_flow.filter((edge) => edge.fan_out).map((edge) => edge.edge_id),
		['findings-to-iterator-groups'],
		'only grouped findings fan out iterator work'
	);
	assert.deepEqual(
		controllerSpec.iterator_groups,
		{
			artifact: 'finding_group',
			group_by: ['owner_repo', 'root_cause', 'group_id'],
			fan_out_workflow: 'iterator',
			join_workflows: ['revalidation', 'reviewer'],
		},
		'iterator fan-out is scoped by finding group ownership and joined before review'
	);
	assert.deepEqual(
		controllerSpec.workflows.map((workflow) => workflow.workflow_id),
		[
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
		],
		'controller records the full static-site generation loop order'
	);
	const workflows = Object.fromEntries(controllerSpec.workflows.map((workflow) => [workflow.workflow_id, workflow]));
	assert.deepEqual(workflows['design-store'].consumes, ['concept_packet'], 'design-store consumes concept packets explicitly');
	assert.deepEqual(workflows['design-store'].emits, ['design_packet'], 'design-store emits design packets explicitly');
	assert.deepEqual(workflows['static-site'].consumes, ['concept_packet', 'design_packet'], 'static generation consumes concept and design packets explicitly');
	assert.equal(workflows['store-idea'].inputs.flow, 'store-idea-artifact-flow', 'store concept generation selects the artifact flow');
	assert.equal(workflows['static-site'].inputs.flow, 'static-site-candidate-flow', 'static generation selects the candidate artifact flow');
	assert.equal(workflows['store-idea'].abilities.includes('github_issue_publish'), false, 'concept generation does not publish GitHub issues');
	assert.equal(workflows['static-site'].abilities.includes('github_pull_request_publish'), false, 'candidate generation does not publish GitHub pull requests');
	assert.deepEqual(workflows['static-validation'].consumes, ['static_site_candidate'], 'static validation waits for the candidate artifact');
	assert.deepEqual(workflows['static-publication-gate'].consumes, ['import_validation_result', 'visual_parity_artifact'], 'publication gate consumes validation and visual evidence');
	assert.deepEqual(workflows['static-publication-gate'].emits, ['static_site_publish_gate'], 'publication gate emits deterministic gate artifact');
	assert.deepEqual(workflows['static-publication-gate'].publish_gate.requires, ['publish_allowed', 'gates.fallback_blocks.passed', 'gates.conversion_findings.passed', 'gates.visual_parity.passed'], 'publication gate requires explicit pass/fail fields');
	assert.deepEqual(workflows['static-publication'].consumes, ['static_site_candidate', 'import_validation_result', 'static_site_publish_gate'], 'publication waits for deterministic publish gate');
	assert.deepEqual(workflows['static-publication'].publish_gate, {
		artifact: 'static_site_publish_gate',
		requires: ['publish_allowed'],
		passing_value: true,
	}, 'publication requires publish_allowed=true');
	assert.deepEqual(workflows['static-publication'].emits, ['static_site_pull_request'], 'publication emits the generated PR artifact');
	assert.deepEqual(workflows['finding-packets'].consumes, ['import_validation_result', 'static_validation_run', 'visual_parity_artifact'], 'finding packets consume validation and visual evidence');
	assert.deepEqual(workflows.iterator.consumes, ['finding_group'], 'iterator workflow consumes grouped findings');
	assert.deepEqual(workflows.iterator.fan_out.group_by, ['owner_repo', 'root_cause', 'group_id'], 'iterator fan-out is grouped by owner/root cause/group id');
	assert.deepEqual(workflows.revalidation.consumes, ['static_site_candidate', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'], 'revalidation consumes artifact evidence without PR transport');
	assert.deepEqual(workflows.reviewer.consumes, ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt'], 'reviewer consumes candidate, validation, visual, finding, and revalidation artifacts');
	assert.equal(controllerSpec.artifact_flow.find((edge) => edge.edge_id === 'publication-pr-evidence').required, false, 'generated PR is optional publication evidence');
	assert.equal(controllerSpec.artifact_flow.find((edge) => edge.edge_id === 'publication-pr-evidence').evidence_only, true, 'generated PR is marked evidence-only');
	assert.equal(controllerSpec.artifacts.find((artifact) => artifact.artifact_id === 'static_site_pull_request').required, false, 'generated PR artifact is not required runtime transport');
	assert.equal(controllerSpec.artifacts.find((artifact) => artifact.artifact_id === 'iterator_upstream_pull_request').evidence_only, true, 'upstream iterator PR is optional evidence only');
	assert.deepEqual(workflows.reviewer.promotion_gate, {
		requires: ['reviewer_gate_outcome.decision'],
		passing_decisions: ['PASS'],
		blocks_on_missing_evidence: true,
	}, 'reviewer gate blocks promotion without passing evidence');
	assert.equal(controllerSpec.workflows.find((workflow) => workflow.workflow_id === 'revalidation').max_attempts, undefined, 'revalidation attempt bounds belong to Homeboy policy');
	assert.deepEqual(
		controllerSpec.workflows.find((workflow) => workflow.workflow_id === 'revalidation').gates,
		['fallback_blocks', 'conversion_findings', 'visual_parity'],
		'revalidation reruns all quality gates'
	);
	assert.equal(controllerSpec.abilities.some((ability) => ability.ability_id === 'wpsg_materialize_packet'), false, 'controller no longer exposes the WPSG model-facing packet materializer ability');
	assert.doesNotMatch(serialized, /wpsg_materialize_packet|wp-site-generator\/materialize-packet|wpsg_packets/, 'plan no longer uses the custom WPSG packet materializer transport');
	assert.doesNotMatch(serialized, /artifact_refs|artifactReferences|siteSlug|currentTier|validations/, 'plan omits removed compatibility field spellings');

	const executableWorkflowByTaskId = {
		'store-idea-agent': 'store-idea',
		'website-idea-agent': 'website-idea',
		'design-store-packet': 'design-store',
		'design-website-packet': 'design-website',
		'generate-store-candidate': 'static-store',
		'generate-website-candidate': 'static-site',
		'validate-store-candidate': 'static-validation',
		'validate-website-candidate': 'static-validation',
		'gate-store-publication': 'static-publication-gate',
		'gate-website-publication': 'static-publication-gate',
		'publish-store-pr': 'static-publication',
		'publish-website-pr': 'static-publication',
	};
	assert.deepEqual(
		Object.keys(executableWorkflowByTaskId),
		plan.tasks.map((taskItem) => taskItem.task_id),
		'executable plan tasks are all mapped to declared controller workflows'
	);

	for (const taskItem of plan.tasks) {
		const workflowId = executableWorkflowByTaskId[taskItem.task_id];
		const workflow = workflows[workflowId];
		assert.ok(workflow, `${taskItem.task_id} maps to declared controller workflow ${workflowId}`);

		const artifactOutputs = Object.keys(taskItem.executor.config.artifact_outputs || taskItem.executor.config.runtime_task?.input?.artifact_outputs || {});
		for (const artifact of artifactOutputs) {
			assert.ok(workflow.emits.includes(artifact), `${taskItem.task_id} output ${artifact} is declared by ${workflowId}`);
		}

		const dependency = plan.output_dependencies[taskItem.task_id] || { bindings: {} };
		assert.deepEqual(Object.keys(dependency.bindings || {}), workflow.consumes, `${taskItem.task_id} consumes only artifacts declared by ${workflowId}`);
		for (const [artifact, binding] of Object.entries(dependency.bindings || {})) {
			const upstreamWorkflow = executableWorkflowByTaskId[binding.task_id];
			const requiredEdge = controllerSpec.artifact_flow.find((edge) => (
				edge.artifact === artifact
				&& edge.required !== false
				&& edge.from.includes(upstreamWorkflow)
				&& edge.to.includes(workflowId)
			));
			assert.ok(requiredEdge, `${taskItem.task_id} ${artifact} binding follows a declared required controller edge`);
		}
	}

	for (const taskItem of plan.tasks.filter((item) => executableWorkflowByTaskId[item.task_id] === 'static-publication')) {
		const dependency = plan.output_dependencies[taskItem.task_id];
		assert.ok(dependency.depends_on.includes(dependency.bindings.static_site_publish_gate.task_id), `${taskItem.task_id} finalization waits for the declared StaticSitePublishGate task`);
		assert.equal(taskItem.executor.config.runtime_task.input.required_publish_allowed, true, `${taskItem.task_id} enforces the declared publication finalization gate`);
	}

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
		['generate-store-candidate', 'validate-store-candidate', 'gate-store-publication'],
		'PR publication waits for candidate generation, validation, and deterministic gate'
	);
	assert.equal(
		plan.output_dependencies['publish-store-pr'].bindings.import_validation_result.path,
		'/outputs/import_validation_result',
		'PR publication consumes ImportValidationResult'
	);
	assert.equal(
		plan.output_dependencies['publish-store-pr'].bindings.static_site_publish_gate.path,
		'/outputs/static_site_publish_gate',
		'PR publication consumes StaticSitePublishGate'
	);

	for (const taskId of ['design-store-packet', 'design-website-packet']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		const runtimeInput = config.runtime_task.input;
		assert.equal(config.runtime_task.ability, 'datamachine/run-agent-bundle', `${taskId} runs the bundle through a WP Codebox runtime task`);
		assert.deepEqual(runtimeInput.success_completion_outcomes, ['design_packet'], `${taskId} requires DesignPacket completion`);
		assert.match(runtimeInput.prompt, /ConceptPacket/, `${taskId} consumes ConceptPacket`);
		assert.match(runtimeInput.prompt, /DesignPacket typed artifact/, `${taskId} asks for a typed DesignPacket artifact`);
		assert.match(runtimeInput.prompt, /Generation complexity policy:/, `${taskId} records policy guidance in prompt`);
		assert.equal(runtimeInput.complexity_policy.selected_tier, 'foundation', `${taskId} records selected complexity tier`);
		assert.equal(plan.tasks.find((task) => task.task_id === taskId).inputs.complexity_policy.randomness_seed.length, 12, `${taskId} carries reproducible randomness seed`);
		assert.doesNotMatch(runtimeInput.prompt, /create_github_issue/, `${taskId} does not create a design handoff issue`);
		assert.deepEqual(runtimeInput.tool_recorders, [], `${taskId} does not use a packet tool recorder`);
		assert.equal(runtimeInput.artifact_outputs.design_packet.schema, 'wp-site-generator/DesignPacket/v1');
		assert.equal(runtimeInput.engine_data_outputs.design_packet, 'outputs.typed_artifacts.design_packet.payload');
		assert.deepEqual(config.ability_tools, [], `${taskId} does not expose packet ability_tools`);
		assert.deepEqual(config.structured_artifacts[0], {
			schema: 'wp-codebox/structured-artifact/v1',
			name: 'design_packet',
			type: 'DesignPacket',
			payload_schema: 'wp-site-generator/DesignPacket/v1',
			payload: null,
			metadata: { artifact_path: '/artifacts/DesignPacket.json' },
			provenance: { source: 'wp-site-generator' },
		}, `${taskId} declares the typed DesignPacket output contract`);
	}

	for (const taskId of ['store-idea-agent', 'website-idea-agent']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		const runtimeInput = config.runtime_task.input;
		assert.match(runtimeInput.prompt, /ConceptPacket typed artifact/, `${taskId} asks for a typed ConceptPacket artifact`);
		assert.deepEqual(runtimeInput.tool_recorders, [], `${taskId} does not use a packet tool recorder`);
		assert.equal(runtimeInput.engine_data_outputs.concept_packet, 'outputs.typed_artifacts.concept_packet.payload');
		assert.deepEqual(config.ability_tools, [], `${taskId} does not expose packet ability_tools`);
		assert.equal(config.structured_artifacts[0].payload_schema, 'wp-site-generator/ConceptPacket/v1', `${taskId} declares the typed ConceptPacket output schema`);
	}

	for (const taskId of ['generate-store-candidate', 'generate-website-candidate']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		const runtimeInput = config.runtime_task.input;
		assert.deepEqual(runtimeInput.success_completion_outcomes, ['static_site_candidate'], `${taskId} stops at candidate artifact`);
		assert.equal(runtimeInput.success_requires_pr, false, `${taskId} does not publish a PR`);
		assert.equal(runtimeInput.artifact_outputs.static_site_candidate.schema, 'wp-site-generator/StaticSiteCandidate/v1');
		assert.deepEqual(runtimeInput.tool_recorders, [], `${taskId} does not use a packet tool recorder`);
		assert.equal(runtimeInput.engine_data_outputs.static_site_candidate, 'outputs.typed_artifacts.static_site_candidate.payload');
		assert.deepEqual(config.ability_tools, [], `${taskId} does not expose packet ability_tools`);
		assert.match(runtimeInput.prompt, /StaticSiteCandidate typed artifact/, `${taskId} records a StaticSiteCandidate artifact`);
		assert.match(runtimeInput.prompt, /Record the tier, randomness profile, randomness seed/, `${taskId} asks candidate to preserve policy metadata`);
	}

	for (const taskId of ['validate-store-candidate', 'validate-website-candidate']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		const request = plan.tasks.find((task) => task.task_id === taskId);
		assert.deepEqual(request.expected_artifacts, ['ImportValidationResult', 'VisualParityArtifact', 'FindingPacketSet'], `${taskId} requires each declared validation artifact`);
		assert.equal(config.execution_kind, 'wp_codebox_ability', `${taskId} delegates validation to WP Codebox ability bridge`);
		assert.equal(config.ability, 'static-site-importer/import-website-artifact', `${taskId} calls SSI artifact import ability`);
		assert.equal(config.ability_input.artifact, '{{outputs.static_site_candidate}}', `${taskId} passes StaticSiteCandidate as ability input`);
		assert.equal(config.output_mappings.import_validation_result, 'result.import_validation_result', `${taskId} maps SSI validation result`);
		assert.equal(config.output_mappings.visual_parity_artifact, 'result.visual_parity_artifact', `${taskId} maps visual parity artifact`);
		assert.equal(config.output_mappings.finding_packet_set, 'result.finding_packets', `${taskId} maps SSI finding packets to the FindingPacketSet artifact key`);
		assert.equal(config.artifact_outputs.import_validation_result.schema, 'wp-site-generator/ImportValidationResult/v1');
		assert.equal(config.artifact_outputs.visual_parity_artifact.schema, 'wp-site-generator/VisualParityArtifact/v1');
		assert.equal(config.artifact_outputs.finding_packet_set.schema, 'wp-site-generator/FindingPacketSet/v1');
		assert.equal(config.artifact_outputs.finding_packet_set.path, '/artifacts/FindingPacketSet.json');
		assert.equal(config.engine_data_outputs.import_validation_result, 'outputs.import_validation_result', `${taskId} requires mapped validation output`);
		assert.equal(config.engine_data_outputs.visual_parity_artifact, 'outputs.visual_parity_artifact', `${taskId} requires mapped visual parity output`);
		assert.equal(config.engine_data_outputs.finding_packet_set, 'outputs.finding_packet_set', `${taskId} requires mapped finding packet set`);
	}

	for (const taskId of ['gate-store-publication', 'gate-website-publication']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		assert.equal(config.execution_kind, 'node_script', `${taskId} uses deterministic local gate evaluation`);
		assert.equal(config.script, '.github/scripts/evaluate-static-site-publish-gate.mjs', `${taskId} uses the WPSG gate evaluator`);
		assert.equal(config.artifact_outputs.static_site_publish_gate.schema, 'wp-site-generator/StaticSitePublishGate/v1', `${taskId} emits StaticSitePublishGate`);
		assert.equal(config.engine_data_outputs.publish_allowed, 'outputs.static_site_publish_gate.publish_allowed', `${taskId} exposes publish_allowed`);
	}

	for (const taskId of ['publish-store-pr', 'publish-website-pr']) {
		const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
		const runtimeInput = config.runtime_task.input;
		assert.equal(runtimeInput.success_requires_pr, true, `${taskId} is the first GitHub-visible publication step`);
		assert.deepEqual(runtimeInput.success_completion_outcomes, ['static_site_pr'], `${taskId} completes on PR publication`);
		assert.match(runtimeInput.prompt, /ImportValidationResult/, `${taskId} consumes import validation metrics`);
		assert.match(runtimeInput.prompt, /StaticSitePublishGate/, `${taskId} consumes the deterministic publish gate`);
		assert.equal(runtimeInput.required_publish_allowed, true, `${taskId} requires publish_allowed=true`);
		assert.equal(runtimeInput.publish_gate, '{{outputs.static_site_publish_gate}}', `${taskId} receives the publish gate artifact`);
		assert.match(runtimeInput.prompt, /render-static-site-pr-body\.mjs/, `${taskId} renders initial PR body metrics`);
	}

  const staticPipeline = JSON.parse(await readFile(path.join(repoRoot, 'bundles/static-site-agent/pipelines/static-site-pipeline.json'), 'utf8'));
  const staticAiStep = staticPipeline.steps.find((step) => step.step_type === 'ai');
  assert.match(staticAiStep.step_config.system_prompt, /preserve the remaining title text verbatim/, 'static agent preserves full source concept title text');
  assert.match(staticAiStep.step_config.system_prompt, /full source concept title without its leading emoji\/icon marker/, 'static agent PR title formula keeps full source concept title');

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
			HOMEBOY_AGENT_RUNTIME_BIN: explicitCodeboxPath,
		},
	});
	assert.equal(explicitCodeboxResult.status, 0, explicitCodeboxResult.stderr || explicitCodeboxResult.stdout);
  const explicitCodeboxPlan = JSON.parse(await readFile(explicitCodeboxPlanPath, 'utf8'));
  assert.equal(explicitCodeboxPlan.tasks[0].executor.config.runtime_bin, explicitCodeboxPath, 'explicit runtime binary path is preserved');

  const explicitProviderPlanPath = path.join(tempDir, 'plan-provider.json');
  const explicitProviderResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_RUN_ID: '412',
      HOMEBOY_PLAN_PATH: explicitProviderPlanPath,
      HOMEBOY_AGENT_RUNTIME_PROVIDER: 'opencode',
      HOMEBOY_AGENT_RUNTIME_MODEL: 'opencode-go/kimi-k2.6',
      HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGIN_PATHS: '/runner/ai-provider-for-opencode-current',
      HOMEBOY_AGENT_RUNTIME_SECRET_ENV: 'OPENCODE_API_KEY,GITHUB_TOKEN',
      HOMEBOY_AGENT_RUNTIME_ENV: JSON.stringify({ XDG_CONFIG_HOME: '/runtime/config', XDG_STATE_HOME: '/runtime/state' }),
      HOMEBOY_AGENT_RUNTIME_CONFIG_MOUNTS: JSON.stringify([{ source: '/runner/config', target: '/runtime/config', mode: 'readonly' }]),
      HOMEBOY_AGENT_RUNTIME_STATE_MOUNTS: JSON.stringify([{ source: '/runner/state', target: '/runtime/state', mode: 'readonly' }]),
    },
  });
  assert.equal(explicitProviderResult.status, 0, explicitProviderResult.stderr || explicitProviderResult.stdout);
  const explicitProviderPlan = JSON.parse(await readFile(explicitProviderPlanPath, 'utf8'));
  const explicitProviderConfig = explicitProviderPlan.tasks[0].executor.config;
  assert.equal(explicitProviderConfig.provider, 'opencode', 'explicit provider override is preserved');
  assert.equal(explicitProviderConfig.model, 'opencode-go/kimi-k2.6', 'explicit provider model override is preserved');
  assert.equal(explicitProviderConfig.runtime_task.input.provider, 'opencode', 'explicit provider override is passed to runtime task');
  assert.equal(explicitProviderConfig.runtime_task.input.model, 'opencode-go/kimi-k2.6', 'explicit model override is passed to runtime task');
  assert.deepEqual(explicitProviderConfig.provider_plugin_paths, ['/runner/ai-provider-for-opencode-current'], 'explicit provider plugin override is preserved');
  assert.deepEqual(explicitProviderConfig.secret_env, ['OPENCODE_API_KEY', 'GITHUB_TOKEN'], 'explicit secret env override is preserved');
  assert.deepEqual(explicitProviderPlan.tasks[0].executor.secret_env, ['OPENCODE_API_KEY', 'GITHUB_TOKEN'], 'explicit secret env is declared for Homeboy provider hydration');
  assert.deepEqual(explicitProviderConfig.runtime_env, { XDG_CONFIG_HOME: '/runtime/config', XDG_STATE_HOME: '/runtime/state' }, 'explicit runtime env override is preserved');
  assert.deepEqual(explicitProviderConfig.runtime_config_mounts, [{ source: '/runner/config', target: '/runtime/config', mode: 'readonly' }], 'explicit runtime config mounts are preserved');
  assert.deepEqual(explicitProviderConfig.runtime_state_mounts, [{ source: '/runner/state', target: '/runtime/state', mode: 'readonly' }], 'explicit runtime state mounts are preserved');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation plan smoke passed');
