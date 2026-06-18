#!/usr/bin/env node
import path from 'node:path';

import {
	requireLocalReplaySeed,
	readHomeboyAgentRuntimeOverrides,
	readJsonFile,
	resolveReplayRunId,
	writeJsonFile,
} from './lib/ci-runtime-utils.mjs';
import {
	evaluateComplexityPolicy,
	loadPolicy,
	loadQualitySignals,
	resolvePolicyInputs,
} from './site-generation-complexity-policy.mjs';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
requireLocalReplaySeed(process.env);

const runId = resolveReplayRunId(process.env);
const repository = process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const controllerSpecPath = process.env.HOMEBOY_CONTROLLER_SPEC_PATH || '.github/homeboy/controllers/static-site-generation-loop.controller.json';
const outputPath = process.env.HOMEBOY_CONTROLLER_RUN_SPEC_PATH || path.join(root, '.ci', 'site-generation-loop.controller-run-spec.json');
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
const controller = await readJsonFile(path.resolve(root, controllerSpecPath));

controller.inputs = {
	...(controller.inputs || {}),
	repository,
	run_id: runId,
	manual_task_kind: process.env.HOMEBOY_TASK_KIND || '',
	concept_packet: process.env.CONCEPT_PACKET || '',
	design_packet: process.env.DESIGN_PACKET || '',
	static_site_candidate: process.env.STATIC_SITE_CANDIDATE || '',
	import_validation_result: process.env.IMPORT_VALIDATION_RESULT || '',
	static_site_publish_gate: process.env.STATIC_SITE_PUBLISH_GATE || '',
	concept_prompt: process.env.CONCEPT_PROMPT || '',
	website_flow_slug: process.env.WEBSITE_FLOW_SLUG || 'website-idea-artifact-flow',
	complexity_policy: complexityDecision,
	runtime_input_contract: runtimeOverrides.source,
	artifact_root: process.env.HOMEBOY_ARTIFACT_ROOT || '.ci/homeboy-agent-task-artifacts',
};

controller.metadata = {
	...(controller.metadata || {}),
	run: {
		run_id: runId,
		repository,
		controller_spec: controllerSpecPath,
		complexity_policy: complexityDecision,
		runtime_input_contract: runtimeOverrides.source,
		generated_by: '.github/scripts/build-homeboy-controller-run-spec.mjs',
	},
};

await writeJsonFile(outputPath, controller);
console.log(outputPath);
