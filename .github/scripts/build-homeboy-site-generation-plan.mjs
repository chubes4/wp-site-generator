#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	applyHomeboyAgentRuntimeOverrides,
	requireLocalReplaySeed,
	readHomeboyAgentRuntimeOverrides,
	resolveReplayRunId,
	writeJsonFile,
} from './lib/ci-runtime-utils.mjs';
import {
	evaluateComplexityPolicy,
	loadPolicy,
	loadQualitySignals,
	policyPrompt,
	resolvePolicyInputs,
} from './site-generation-complexity-policy.mjs';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
requireLocalReplaySeed(process.env);
const runId = resolveReplayRunId(process.env);
const repository = process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const outputPath = process.env.HOMEBOY_PLAN_PATH || path.join(root, '.ci', 'site-generation-loop.agent-task-plan.json');
const loopDefinitionOutputPath = process.env.HOMEBOY_LOOP_DEFINITION_PATH || defaultLoopDefinitionPath(outputPath);
const controllerSpecPath = process.env.HOMEBOY_CONTROLLER_SPEC_PATH || '.github/homeboy/controllers/static-site-generation-loop.controller.json';
const controllerContract = 'wp-site-generator/static-site-generation-loop';
const controllerAuthority = {
	spec: controllerSpecPath,
	contract: controllerContract,
	builder: '.github/scripts/build-homeboy-ssi-loop-controller.mjs',
};
const manualTaskKind = process.env.HOMEBOY_TASK_KIND || '';
const planId = manualTaskKind ? `site-generator-${manualTaskKind}-${runId}` : `site-generation-loop-${runId}`;
const groupKey = manualTaskKind ? `site-generator-${manualTaskKind}` : 'site-generation-loop';
const homeboyBin = process.env.HOMEBOY_BIN || 'homeboy';

const ci = (name) => `.ci/${name}`;
const artifactsRoot = process.env.HOMEBOY_ARTIFACT_ROOT || '.ci/homeboy-agent-task-artifacts';
const runtimeOverrides = readHomeboyAgentRuntimeOverrides(process.env);
const policyInputs = resolvePolicyInputs({ root });
const complexityPolicy = loadPolicy(policyInputs.policyPath);
const qualitySignals = loadQualitySignals(policyInputs.qualitySignalsPath);
const complexityDecision = evaluateComplexityPolicy({
	policy: complexityPolicy,
	qualitySignals,
	runId,
	overrides: policyInputs.overrides,
});
const complexityTaskInput = {
	complexity_policy: complexityDecision,
};

function defaultLoopDefinitionPath(planPath) {
  if (/\.agent-task-plan\.json$/.test(planPath)) {
    return planPath.replace(/\.agent-task-plan\.json$/, '.loop-definition.json');
  }
  return `${planPath}.loop-definition.json`;
}

function taskOutputPath(field) {
  return `/outputs/${field}`;
}

function loopDefinitionTask(request, dependencies = {}) {
  const taskDefinition = {
    task_id: request.task_id,
    request,
  };
  if ((dependencies.depends_on || []).length > 0) {
    taskDefinition.depends_on = dependencies.depends_on;
  }
  if (Object.keys(dependencies.bindings || {}).length > 0) {
    taskDefinition.bindings = dependencies.bindings;
  }
  return taskDefinition;
}

function compileLoopDefinitionFile(definitionPath) {
  assertCompileLoopAvailable();
  const result = spawnSync(homeboyBin, ['agent-task', 'compile-loop', '--definition', `@${definitionPath}`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`homeboy agent-task compile-loop failed:\n${result.stderr || result.stdout}`);
  }
  const output = JSON.parse(result.stdout);
  if (output?.data?.schema === 'homeboy/agent-task-plan/v1') {
    return output.data;
  }
  if (output?.value?.schema === 'homeboy/agent-task-plan/v1') {
    return output.value;
  }
  return output;
}

