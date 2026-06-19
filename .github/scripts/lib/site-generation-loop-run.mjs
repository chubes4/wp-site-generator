import path from 'node:path';

import {
	readHomeboyAgentRuntimeOverrides,
	requireLocalReplaySeed,
	resolveReplayRunId,
} from './ci-runtime-utils.mjs';

export function buildSiteGenerationLoopRunContext({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd() } = {}) {
	requireLocalReplaySeed(env);

	const runId = resolveReplayRunId(env);
	const repository = env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
	const controllerSpecPath = env.HOMEBOY_CONTROLLER_SPEC_PATH || '.github/homeboy/controllers/static-site-generation-loop.controller.json';
	const outputPath = env.HOMEBOY_CONTROLLER_RUN_INPUTS_PATH || path.join(root, '.ci', 'site-generation-loop.controller-run-inputs.json');
	const policyResultPath = env.HOMEBOY_POLICY_RESULT_PATH || outputPath.replace(/\.json$/, '.complexity-policy-result.json');
	const runtimeOverrides = readHomeboyAgentRuntimeOverrides(env);

	return {
		runId,
		repository,
		controllerSpecPath,
		outputPath,
		policyResultPath,
		runtimeOverrides,
	};
}
