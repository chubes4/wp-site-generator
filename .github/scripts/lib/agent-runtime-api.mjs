const defaultRuntimePackageAbility = 'agents/run-runtime-package';

export const runtimeApiAbilities = Object.freeze({
	runRuntimePackage: defaultRuntimePackageAbility,
});

export const runtimePackageProfile = Object.freeze({
	id: 'wpsg-agent-runtime-package',
	runtimeTaskAbility: defaultRuntimePackageAbility,
	runtimeBundleAbility: defaultRuntimePackageAbility,
	runtimeWorkflowAbility: defaultRuntimePackageAbility,
});

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

export function readAgentRuntimeContract(env = process.env) {
	return {
		provider: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER),
		profile: text(env.HOMEBOY_AGENT_RUNTIME_PROFILE) || runtimePackageProfile.id,
		profiles: text(env.HOMEBOY_AGENT_RUNTIME_PROFILES),
		backend: text(env.HOMEBOY_AGENT_RUNTIME_BACKEND),
		providerId: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_ID),
		selector: text(env.HOMEBOY_AGENT_RUNTIME_SELECTOR),
		runtimeTaskAbility: text(env.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY) || runtimePackageProfile.runtimeTaskAbility,
		runtimeBundleAbility: text(env.HOMEBOY_AGENT_RUNTIME_BUNDLE_ABILITY) || runtimePackageProfile.runtimeBundleAbility,
		runtimeWorkflowAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKFLOW_ABILITY) || runtimePackageProfile.runtimeWorkflowAbility,
		workspaceCommandAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY),
		workspacePublishAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY),
	};
}

export function runtimePackageProfiles(contract = readAgentRuntimeContract()) {
	if (contract.profiles) {
		return JSON.parse(contract.profiles);
	}

	const profile = {
		schema: 'homeboy/runtime-profile/v1',
		id: contract.profile,
		runtime_task_ability: contract.runtimeTaskAbility,
		runtime_bundle_ability: contract.runtimeBundleAbility,
		runtime_workflow_ability: contract.runtimeWorkflowAbility,
		ability_requirements: unique([contract.runtimeTaskAbility]),
	};

	const selection = Object.fromEntries(Object.entries({
		backend: contract.backend,
		provider_id: contract.providerId,
		selector: contract.selector,
	}).filter(([, value]) => value));

	if (Object.keys(selection).length > 0) {
		profile.runtime_selection = selection;
	}

	return { [contract.profile]: profile };
}

export function runtimeToolProfileInputs(profileId, contract = readAgentRuntimeContract()) {
	const profile = runtimeToolProfiles[profileId] || Object.values(runtimeToolProfiles).find((candidate) => candidate.id === profileId);
	if (!profile) {
		throw new Error(`Unknown WPSG runtime tool profile: ${profileId}`);
	}

	const abilityByKind = {
		command: contract.workspaceCommandAbility,
		publish: contract.workspacePublishAbility,
	};
	const abilityRequirements = unique([
		contract.runtimeTaskAbility,
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

export function runtimeWorkflowInputs(profileId, contract = readAgentRuntimeContract()) {
	return {
		runtime_provider: contract.provider,
		runtime_profile: contract.profile,
		runtime_profiles: contract.profiles || JSON.stringify(runtimePackageProfiles(contract)),
		...runtimeToolProfileInputs(profileId, contract),
	};
}

export function runtimePackageAbility() {
	return runtimeApiAbilities.runRuntimePackage;
}

function text(value) {
	return String(value || '').trim();
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}
