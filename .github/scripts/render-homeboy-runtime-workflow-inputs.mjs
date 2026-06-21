#!/usr/bin/env node

import { appendGithubOutput, codeboxAgentRuntimeContract, codeboxRuntimeWorkflowInputs, parseArgs } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const profile = args.get('--codebox-workload-profile') || process.env.CODEBOX_WORKLOAD_PROFILE || 'workspace-iteration';
const outputs = codeboxRuntimeWorkflowInputs(profile, codeboxAgentRuntimeContract(process.env));

if (process.env.GITHUB_OUTPUT) {
	await appendGithubOutput(process.env.GITHUB_OUTPUT, outputs);
} else {
	process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}
