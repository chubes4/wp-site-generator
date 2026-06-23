#!/usr/bin/env node

import { appendGithubOutput, parseArgs, readAgentRuntimeContract, runtimeWorkflowInputs } from './lib/ci-runtime-utils.mjs';
import { wpsgLoopConfig } from './lib/wpsg-domain-config.mjs';

const args = parseArgs(process.argv.slice(2));
const profile = args.get('--runtime-workload-profile') || process.env.RUNTIME_WORKLOAD_PROFILE || wpsgLoopConfig.runtimeWorkloadProfiles.workspaceIteration;
const outputs = runtimeWorkflowInputs(profile, readAgentRuntimeContract(process.env));

if (process.env.GITHUB_OUTPUT) {
	await appendGithubOutput(process.env.GITHUB_OUTPUT, outputs);
} else {
	process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}
