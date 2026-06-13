#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
	evaluateComplexityPolicy,
	loadPolicy,
	loadQualitySignals,
	policyPrompt,
	resolvePolicyInputs,
} from './site-generation-complexity-policy.mjs';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const repository = process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const outputPath = process.env.HOMEBOY_PLAN_PATH || path.join(root, '.ci', 'site-generation-loop.agent-task-plan.json');
const controllerSpecPath = process.env.HOMEBOY_CONTROLLER_SPEC_PATH || '.github/homeboy/controllers/static-site-generation-loop.controller.json';
const manualTaskKind = process.env.HOMEBOY_TASK_KIND || '';
const planId = manualTaskKind ? `site-generator-${manualTaskKind}-${runId}` : `site-generation-loop-${runId}`;
const groupKey = manualTaskKind ? `site-generator-${manualTaskKind}` : 'site-generation-loop';

const ci = (name) => path.join(root, '.ci', name);
const wpCodeboxBin = process.env.HOMEBOY_WP_CODEBOX_BIN || '';
const artifactsRoot = process.env.HOMEBOY_ARTIFACT_ROOT || path.join(root, '.ci', 'homeboy-agent-task-artifacts');
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

function taskOutputPath(field) {
  return `/outputs/${field}`;
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
	toolRecorders = [],
  engineDataOutputs = {},
  transcriptArtifactName,
  complexityPolicy: taskComplexityPolicy,
}) {
  const config = {
    execution_kind: 'datamachine_bundle',
    provider: 'openai',
    model,
    provider_plugin_paths: [ci('ai-provider-for-openai')],
    agents_api: ci('agents-api'),
    data_machine: ci('data-machine'),
    data_machine_code: ci('data-machine-code'),
    homeboy_extensions: path.join(ci('homeboy-extensions'), 'wordpress'),
    bundle_host_path: path.join(root, bundle),
    bundle_path: `/workspace/wp-site-generator/${bundle}`,
    agent_slug: agent,
    pipeline_slug: pipeline,
    flow_slug: flow,
    target_repo: repository,
    prompt,
		success_requires_pr: successRequiresPr,
		success_completion_outcomes: successCompletionOutcomes,
		artifact_outputs: artifactOutputs,
		flow_step_patches: flowStepPatches,
    tool_recorders: toolRecorders,
    engine_data_outputs: engineDataOutputs,
    transcript_artifact_name: transcriptArtifactName,
    secret_env: ['OPENAI_API_KEY', 'GITHUB_TOKEN'],
    artifacts: path.join(artifactsRoot, agent, transcriptArtifactName || flow),
  };

  if (wpCodeboxBin) {
    config.wp_codebox_bin = wpCodeboxBin;
  }

	if (taskComplexityPolicy) {
		config.complexity_policy = taskComplexityPolicy;
	}

  if (maxTurns) {
    config.max_turns = maxTurns;
  }
  if (stepBudget) {
    config.step_budget = stepBudget;
  }
  if (timeBudgetMs) {
    config.time_budget_ms = timeBudgetMs;
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
      model,
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

const conceptPacketPrompt = 'Generate one buildable concept and emit a ConceptPacket artifact. Include title, body sections, lane labels, concept kind, and source provenance. Do not create GitHub issues or pull requests; Homeboy owns orchestration and GitHub publication happens only after a validated static-site candidate exists.';
const loopDesignPrompt = 'Consume ConceptPacket {{outputs.concept_packet}} and emit one DesignPacket artifact. Preserve the concept title, body sections, lane labels, and provenance. Include palette, typography, layout direction, mood, accessibility notes, and any implementation constraints needed by the static-site candidate generator. Do not create GitHub issues or pull requests.';
const loopCandidatePrompt = 'Consume ConceptPacket {{outputs.concept_packet}} and DesignPacket {{outputs.design_packet}}, then generate a StaticSiteCandidate artifact containing the complete static-sites file set or patch, site metadata, source concept/design references, branch/title proposal, and reproduction context. Do not create a pull request; validation must run before publication.';
const loopPublishPrompt = 'Consume StaticSiteCandidate {{outputs.static_site_candidate}} and ImportValidationResult {{outputs.import_validation_result}}, then publish exactly one static-site PR. Use the candidate files and metadata as source of truth. Render the PR body with .github/scripts/render-static-site-pr-body.mjs so the initial PR body includes the import validation summary, fallback block count, conversion finding counts, and artifact references. Do not add a separate follow-up metrics comment in the normal flow.';

function storeIdeaTask({ id = 'store-idea-agent', flow = 'store-idea-artifact-flow', prompt = ' ', title = 'Generate store idea', lane = 'store concept lane' } = {}) {
	const lanePolicyPrompt = policyPrompt(complexityDecision, lane);
	const taskPrompt = [conceptPacketPrompt, prompt].filter(Boolean).join('\n\n');
	return task({
		id,
		title,
		instructions: 'Generate one store ConceptPacket artifact.',
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'ConceptPacket'],
		config: datamachineConfig({
			bundle: 'bundles/store-idea-agent',
			agent: 'store-idea-agent',
			pipeline: 'store-idea-artifact-pipeline',
			flow,
			prompt: [taskPrompt, lanePolicyPrompt].join('\n\n'),
			successRequiresPr: false,
			successCompletionOutcomes: ['concept_packet'],
			artifactOutputs: {
				concept_packet: conceptPacketOutput,
			},
			maxTurns: 6,
			stepBudget: 8,
			timeBudgetMs: 180000,
			engineDataOutputs: {
				concept_packet: 'metadata.artifacts.ConceptPacket',
			},
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
		instructions: 'Generate one website ConceptPacket artifact.',
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'ConceptPacket'],
		config: datamachineConfig({
			bundle: 'bundles/website-idea-agent',
			agent: 'website-idea-agent',
			pipeline: 'website-idea-artifact-pipeline',
			flow,
			prompt: [taskPrompt, lanePolicyPrompt].join('\n\n'),
			successRequiresPr: false,
			successCompletionOutcomes: ['concept_packet'],
			artifactOutputs: {
				concept_packet: conceptPacketOutput,
			},
			engineDataOutputs: {
				concept_packet: 'metadata.artifacts.ConceptPacket',
			},
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}

function designTask({ id, conceptPacket = '{{outputs.concept_packet}}', title, lane = 'design lane' }) {
	const prompt = [`Consume ConceptPacket ${conceptPacket} and emit one DesignPacket artifact. Preserve source concept identity and lane metadata. Do not create GitHub issues or pull requests.`, policyPrompt(complexityDecision, lane)].join('\n\n');
	return task({
		id,
		title,
		instructions: prompt,
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'DesignPacket'],
		config: datamachineConfig({
			bundle: 'bundles/design-agent',
			agent: 'design-agent',
			pipeline: 'design-artifact-pipeline',
			flow: 'design-artifact-flow',
			prompt,
			successRequiresPr: false,
			successCompletionOutcomes: ['design_packet'],
			artifactOutputs: {
				design_packet: designPacketOutput,
			},
			engineDataOutputs: {
				design_packet: 'metadata.artifacts.DesignPacket',
			},
			transcriptArtifactName: `${id}-transcript-${runId}`,
			complexityPolicy: complexityDecision,
		}),
	});
}

function staticSiteCandidateTask({ id, conceptPacket = '{{outputs.concept_packet}}', designPacket = '{{outputs.design_packet}}', title, lane = 'static-site candidate lane' }) {
	const prompt = [`Consume ConceptPacket ${conceptPacket} and DesignPacket ${designPacket}. Emit one StaticSiteCandidate artifact with generated files, metadata, branch/title proposal, and reproduction context. Do not open a pull request.`, policyPrompt(complexityDecision, lane)].join('\n\n');
	return task({
		id,
		title,
		instructions: prompt,
		inputs: complexityTaskInput,
		expectedArtifacts: ['datamachine-transcript', 'StaticSiteCandidate'],
		config: datamachineConfig({
			bundle: 'bundles/static-site-agent',
			agent: 'static-site-agent',
			pipeline: 'static-site-candidate-pipeline',
			flow: 'static-site-candidate-flow',
			prompt,
			successRequiresPr: false,
			successCompletionOutcomes: ['static_site_candidate'],
			artifactOutputs: {
				static_site_candidate: staticSiteCandidateOutput,
			},
			engineDataOutputs: {
				static_site_candidate: 'metadata.artifacts.StaticSiteCandidate',
			},
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
		expectedArtifacts: ['ImportValidationResult', 'FindingPacketSet'],
		config: {
			execution_kind: 'wp_codebox_ability',
			ability: 'static-site-importer/import-website-artifact',
			ability_input: {
				artifact: candidate,
			},
			output_mappings: {
				import_validation_result: 'result.import_validation_result',
				finding_packets: 'result.finding_packets',
			},
			artifact_outputs: {
				import_validation_result: importValidationResultOutput,
			},
			engine_data_outputs: {
				import_validation_result: 'outputs.import_validation_result',
				finding_packets: 'outputs.finding_packets',
			},
			task_timeout_seconds: 1800,
		},
	});
}

function staticSitePublishTask({ id, title, candidate = '{{outputs.static_site_candidate}}', validation = '{{outputs.import_validation_result}}' }) {
	const prompt = `Publish StaticSiteCandidate ${candidate} after reading ImportValidationResult ${validation}. Create one static-site PR with candidate files, and render the initial PR body with validation metrics from .github/scripts/render-static-site-pr-body.mjs.`;
	return task({
		id,
		title,
		instructions: prompt,
		expectedArtifacts: ['datamachine-transcript', 'datamachine-pull-request'],
		config: datamachineConfig({
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
		}),
	});
}

function manualPlan() {
	const conceptPrompt = process.env.CONCEPT_PROMPT || '';
	const conceptPacket = process.env.CONCEPT_PACKET || '';
	const designPacket = process.env.DESIGN_PACKET || '';
	const staticSiteCandidate = process.env.STATIC_SITE_CANDIDATE || '';
	const importValidationResult = process.env.IMPORT_VALIDATION_RESULT || '';
	const websiteFlow = process.env.WEBSITE_FLOW_SLUG || 'website-idea-artifact-flow';
	const taskByKind = {
		store_idea: () => storeIdeaTask({ id: 'store-idea-agent', flow: 'store-idea-artifact-flow', prompt: conceptPrompt, title: 'Generate store idea' }),
		website_idea: () => websiteIdeaTask({ id: 'website-idea-agent', flow: websiteFlow, prompt: conceptPrompt, title: 'Generate website idea' }),
		design: () => designTask({ id: 'design-agent', conceptPacket, title: 'Generate design packet' }),
		generate_candidate: () => staticSiteCandidateTask({ id: 'static-site-candidate-agent', conceptPacket, designPacket, title: 'Generate static site candidate' }),
		publish_pr: () => staticSitePublishTask({ id: 'static-site-publish-agent', candidate: staticSiteCandidate, validation: importValidationResult, title: 'Publish static site PR' }),
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
	if (manualTaskKind === 'publish_pr' && (!staticSiteCandidate || !importValidationResult)) {
		throw new Error('STATIC_SITE_CANDIDATE and IMPORT_VALIDATION_RESULT are required for publish_pr.');
	}

  return {
    schema: 'homeboy/agent-task-plan/v1',
    plan_id: planId,
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
			controller_contract: 'wp-site-generator/static-site-generation-loop',
			complexity_policy: complexityDecision,
			generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
		},
	};
}

const boundedMaxConcurrency = Math.max(
	1,
	Math.min(
		Number(process.env.HOMEBOY_MAX_CONCURRENCY || complexityDecision.target_parallel_candidates || 1),
		Number(complexityDecision.target_parallel_candidates || 1)
	)
);

const loopPlan = {
  schema: 'homeboy/agent-task-plan/v1',
  plan_id: planId,
	tasks: [
		storeIdeaTask({ prompt: ' ', title: 'Generate store idea', lane: 'store concept lane' }),
		websiteIdeaTask({ prompt: ' ', title: 'Generate website idea', lane: 'website concept lane' }),
		task({
			id: 'design-store-packet',
			title: 'Design store concept packet',
			instructions: loopDesignPrompt,
			inputs: complexityTaskInput,
			expectedArtifacts: ['datamachine-transcript', 'DesignPacket'],
			config: datamachineConfig({
				bundle: 'bundles/design-agent',
				agent: 'design-agent',
				pipeline: 'design-artifact-pipeline',
				flow: 'design-artifact-flow',
				prompt: [loopDesignPrompt, policyPrompt(complexityDecision, 'store design lane')].join('\n\n'),
				successRequiresPr: false,
				successCompletionOutcomes: ['design_packet'],
				artifactOutputs: {
					design_packet: designPacketOutput,
				},
				engineDataOutputs: {
					design_packet: 'metadata.artifacts.DesignPacket',
				},
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
			config: datamachineConfig({
				bundle: 'bundles/design-agent',
				agent: 'design-agent',
				pipeline: 'design-artifact-pipeline',
				flow: 'design-artifact-flow',
				prompt: [loopDesignPrompt, policyPrompt(complexityDecision, 'website design lane')].join('\n\n'),
				successRequiresPr: false,
				successCompletionOutcomes: ['design_packet'],
				artifactOutputs: {
					design_packet: designPacketOutput,
				},
				engineDataOutputs: {
					design_packet: 'metadata.artifacts.DesignPacket',
				},
				transcriptArtifactName: `design-agent-website-transcript-${runId}`,
				complexityPolicy: complexityDecision,
			}),
		}),
		staticSiteCandidateTask({ id: 'generate-store-candidate', title: 'Generate store static-site candidate', lane: 'store candidate lane' }),
		staticSiteCandidateTask({ id: 'generate-website-candidate', title: 'Generate website static-site candidate', lane: 'website candidate lane' }),
		importValidationTask({ id: 'validate-store-candidate', title: 'Validate store static-site candidate' }),
		importValidationTask({ id: 'validate-website-candidate', title: 'Validate website static-site candidate' }),
		staticSitePublishTask({ id: 'publish-store-pr', title: 'Publish store static-site PR' }),
		staticSitePublishTask({ id: 'publish-website-pr', title: 'Publish website static-site PR' }),
	],
	output_dependencies: {
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
			depends_on: ['generate-store-candidate', 'validate-store-candidate'],
			bindings: {
				static_site_candidate: artifactBinding('generate-store-candidate', 'static_site_candidate'),
				import_validation_result: artifactBinding('validate-store-candidate', 'import_validation_result'),
			},
		},
		'publish-website-pr': {
			depends_on: ['generate-website-candidate', 'validate-website-candidate'],
			bindings: {
				static_site_candidate: artifactBinding('generate-website-candidate', 'static_site_candidate'),
				import_validation_result: artifactBinding('validate-website-candidate', 'import_validation_result'),
			},
		},
	},
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
		artifact_stages: ['ConceptPacket', 'DesignPacket', 'StaticSiteCandidate', 'ImportValidationResult', 'StaticSitePullRequest'],
		controller_spec: controllerSpecPath,
		controller_contract: 'wp-site-generator/static-site-generation-loop',
		complexity_policy: complexityDecision,
		generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
	},
};

const plan = manualTaskKind ? manualPlan() : loopPlan;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(outputPath);
