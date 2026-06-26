#!/usr/bin/env node

import { appendGithubOutput, parseArgs, runtimePackageProfiles, runtimeToolProfileInputs, runtimeToolProfiles } from './lib/ci-runtime-utils.mjs';
import { wpsgLoopConfig } from './lib/wpsg-domain-config.mjs';

const args = parseArgs(process.argv.slice(2));
const workloadProfile = args.get('--runtime-workload-profile') || process.env.RUNTIME_WORKLOAD_PROFILE || wpsgLoopConfig.runtimeWorkloadProfiles.workspaceIteration;
const runtimeProfile = process.env.HOMEBOY_AGENT_RUNTIME_PROFILE || wpsgLoopConfig.runtimePackageProfile;
const runtimeProfiles = process.env.HOMEBOY_AGENT_RUNTIME_PROFILES || JSON.stringify(runtimePackageProfiles(process.env));
const toolProfile = Object.values(runtimeToolProfiles).find((profile) => profile.id === workloadProfile) || runtimeToolProfiles[workloadProfile];
if (!toolProfile) {
	throw new Error(`Unknown WPSG runtime tool profile: ${workloadProfile}`);
}

const outputs = {
	runtime_provider: process.env.HOMEBOY_AGENT_RUNTIME_PROVIDER || process.env.HOMEBOY_AGENT_RUNTIME || '',
	runtime_profile: runtimeProfile,
	runtime_profiles: runtimeProfiles,
	tool_profile: JSON.stringify(toolProfile),
	...runtimeToolProfileInputs(workloadProfile, process.env),
};

if (process.env.GITHUB_OUTPUT) {
	await appendGithubOutput(process.env.GITHUB_OUTPUT, outputs);
} else {
	process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}
