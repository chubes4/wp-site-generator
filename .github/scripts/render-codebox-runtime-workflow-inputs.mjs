#!/usr/bin/env node

import { appendGithubOutput, parseArgs, runtimeWorkflowInputs } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const profile = args.get('--runtime-tool-profile') || process.env.RUNTIME_TOOL_PROFILE || 'workspace-iteration';
const outputs = runtimeWorkflowInputs(profile);

if (process.env.GITHUB_OUTPUT) {
	await appendGithubOutput(process.env.GITHUB_OUTPUT, outputs);
} else {
	process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}
