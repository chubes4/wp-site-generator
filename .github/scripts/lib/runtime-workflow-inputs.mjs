import { createRequire } from 'node:module';
import path from 'node:path';

import { readAgentRuntimeContract, runtimePackageProfiles } from './agent-runtime-api.mjs';
import { wpsgLoopConfig } from './wpsg-domain-config.mjs';

const require = createRequire(import.meta.url);

export const runtimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: wpsgLoopConfig.runtimeWorkloadProfiles.workspaceIteration,
		requirements: Object.freeze(['command', 'publish']),
		tools: Object.freeze([
			['workspace_clone', 'command'],
			['workspace_worktree_add', 'command'],
			['workspace_read', 'command'],
			['workspace_write', 'command'],
			['workspace_edit', 'command'],
			['workspace_git_status', 'command'],
			['workspace_git_commit', 'command'],
			['workspace_git_push', 'command'],
			['create_github_pull_request', 'publish'],
			['create_github_issue', 'publish'],
		]),
	}),
	workspacePublication: Object.freeze({
		id: wpsgLoopConfig.runtimeWorkloadProfiles.workspacePublication,
		requirements: Object.freeze(['publish']),
		tools: Object.freeze([]),
	}),
});

export function runtimeToolProfileInputs(profileId, contract = null) {
	const profile = wpsgRuntimeToolProfile(profileId);
	const runtimeContract = contract || readAgentRuntimeContract();

	const abilityByKind = {
		command: runtimeContract.workspaceCommandAbility,
		publish: runtimeContract.workspacePublishAbility,
	};
	const abilityRequirements = unique([
		runtimeContract.runtimeTaskAbility,
		...profile.requirements.map((kind) => abilityByKind[kind]),
	]);
	const abilityTools = profile.tools
		.map(([name, kind]) => ({ name, ability: abilityByKind[kind] }))
		.filter((tool) => tool.ability);

	return {
		ability_requirements: JSON.stringify(abilityRequirements),
		ability_tools: JSON.stringify(abilityTools),
	};
}

export function runtimeWorkflowInputs(profileId, contract = readAgentRuntimeContract(), env = process.env) {
	const runtimeProfiles = contract.profiles || JSON.stringify(runtimePackageProfiles(contract));
	const rendered = renderRuntimeWorkflowInputs({
		runtime_provider: contract.provider,
		runtime_profile: contract.profile,
		runtime_profiles: JSON.parse(runtimeProfiles),
		tool_profile: wpsgRuntimeToolProfile(profileId),
	}, env);

	return {
		runtime_provider: rendered.workflow_inputs.runtime,
		runtime_profile: rendered.workflow_inputs.profile,
		runtime_profiles: JSON.stringify(rendered.workflow_inputs.runtime_profiles),
		...runtimeToolProfileInputs(profileId, contract),
	};
}

export function renderRuntimeWorkflowInputs(options = {}, env = process.env) {
	const homeboyRenderer = loadHomeboyExtensionsRenderer(env);
	if (!homeboyRenderer) {
		throw new Error('Homeboy Extensions runtime workflow input renderer is required. Install homeboy-runtime-agent-ci/runtime-workflow-inputs or set HOMEBOY_EXTENSIONS_RUNTIME_WORKFLOW_INPUTS/HOMEBOY_EXTENSIONS_PATH.');
	}

	return homeboyRenderer({
		runtime: options.runtime_provider || options.runtime || '',
		runtime_profile: options.runtime_profile,
		runtime_profiles: options.runtime_profiles,
		tool_profile: options.tool_profile,
		runtimeProviderConfig: options.runtime_provider ? { id: options.runtime_provider } : undefined,
	});
}

function wpsgRuntimeToolProfile(profileId) {
	const profile = runtimeToolProfiles[profileId] || Object.values(runtimeToolProfiles).find((candidate) => candidate.id === profileId);
	if (!profile) {
		throw new Error(`Unknown WPSG runtime tool profile: ${profileId}`);
	}
	return profile;
}

function loadHomeboyExtensionsRenderer(env) {
	const explicitPath = text(env.HOMEBOY_EXTENSIONS_RUNTIME_WORKFLOW_INPUTS);
	const homeboyExtensionsPath = text(env.HOMEBOY_EXTENSIONS_PATH);
	const candidates = [
		explicitPath,
		homeboyExtensionsPath ? path.join(homeboyExtensionsPath, 'runtime-agent-ci/lib/runtime-workflow-inputs.cjs') : '',
		'homeboy-runtime-agent-ci/runtime-workflow-inputs',
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			const module = require(candidate);
			if (typeof module.renderRuntimeWorkflowInputs === 'function') {
				return module.renderRuntimeWorkflowInputs;
			}
		} catch (error) {
			if (error?.code !== 'MODULE_NOT_FOUND') {
				throw error;
			}
		}
	}
	return null;
}

function text(value) {
	return String(value || '').trim();
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}
