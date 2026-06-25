#!/usr/bin/env node
import path from 'node:path';

import { buildHomeboyAgentRuntimeConfig, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSiteGenerationLoopRunContext } from './lib/site-generation-loop-run.mjs';
import {
	evaluateComplexityPolicy,
	loadPolicy,
	loadQualitySignals,
	resolvePolicyInputs,
} from './site-generation-complexity-policy.mjs';
import { wpsgLoopConfig } from './lib/wpsg-domain-config.mjs';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const { runId, loopId, repository, controllerSpecPath, outputPath, policyResultPath, runtimeOverrides, source, dependencyRefs } = buildSiteGenerationLoopRunContext({ env: process.env, root });
const runtimeConfig = buildHomeboyAgentRuntimeConfig(runtimeOverrides);
const policyInputs = resolvePolicyInputs({ root });
const complexityPolicy = loadPolicy(policyInputs.policyPath);
const qualitySignals = loadQualitySignals(policyInputs.qualitySignalsPath);
const complexityDecision = evaluateComplexityPolicy({
	policy: complexityPolicy,
	qualitySignals,
	runId,
	overrides: policyInputs.overrides,
});

await writeJsonFile(policyResultPath, {
	policy_id: wpsgLoopConfig.complexityPolicyId,
	policy_inputs: {
		policy_path: path.relative(root, policyInputs.policyPath),
		quality_signals_path: policyInputs.qualitySignalsPath ? path.relative(root, policyInputs.qualitySignalsPath) : '',
		overrides: complexityDecision.overrides,
		current_tier: complexityDecision.current_tier,
	},
	policy_results: complexityDecision,
	provenance: {
		generated_by: '.github/scripts/build-homeboy-controller-run-inputs.mjs',
		repository,
		run_id: runId,
		policy_schema: complexityDecision.schema,
	},
});

await writeJsonFile(outputPath, {
	inputs: {
		loop_id: loopId,
		repository,
		run_id: runId,
		manual_task_kind: process.env.HOMEBOY_TASK_KIND || '',
		concept_packet: process.env.CONCEPT_PACKET || '',
		design_packet: process.env.DESIGN_PACKET || '',
		static_site_candidate: process.env.STATIC_SITE_CANDIDATE || '',
		import_validation_result: process.env.IMPORT_VALIDATION_RESULT || '',
		static_site_publish_gate: process.env.STATIC_SITE_PUBLISH_GATE || '',
		concept_prompt: process.env.CONCEPT_PROMPT || '',
		website_flow_slug: process.env.WEBSITE_FLOW_SLUG || wpsgLoopConfig.defaultWebsiteFlowSlug,
		runtime_input_contract: runtimeOverrides.source,
		runtime_config: runtimeConfig,
		artifact_root: process.env.HOMEBOY_ARTIFACT_ROOT || wpsgLoopConfig.defaultArtifactRoot,
		randomness_seed: complexityDecision.randomness_seed,
		randomness_profile: complexityDecision.randomness_profile.id,
		source,
		dependency_refs: dependencyRefs,
	},
	metadata: {
		run: {
			run_id: runId,
			loop_id: loopId,
			repository,
			randomness_seed: complexityDecision.randomness_seed,
			randomness_profile: complexityDecision.randomness_profile.id,
			source,
			dependency_refs: dependencyRefs,
			controller_spec: controllerSpecPath,
			complexity_policy_result: path.relative(root, policyResultPath),
			runtime_input_contract: runtimeOverrides.source,
			runtime_config: runtimeConfig,
			generated_by: '.github/scripts/build-homeboy-controller-run-inputs.mjs',
			materialized_by: 'homeboy agent-task controller from-spec',
		},
	},
});

console.log(outputPath);
