#!/usr/bin/env node

import { appendGithubOutput, parseArgs, runtimeBundleExecution } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const packageSource = args.get('--package-source');
const packageSlug = args.get('--package-slug');
const workflowId = args.get('--workflow-id');
const input = parseJsonEnv('RUNTIME_EXECUTION_INPUT', {});
const options = parseJsonEnv('RUNTIME_EXECUTION_OPTIONS', {});
const execution = runtimeBundleExecution({ packageSource, packageSlug, workflowId, input, options }).runtime_execution;
const outputs = { runtime_execution: JSON.stringify(execution) };

if (process.env.GITHUB_OUTPUT) {
	await appendGithubOutput(process.env.GITHUB_OUTPUT, outputs);
} else {
	process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}

function parseJsonEnv(name, fallback) {
	const value = process.env[name];
	if (!value) {
		return fallback;
	}
	return JSON.parse(value);
}
