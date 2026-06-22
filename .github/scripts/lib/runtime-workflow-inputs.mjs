import { createRequire } from 'node:module';
import path from 'node:path';

import { readAgentRuntimeContract, runtimePackageProfiles } from './agent-runtime-api.mjs';

const require = createRequire(import.meta.url);

export const runtimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: 'workspace-iteration',
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
		id: 'workspace-publication',
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
	if (homeboyRenderer) {
		return homeboyRenderer({
			runtime: options.runtime_provider || options.runtime || '',
			runtime_profile: options.runtime_profile,
			runtime_profiles: options.runtime_profiles,
			tool_profile: options.tool_profile,
			runtimeProviderConfig: options.runtime_provider ? { id: options.runtime_provider } : undefined,
		});
	}

	const runtimeProfile = requiredString(options.runtime_profile, 'runtime_profile');
	const runtimeProfiles = plainObject(options.runtime_profiles);
	const selectedProfile = {
		...(runtimeProfiles[runtimeProfile] || {}),
		id: runtimeProfiles[runtimeProfile]?.id || runtimeProfile,
	};

	return {
		schema: 'homeboy/runtime-workflow-inputs/v1',
		runtime_id: options.runtime_provider || options.runtime || '',
		runtime_profile: runtimeProfile,
		runtime_profiles: {
			...runtimeProfiles,
			[runtimeProfile]: selectedProfile,
		},
		runtime_requirements: selectedProfile,
		tool_profile: options.tool_profile,
		workflow_inputs: {
			runtime: options.runtime_provider || options.runtime || '',
			profile: runtimeProfile,
			runtime_profiles: {
				...runtimeProfiles,
				[runtimeProfile]: selectedProfile,
			},
		},
	};
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

function requiredString(value, name) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function plainObject(value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
	return String(value || '').trim();
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}
