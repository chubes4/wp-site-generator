const runtimePackageProfileId = 'wpsg-agent-runtime-package';

export const runtimeProviderProfiles = Object.freeze({});

export const runtimeApiAbilities = Object.freeze({
	runRuntimePackage: '',
});

export const runtimePackageProfile = Object.freeze({
	id: runtimePackageProfileId,
	runtimeTaskAbility: '',
	runtimeBundleAbility: '',
	runtimeWorkflowAbility: '',
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
	const providerProfile = runtimeProviderProfile(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE, env);
	const runtimeTaskAbility = requiredRuntimeContractValue('HOMEBOY_AGENT_RUNTIME_TASK_ABILITY', text(env.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY) || text(env.HOMEBOY_AGENT_RUNTIME_PACKAGE_ABILITY));
	return {
		provider: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER) || providerProfile.provider || '',
		profile: text(env.HOMEBOY_AGENT_RUNTIME_PROFILE) || runtimePackageProfileId,
		profiles: text(env.HOMEBOY_AGENT_RUNTIME_PROFILES),
		backend: text(env.HOMEBOY_AGENT_RUNTIME_BACKEND),
		providerId: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_ID),
		selector: text(env.HOMEBOY_AGENT_RUNTIME_SELECTOR),
		runtimeTaskAbility,
		runtimeBundleAbility: text(env.HOMEBOY_AGENT_RUNTIME_BUNDLE_ABILITY) || runtimeTaskAbility,
		runtimeWorkflowAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKFLOW_ABILITY) || runtimeTaskAbility,
		workspaceCommandAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY) || providerProfile.workspaceCommandAbility || '',
		workspacePublishAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY) || providerProfile.workspacePublishAbility || '',
	};
}

export function runtimeProviderProfile(profileId, env = process.env) {
	const profileJson = text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON);
	if (profileJson) {
		return parseJsonObject(profileJson, 'HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON');
	}
	const id = text(profileId);
	if (!id) {
		return {};
	}
	const profile = runtimeProviderProfiles[id] || Object.values(runtimeProviderProfiles).find((candidate) => candidate.id === id);
	if (!profile) {
		throw new Error(`Unknown WPSG runtime provider profile: ${id}`);
	}
	return profile;
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

export function runtimeToolProfileInputs(profileId, contract = null) {
	const profile = runtimeToolProfiles[profileId] || Object.values(runtimeToolProfiles).find((candidate) => candidate.id === profileId);
	if (!profile) {
		throw new Error(`Unknown WPSG runtime tool profile: ${profileId}`);
	}
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

export function runtimeWorkflowInputs(profileId, contract = readAgentRuntimeContract()) {
	return {
		runtime_provider: contract.provider,
		runtime_profile: contract.profile,
		runtime_profiles: contract.profiles || JSON.stringify(runtimePackageProfiles(contract)),
		...runtimeToolProfileInputs(profileId, contract),
	};
}

export function runtimeBundleExecution({ packageSource, packageSlug, workflowId, input = {}, options = {}, ability = runtimeApiAbilities.runRuntimePackage } = {}) {
	if (!packageSource || !packageSlug || !workflowId) {
		throw new Error('packageSource, packageSlug, and workflowId are required for runtime bundle execution.');
	}
	const executionAbility = ability || runtimePackageAbility();

	return {
		runtime_execution: {
			kind: 'bundle',
			ability: executionAbility,
			input: {
				package: {
					source: packageSource,
					slug: packageSlug,
				},
				workflow: {
					id: workflowId,
				},
				input,
				...(Object.keys(options).length > 0 ? { options } : {}),
			},
		},
	};
}

export function runtimeWorkflowBuilderExecution({ kind, workflowBuilder, ...metadata } = {}) {
	if (!kind || !workflowBuilder) {
		throw new Error('kind and workflowBuilder are required for runtime workflow-builder execution.');
	}

	return {
		runtime_execution: {
			kind,
			workflow_builder: workflowBuilder,
			...metadata,
		},
	};
}

export function runtimePackageAbility(env = process.env) {
	return requiredRuntimeContractValue('HOMEBOY_AGENT_RUNTIME_TASK_ABILITY', text(env.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY) || text(env.HOMEBOY_AGENT_RUNTIME_PACKAGE_ABILITY));
}

function text(value) {
	return String(value || '').trim();
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function requiredRuntimeContractValue(name, value) {
	if (!value) {
		throw new Error(`WPSG requires ${name} from the upstream runtime contract.`);
	}
	return value;
}

function parseJsonObject(value, name) {
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${name} must be a JSON object.`);
	}
	return parsed;
}