function assertCompileLoopAvailable() {
	const result = spawnSync(homeboyBin, ['agent-task', 'compile-loop', '--help'], {
		cwd: root,
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error([
			'Homeboy agent-task compile-loop is required to build the WPSG site-generation plan.',
			'This branch intentionally does not fall back to repo-local loop compilation shims.',
			'Install/use a Homeboy build from Extra-Chill/homeboy main that includes `agent-task compile-loop`, then rerun.',
			(result.stderr || result.stdout || '').trim(),
		].filter(Boolean).join('\n'));
	}
}

function loopDefinition({ tasks, outputDependencies = {}, options, metadata }) {
  return {
    schema: 'homeboy/agent-task-loop-definition/v1',
    loop_id: controllerContract,
    plan_id: planId,
    group_key: groupKey,
    tasks: tasks.map((request) => loopDefinitionTask(request, outputDependencies[request.task_id])),
    options,
    metadata,
  };
}

function datamachineConfig({
	bundle,
	agent,
	pipeline,
	flow,
	prompt = '',
	successRequiresPr = false,
	successCompletionOutcomes = [],
	artifactOutputs = {},
	maxTurns,
	stepBudget,
	timeBudgetMs,
	flowStepPatches = [],
	abilityTools = [],
	toolRecorders = [],
  engineDataOutputs = {},
  transcriptArtifactName,
  complexityPolicy: taskComplexityPolicy,
  structuredArtifacts = [],
}) {
  const runtimeBundlePath = `/workspace/wp-site-generator/${bundle}`;
  const runtimeTaskInput = {
    source: runtimeBundlePath,
    agent_slug: agent,
    pipeline_slug: pipeline,
    flow_slug: flow,
    target_repo: repository,
    prompt,
		wait_for_completion: true,
		success_requires_pr: successRequiresPr,
		success_completion_outcomes: successCompletionOutcomes,
		artifact_outputs: artifactOutputs,
		flow_step_patches: flowStepPatches,
    tool_recorders: toolRecorders,
    engine_data_outputs: engineDataOutputs,
    transcript_artifact_name: transcriptArtifactName,
    artifacts: path.join(artifactsRoot, agent, transcriptArtifactName || flow),
  };

  const config = {
    runtime_component_paths: {
      agents_api: ci('agents-api'),
      agent_runtime: ci('data-machine'),
      agent_runtime_tools: ci('data-machine-code'),
    },
    component_contracts: [{ slug: 'wp-site-generator', path: '.', activate: true }],
    homeboy_extensions: `${ci('homeboy-extensions')}/wordpress`,
    agent_bundles: [{ source: runtimeBundlePath, slug: agent }],
    runtime_task: {
      ability: 'datamachine/run-agent-bundle',
      input: runtimeTaskInput,
    },
    ability_tools: abilityTools,
    structured_artifacts: structuredArtifacts,
  };

  applyHomeboyAgentRuntimeOverrides(config, runtimeTaskInput, runtimeOverrides);

	if (taskComplexityPolicy) {
		runtimeTaskInput.complexity_policy = taskComplexityPolicy;
	}

  if (maxTurns) {
    config.max_turns = maxTurns;
    runtimeTaskInput.max_turns = maxTurns;
  }
  if (stepBudget) {
    runtimeTaskInput.step_budget = stepBudget;
  }
  if (timeBudgetMs) {
    runtimeTaskInput.time_budget_ms = timeBudgetMs;
    config.task_timeout_seconds = Math.ceil(timeBudgetMs / 1000) + 300;
  }

  return config;
}

function task({ id, title, config, instructions, expectedArtifacts = ['datamachine-transcript'], inputs = {} }) {
  return {
    schema: 'homeboy/agent-task-request/v1',
    task_id: id,
    group_key: groupKey,
    parent_plan_id: planId,
    executor: {
      backend: 'codebox',
      ...(Array.isArray(config.secret_env) && config.secret_env.length > 0 ? { secret_env: config.secret_env } : {}),
      config,
    },
    instructions,
    inputs: { title, ...inputs },
    limits: {
      task_timeout_seconds: config.task_timeout_seconds || 900,
    },
    expected_artifacts: expectedArtifacts,
  };
}

function artifactOutput(schema, fileName) {
	return {
		schema,
		path: `/artifacts/${fileName}`,
	};
}

const conceptPacketOutput = artifactOutput('wp-site-generator/ConceptPacket/v1', 'ConceptPacket.json');
const designPacketOutput = artifactOutput('wp-site-generator/DesignPacket/v1', 'DesignPacket.json');
const staticSiteCandidateOutput = artifactOutput('wp-site-generator/StaticSiteCandidate/v1', 'StaticSiteCandidate.json');
const importValidationResultOutput = artifactOutput('wp-site-generator/ImportValidationResult/v1', 'ImportValidationResult.json');
const visualParityArtifactOutput = artifactOutput('wp-site-generator/VisualParityArtifact/v1', 'VisualParityArtifact.json');
const findingPacketSetOutput = artifactOutput('wp-site-generator/FindingPacketSet/v1', 'FindingPacketSet.json');
const staticSitePublishGateOutput = artifactOutput('wp-site-generator/StaticSitePublishGate/v1', 'StaticSitePublishGate.json');

const packetArtifactSpecs = {
	concept_packet: {
		type: 'ConceptPacket',
		schema: 'wp-site-generator/ConceptPacket/v1',
		file: 'ConceptPacket.json',
	},
	design_packet: {
		type: 'DesignPacket',
		schema: 'wp-site-generator/DesignPacket/v1',
		file: 'DesignPacket.json',
	},
	static_site_candidate: {
		type: 'StaticSiteCandidate',
		schema: 'wp-site-generator/StaticSiteCandidate/v1',
		file: 'StaticSiteCandidate.json',
	},
	import_validation_result: {
		type: 'ImportValidationResult',
		schema: 'wp-site-generator/ImportValidationResult/v1',
		file: 'ImportValidationResult.json',
	},
	static_site_publish_gate: {
		type: 'StaticSitePublishGate',
		schema: 'wp-site-generator/StaticSitePublishGate/v1',
		file: 'StaticSitePublishGate.json',
	},
};

function artifactBinding(taskId, field, required = true) {
	return {
		task_id: taskId,
		path: taskOutputPath(field),
		required,
	};
}

const prRecorder = [
  {
    tool: 'github_pull_request_publish',
    record: {
      tool_results_key: 'github_tool_results',
      engine_key: 'static_site_agent',
      fields: {
        pr_url: 'data.html_url',
        branch: 'data.head',
        slug: {
          paths: ['data.head'],
          strip_prefix: 'static/',
        },
      },
    },
  },
];

function typedPacketArtifact(packetKey) {
	const spec = packetArtifactSpecs[packetKey];
	return {
		schema: 'wp-codebox/structured-artifact/v1',
		name: packetKey,
		type: spec.type,
		payload_schema: spec.schema,
		payload: null,
		metadata: {
			artifact_path: `/artifacts/${spec.file}`,
		},
		provenance: {
			source: 'wp-site-generator',
		},
	};
}

function packetDatamachineConfig({ packetKey, ...config }) {
	const spec = packetArtifactSpecs[packetKey];
	return datamachineConfig({
		...config,
		artifactOutputs: {
			[packetKey]: artifactOutput(spec.schema, spec.file),
		},
		structuredArtifacts: [typedPacketArtifact(packetKey)],
		engineDataOutputs: {
			[packetKey]: `outputs.typed_artifacts.${packetKey}.payload`,
		},
	});
}

const conceptPacketPrompt = 'Generate one buildable ConceptPacket typed artifact using schema wp-site-generator/ConceptPacket/v1 with concept_packet as the output key. Include schema_version, concept kind, title, body sections, lane labels, target lane, and source provenance. Homeboy owns orchestration and GitHub publication happens after a validated StaticSiteCandidate exists.';
const loopDesignPrompt = 'Consume ConceptPacket {{outputs.concept_packet}} and produce one DesignPacket typed artifact using schema wp-site-generator/DesignPacket/v1 with design_packet as the output key. Preserve the concept title, body sections, lane labels, and provenance. Include palette, typography, layout direction, mood, accessibility notes, and any implementation constraints needed by the static-site candidate generator.';
const loopCandidatePrompt = 'Consume ConceptPacket {{outputs.concept_packet}} and DesignPacket {{outputs.design_packet}}, then produce one StaticSiteCandidate typed artifact using schema wp-site-generator/StaticSiteCandidate/v1 with static_site_candidate as the output key. Include generated files, metadata, branch/title proposal, and reproduction context. Validation runs before publication.';
const loopPublishPrompt = 'Consume StaticSiteCandidate {{outputs.static_site_candidate}}, ImportValidationResult {{outputs.import_validation_result}}, and StaticSitePublishGate {{outputs.static_site_publish_gate}}. Publish exactly one static-site PR only when static_site_publish_gate.publish_allowed is true. Use the candidate files and metadata as source of truth. Render the PR body with .github/scripts/render-static-site-pr-body.mjs so the initial PR body includes the import validation summary, fallback block count, conversion finding counts, explicit publication gate results, and artifact references.';

function storeIdeaTask({ id = 'store-idea-agent', flow = 'store-idea-artifact-flow', prompt = ' ', title = 'Generate store idea', lane = 'store concept lane' } = {}) {
	const lanePolicyPrompt = policyPrompt(complexityDecision, lane);
	const taskPrompt = [conceptPacketPrompt, prompt].filter(Boolean).join('\n\n');
	return task({
		id,
		title,
		instructions: 'Generate one store concept as a typed ConceptPacket artifact.',
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'ConceptPacket'],
		config: packetDatamachineConfig({
			packetKey: 'concept_packet',
			bundle: 'bundles/store-idea-agent',
			agent: 'store-idea-agent',
			pipeline: 'store-idea-artifact-pipeline',
			flow,
			prompt: [taskPrompt, lanePolicyPrompt].join('\n\n'),
			successRequiresPr: false,
			successCompletionOutcomes: ['concept_packet'],
			maxTurns: 6,
			stepBudget: 8,
			timeBudgetMs: 180000,
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}


function websiteIdeaTask({ id = 'website-idea-agent', flow = 'website-idea-artifact-flow', prompt = '', title = 'Generate website idea', lane = 'website concept lane' } = {}) {
	const lanePolicyPrompt = policyPrompt(complexityDecision, lane);
	const taskPrompt = [conceptPacketPrompt, prompt].filter(Boolean).join('\n\n');
	return task({
		id,
		title,
		instructions: 'Generate one website concept as a typed ConceptPacket artifact.',
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'ConceptPacket'],
		config: packetDatamachineConfig({
			packetKey: 'concept_packet',
			bundle: 'bundles/website-idea-agent',
			agent: 'website-idea-agent',
			pipeline: 'website-idea-artifact-pipeline',
			flow,
			prompt: [taskPrompt, lanePolicyPrompt].join('\n\n'),
			successRequiresPr: false,
			successCompletionOutcomes: ['concept_packet'],
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}

function designTask({ id, conceptPacket = '{{outputs.concept_packet}}', title, lane = 'design lane' }) {
	const prompt = [`Consume ConceptPacket ${conceptPacket} and produce one DesignPacket typed artifact using schema wp-site-generator/DesignPacket/v1 with design_packet as the output key. Preserve source concept identity and lane metadata.`, policyPrompt(complexityDecision, lane)].join('\n\n');
	return task({
		id,
		title,
		instructions: prompt,
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'DesignPacket'],
		config: packetDatamachineConfig({
			packetKey: 'design_packet',
			bundle: 'bundles/design-agent',
			agent: 'design-agent',
			pipeline: 'design-artifact-pipeline',
			flow: 'design-artifact-flow',
			prompt,
			successRequiresPr: false,
			successCompletionOutcomes: ['design_packet'],
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}

function staticSiteCandidateTask({ id, conceptPacket = '{{outputs.concept_packet}}', designPacket = '{{outputs.design_packet}}', title, lane = 'static-site candidate lane' }) {
	const prompt = [`Consume ConceptPacket ${conceptPacket} and DesignPacket ${designPacket}. Produce one StaticSiteCandidate typed artifact using schema wp-site-generator/StaticSiteCandidate/v1 with static_site_candidate as the output key. Include generated files, metadata, branch/title proposal, and reproduction context.`, policyPrompt(complexityDecision, lane)].join('\n\n');
	return task({
		id,
		title,
		instructions: prompt,
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'StaticSiteCandidate'],
		config: packetDatamachineConfig({
			packetKey: 'static_site_candidate',
			bundle: 'bundles/static-site-agent',
			agent: 'static-site-agent',
			pipeline: 'static-site-candidate-pipeline',
			flow: 'static-site-candidate-flow',
			prompt,
			successRequiresPr: false,
			successCompletionOutcomes: ['static_site_candidate'],
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}

function importValidationTask({ id, title, candidate = '{{outputs.static_site_candidate}}' }) {
	return task({
		id,
		title,
		instructions: `Import and validate StaticSiteCandidate ${candidate}. Emit one ImportValidationResult artifact with pass/fail summary, fallback block count, conversion finding counts, and artifact references.`,
		expectedArtifacts: ['ImportValidationResult', 'VisualParityArtifact', 'FindingPacketSet'],
		config: {
			execution_kind: 'wp_codebox_ability',
			ability: 'static-site-importer/import-website-artifact',
			ability_input: {
				artifact: candidate,
			},
			output_mappings: {
				import_validation_result: 'result.import_validation_result',
				visual_parity_artifact: 'result.visual_parity_artifact',
				finding_packet_set: 'result.finding_packets',
			},
			artifact_outputs: {
				import_validation_result: importValidationResultOutput,
				visual_parity_artifact: visualParityArtifactOutput,
				finding_packet_set: findingPacketSetOutput,
			},
			engine_data_outputs: {
				import_validation_result: 'outputs.import_validation_result',
				visual_parity_artifact: 'outputs.visual_parity_artifact',
				finding_packet_set: 'outputs.finding_packet_set',
			},
			task_timeout_seconds: 1800,
		},
	});
}

function staticSitePublishGateTask({ id, title, validation = '{{outputs.import_validation_result}}', visualParity = '{{outputs.visual_parity_artifact}}' }) {
	return task({
		id,
		title,
		instructions: `Evaluate deterministic publication gates from ImportValidationResult ${validation} and VisualParityArtifact ${visualParity}. Emit StaticSitePublishGate with publish_allowed plus pass/fail fields for fallback_blocks, conversion_findings, and visual_parity.`,
		expectedArtifacts: ['StaticSitePublishGate'],
		config: {
			execution_kind: 'node_script',
			script: '.github/scripts/evaluate-static-site-publish-gate.mjs',
			inputs: {
				import_validation_result: validation,
				visual_parity_artifact: visualParity,
			},
			artifact_outputs: {
				static_site_publish_gate: staticSitePublishGateOutput,
			},
			engine_data_outputs: {
				static_site_publish_gate: 'outputs.static_site_publish_gate',
				publish_allowed: 'outputs.static_site_publish_gate.publish_allowed',
			},
		},
	});
}

function staticSitePublishTask({ id, title, candidate = '{{outputs.static_site_candidate}}', validation = '{{outputs.import_validation_result}}', publishGate = '{{outputs.static_site_publish_gate}}' }) {
	const prompt = `Publish StaticSiteCandidate ${candidate} after reading ImportValidationResult ${validation} and StaticSitePublishGate ${publishGate}. Continue only when the deterministic gate has publish_allowed=true. Create one static-site PR with candidate files, and render the initial PR body with validation metrics and gate results from .github/scripts/render-static-site-pr-body.mjs.`;
	const config = datamachineConfig({
		bundle: 'bundles/static-site-agent',
		agent: 'static-site-agent',
		pipeline: 'static-site-publish-pipeline',
		flow: 'static-site-publish-flow',
		prompt,
		successRequiresPr: true,
		successCompletionOutcomes: ['static_site_pr'],
		toolRecorders: prRecorder,
		engineDataOutputs: {
			static_site_pr_url: 'metadata.engine_data.static_site_agent.pr_url',
			static_site_branch: 'metadata.engine_data.static_site_agent.branch',
			static_site_slug: 'metadata.engine_data.static_site_agent.slug',
		},
		transcriptArtifactName: `${id}-transcript-${runId}`,
	});
	config.runtime_task.input.publish_gate = publishGate;
	config.runtime_task.input.publish_allowed_path = `${publishGate}.publish_allowed`;
	config.runtime_task.input.required_publish_allowed = true;
	return task({
		id,
		title,
		instructions: prompt,
		expectedArtifacts: ['datamachine-transcript', 'datamachine-pull-request'],
		config,
	});
}

function manualLoopDefinition() {
	const conceptPrompt = process.env.CONCEPT_PROMPT || '';
	const conceptPacket = process.env.CONCEPT_PACKET || '';
	const designPacket = process.env.DESIGN_PACKET || '';
	const staticSiteCandidate = process.env.STATIC_SITE_CANDIDATE || '';
	const importValidationResult = process.env.IMPORT_VALIDATION_RESULT || '';
	const staticSitePublishGate = process.env.STATIC_SITE_PUBLISH_GATE || '';
	const websiteFlow = process.env.WEBSITE_FLOW_SLUG || 'website-idea-artifact-flow';
	const taskByKind = {
		store_idea: () => storeIdeaTask({ id: 'store-idea-agent', flow: 'store-idea-artifact-flow', prompt: conceptPrompt, title: 'Generate store idea' }),
		website_idea: () => websiteIdeaTask({ id: 'website-idea-agent', flow: websiteFlow, prompt: conceptPrompt, title: 'Generate website idea' }),
		design: () => designTask({ id: 'design-agent', conceptPacket, title: 'Generate design packet' }),
		generate_candidate: () => staticSiteCandidateTask({ id: 'static-site-candidate-agent', conceptPacket, designPacket, title: 'Generate static site candidate' }),
		publish_pr: () => staticSitePublishTask({ id: 'static-site-publish-agent', candidate: staticSiteCandidate, validation: importValidationResult, publishGate: staticSitePublishGate, title: 'Publish static site PR' }),
	};

	if (!taskByKind[manualTaskKind]) {
		throw new Error(`Unsupported HOMEBOY_TASK_KIND: ${manualTaskKind}`);
	}
	if (manualTaskKind === 'design' && !conceptPacket) {
		throw new Error('CONCEPT_PACKET is required for design.');
	}
	if (manualTaskKind === 'generate_candidate' && (!conceptPacket || !designPacket)) {
		throw new Error('CONCEPT_PACKET and DESIGN_PACKET are required for generate_candidate.');
	}
	if (manualTaskKind === 'publish_pr' && (!staticSiteCandidate || !importValidationResult || !staticSitePublishGate)) {
		throw new Error('STATIC_SITE_CANDIDATE, IMPORT_VALIDATION_RESULT, and STATIC_SITE_PUBLISH_GATE are required for publish_pr.');
	}

  return loopDefinition({
    tasks: [taskByKind[manualTaskKind]()],
    options: {
      max_concurrency: 1,
      resource_budget: {
        max_active_units: 1,
        default_task_units: 1,
      },
      retry: {
        max_attempts: 0,
      },
    },
		metadata: {
			source: 'wp-site-generator manual agent task',
			task_kind: manualTaskKind,
			artifact_driven: true,
			controller_spec: controllerSpecPath,
			controller_contract: controllerContract,
			controller_authority: controllerAuthority,
			runtime_input_contract: runtimeOverrides.source,
			complexity_policy: complexityDecision,
			generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
		},
	});
}

const boundedMaxConcurrency = Math.max(
	1,
	Math.min(
		Number(process.env.HOMEBOY_MAX_CONCURRENCY || complexityDecision.target_parallel_candidates || 1),
		Number(complexityDecision.target_parallel_candidates || 1)
	)
);

const loopTasks = [
		storeIdeaTask({ prompt: ' ', title: 'Generate store idea', lane: 'store concept lane' }),
		websiteIdeaTask({ prompt: ' ', title: 'Generate website idea', lane: 'website concept lane' }),
		task({
			id: 'design-store-packet',
			title: 'Design store concept packet',
			instructions: loopDesignPrompt,
			inputs: complexityTaskInput,
			expectedArtifacts: ['datamachine-transcript', 'DesignPacket'],
			config: packetDatamachineConfig({
				packetKey: 'design_packet',
				bundle: 'bundles/design-agent',
				agent: 'design-agent',
				pipeline: 'design-artifact-pipeline',
				flow: 'design-artifact-flow',
				prompt: [loopDesignPrompt, policyPrompt(complexityDecision, 'store design lane')].join('\n\n'),
				successRequiresPr: false,
				successCompletionOutcomes: ['design_packet'],
				transcriptArtifactName: `design-agent-store-transcript-${runId}`,
				complexityPolicy: complexityDecision,
			}),
		}),
		task({
			id: 'design-website-packet',
			title: 'Design website concept packet',
			instructions: loopDesignPrompt,
			inputs: complexityTaskInput,
			expectedArtifacts: ['datamachine-transcript', 'DesignPacket'],
			config: packetDatamachineConfig({
				packetKey: 'design_packet',
				bundle: 'bundles/design-agent',
				agent: 'design-agent',
				pipeline: 'design-artifact-pipeline',
				flow: 'design-artifact-flow',
				prompt: [loopDesignPrompt, policyPrompt(complexityDecision, 'website design lane')].join('\n\n'),
				successRequiresPr: false,
				successCompletionOutcomes: ['design_packet'],
				transcriptArtifactName: `design-agent-website-transcript-${runId}`,
				complexityPolicy: complexityDecision,
			}),
		}),
		staticSiteCandidateTask({ id: 'generate-store-candidate', title: 'Generate store static-site candidate', lane: 'store candidate lane' }),
		staticSiteCandidateTask({ id: 'generate-website-candidate', title: 'Generate website static-site candidate', lane: 'website candidate lane' }),
		importValidationTask({ id: 'validate-store-candidate', title: 'Validate store static-site candidate' }),
		importValidationTask({ id: 'validate-website-candidate', title: 'Validate website static-site candidate' }),
		staticSitePublishGateTask({ id: 'gate-store-publication', title: 'Gate store static-site publication' }),
		staticSitePublishGateTask({ id: 'gate-website-publication', title: 'Gate website static-site publication' }),
		staticSitePublishTask({ id: 'publish-store-pr', title: 'Publish store static-site PR' }),
		staticSitePublishTask({ id: 'publish-website-pr', title: 'Publish website static-site PR' }),
];

const loopOutputDependencies = {
		'design-store-packet': {
			bindings: {
				concept_packet: artifactBinding('store-idea-agent', 'concept_packet'),
			},
		},
		'design-website-packet': {
			bindings: {
				concept_packet: artifactBinding('website-idea-agent', 'concept_packet'),
			},
		},
		'generate-store-candidate': {
			depends_on: ['design-store-packet'],
			bindings: {
				concept_packet: artifactBinding('store-idea-agent', 'concept_packet'),
				design_packet: artifactBinding('design-store-packet', 'design_packet'),
			},
		},
		'generate-website-candidate': {
			depends_on: ['design-website-packet'],
			bindings: {
				concept_packet: artifactBinding('website-idea-agent', 'concept_packet'),
				design_packet: artifactBinding('design-website-packet', 'design_packet'),
			},
		},
		'validate-store-candidate': {
			depends_on: ['generate-store-candidate'],
			bindings: {
				static_site_candidate: artifactBinding('generate-store-candidate', 'static_site_candidate'),
			},
		},
		'validate-website-candidate': {
			depends_on: ['generate-website-candidate'],
			bindings: {
				static_site_candidate: artifactBinding('generate-website-candidate', 'static_site_candidate'),
			},
		},
		'publish-store-pr': {
			depends_on: ['generate-store-candidate', 'validate-store-candidate', 'gate-store-publication'],
			bindings: {
				static_site_candidate: artifactBinding('generate-store-candidate', 'static_site_candidate'),
				import_validation_result: artifactBinding('validate-store-candidate', 'import_validation_result'),
				static_site_publish_gate: artifactBinding('gate-store-publication', 'static_site_publish_gate'),
			},
		},
		'publish-website-pr': {
			depends_on: ['generate-website-candidate', 'validate-website-candidate', 'gate-website-publication'],
			bindings: {
				static_site_candidate: artifactBinding('generate-website-candidate', 'static_site_candidate'),
				import_validation_result: artifactBinding('validate-website-candidate', 'import_validation_result'),
				static_site_publish_gate: artifactBinding('gate-website-publication', 'static_site_publish_gate'),
			},
		},
		'gate-store-publication': {
			depends_on: ['validate-store-candidate'],
			bindings: {
				import_validation_result: artifactBinding('validate-store-candidate', 'import_validation_result'),
				visual_parity_artifact: artifactBinding('validate-store-candidate', 'visual_parity_artifact'),
			},
		},
		'gate-website-publication': {
			depends_on: ['validate-website-candidate'],
			bindings: {
				import_validation_result: artifactBinding('validate-website-candidate', 'import_validation_result'),
				visual_parity_artifact: artifactBinding('validate-website-candidate', 'visual_parity_artifact'),
			},
		},
};

const normalLoopDefinition = loopDefinition({
  tasks: loopTasks,
  outputDependencies: loopOutputDependencies,
  options: {
    max_concurrency: boundedMaxConcurrency,
    resource_budget: {
      max_active_units: boundedMaxConcurrency,
      default_task_units: 1,
    },
    retry: {
      max_attempts: 0,
    },
  },
	metadata: {
		source: 'wp-site-generator site-generation-loop',
		artifact_driven: true,
		artifact_stages: ['ConceptPacket', 'DesignPacket', 'StaticSiteCandidate', 'ImportValidationResult', 'StaticSitePublishGate'],
		publication_evidence_outputs: ['StaticSitePullRequest'],
		controller_spec: controllerSpecPath,
		controller_contract: controllerContract,
		controller_authority: controllerAuthority,
		runtime_input_contract: runtimeOverrides.source,
		complexity_policy: complexityDecision,
		generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
	},
});

const definition = manualTaskKind ? manualLoopDefinition() : normalLoopDefinition;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(loopDefinitionOutputPath), { recursive: true });
await writeJsonFile(loopDefinitionOutputPath, definition);
const plan = compileLoopDefinitionFile(loopDefinitionOutputPath);
await writeJsonFile(outputPath, plan);
console.log(outputPath);
