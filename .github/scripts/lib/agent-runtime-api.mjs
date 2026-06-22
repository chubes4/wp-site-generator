import { readFileSync } from 'node:fs';

const runtimePackageProfileId = 'wpsg-agent-runtime-package';

const defaultRuntimePackageAbility = 'homeboy/run-runtime-package';
const defaultRuntimeWorkspaceRecipeSchema = 'homeboy/runtime-workspace-recipe/v1';
const defaultValidationArtifactEnvelopeSchema = 'homeboy/validation-artifact-envelope/v1';
const defaultVisualParityOutputRoot = 'visual-parity-artifacts';

export const runtimeProviderProfiles = Object.freeze({
});

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
	const manifest = readRuntimeManifest(env);
	const profileManifest = profileFromManifest(manifest, env.HOMEBOY_AGENT_RUNTIME_PROFILE);
	const providerProfile = runtimeProviderProfile(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE, env);
	const runtimeTaskAbility = text(env.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY) || text(env.HOMEBOY_AGENT_RUNTIME_PACKAGE_ABILITY) || text(profileManifest.runtime_task_ability) || runtimePackageProfile.runtimeTaskAbility;
	return {
		provider: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER) || text(profileManifest.provider) || providerProfile.provider || '',
		profile: text(env.HOMEBOY_AGENT_RUNTIME_PROFILE) || text(profileManifest.id) || runtimePackageProfile.id,
		profiles: text(env.HOMEBOY_AGENT_RUNTIME_PROFILES) || runtimeProfilesJsonFromManifest(manifest),
		backend: text(env.HOMEBOY_AGENT_RUNTIME_BACKEND) || text(profileManifest.backend),
		providerId: text(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_ID) || text(profileManifest.provider_id),
		selector: text(env.HOMEBOY_AGENT_RUNTIME_SELECTOR) || text(profileManifest.selector),
		runtimeTaskAbility,
		runtimeBundleAbility: text(env.HOMEBOY_AGENT_RUNTIME_BUNDLE_ABILITY) || text(profileManifest.runtime_bundle_ability) || runtimeTaskAbility || runtimePackageProfile.runtimeBundleAbility,
		runtimeWorkflowAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKFLOW_ABILITY) || text(profileManifest.runtime_workflow_ability) || runtimeTaskAbility || runtimePackageProfile.runtimeWorkflowAbility,
		workspaceCommandAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY) || text(profileManifest.workspace_command_ability) || text(profileManifest.workspaceCommandAbility) || providerProfile.workspaceCommandAbility || '',
		workspacePublishAbility: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY) || text(profileManifest.workspace_publish_ability) || text(profileManifest.workspacePublishAbility) || providerProfile.workspacePublishAbility || '',
		previewUrlBase: text(env.HOMEBOY_AGENT_RUNTIME_PREVIEW_URL_BASE) || text(profileManifest.preview_url_base) || text(manifest?.preview_url_base),
		workspaceRecipeSchema: text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA) || text(profileManifest.workspace_recipe_schema) || text(manifest?.workspace_recipe_schema) || defaultRuntimeWorkspaceRecipeSchema,
		validationArtifactEnvelopeSchema: text(env.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA) || text(profileManifest.validation_artifact_envelope_schema) || text(manifest?.validation_artifact_envelope_schema) || defaultValidationArtifactEnvelopeSchema,
		visualParityOutputRoot: text(env.VISUAL_PARITY_OUTPUT) || text(env.HOMEBOY_AGENT_RUNTIME_VISUAL_PARITY_OUTPUT) || text(profileManifest.visual_parity_output_root) || text(manifest?.visual_parity_output_root) || defaultVisualParityOutputRoot,
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

export function runtimePackageAbility(contract = readAgentRuntimeContract()) {
	if (!contract || contract === process.env || contract.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY || contract.HOMEBOY_AGENT_RUNTIME_PACKAGE_ABILITY || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST_PATH || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST_PATH) {
		contract = readAgentRuntimeContract(contract);
	}
	return contract.runtimeBundleAbility || runtimeApiAbilities.runRuntimePackage;
}

export function runtimeWorkspaceRecipeSchema(contract = readAgentRuntimeContract()) {
	if (!contract.workspaceRecipeSchema && (contract.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY || contract.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST_PATH || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST_PATH)) {
		contract = readAgentRuntimeContract(contract);
	}
	return contract.workspaceRecipeSchema;
}

export function runtimeValidationArtifactEnvelopeSchema(contract = readAgentRuntimeContract()) {
	if (!contract.validationArtifactEnvelopeSchema && (contract.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY || contract.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST || contract.HOMEBOY_AGENT_RUNTIME_MANIFEST_PATH || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST || contract.HOMEBOY_RUNTIME_PROFILE_MANIFEST_PATH)) {
		contract = readAgentRuntimeContract(contract);
	}
	return contract.validationArtifactEnvelopeSchema;
}

export function resolveVisualParityOutputRoot(env = process.env) {
	return readAgentRuntimeContract(env).visualParityOutputRoot;
}

export function buildRuntimePreviewUrl(options = {}, contract = null) {
	const isOptionsObject = Object.hasOwn(options, 'blueprint') || Object.hasOwn(options, 'evidenceRefs') || Object.hasOwn(options, 'env') || Object.hasOwn(options, 'allowPlaygroundFallback');
	const { blueprint, evidenceRefs = [], env = process.env } = isOptionsObject ? options : { blueprint: options };
	contract = contract || readAgentRuntimeContract(env);
	const evidenceUrl = previewUrlFromEvidenceRefs(Array.isArray(evidenceRefs) ? evidenceRefs : [evidenceRefs]);
	if (evidenceUrl) {
		return evidenceUrl;
	}
	if (env.HOMEBOY_RUNTIME_PREVIEW_URL) {
		return env.HOMEBOY_RUNTIME_PREVIEW_URL;
	}
	if (!contract.previewUrlBase) {
		throw new Error('HOMEBOY_AGENT_RUNTIME_PREVIEW_URL_BASE, runtime manifest preview_url_base, or preview evidence refs are required for runtime preview URLs.');
	}
	return `${contract.previewUrlBase}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}

export function buildRuntimeBlueprintPreviewUrl(blueprint, contract = readAgentRuntimeContract()) {
	return buildRuntimePreviewUrl({ blueprint }, contract);
}

function readRuntimeManifest(env) {
	const inline = text(env.HOMEBOY_AGENT_RUNTIME_MANIFEST || env.HOMEBOY_RUNTIME_PROFILE_MANIFEST);
	if (inline) {
		return JSON.parse(inline);
	}
	const manifestPath = text(env.HOMEBOY_AGENT_RUNTIME_MANIFEST_PATH || env.HOMEBOY_RUNTIME_PROFILE_MANIFEST_PATH);
	if (manifestPath) {
		return JSON.parse(readFileSync(manifestPath, 'utf8'));
	}
	return null;
}

function profileFromManifest(manifest, requestedProfileId) {
	if (!manifest || typeof manifest !== 'object') {
		return {};
	}
	const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : Object.values(manifest.profiles || {});
	const requested = text(requestedProfileId) || text(manifest.default_profile) || text(manifest.defaultProfile);
	return profiles.find((profile) => profile && (profile.id === requested || !requested)) || {};
}

function runtimeProfilesJsonFromManifest(manifest) {
	if (!manifest || typeof manifest !== 'object' || !manifest.profiles) {
		return '';
	}
	if (!Array.isArray(manifest.profiles)) {
		return JSON.stringify(manifest.profiles);
	}
	return JSON.stringify(Object.fromEntries(manifest.profiles.filter((profile) => profile?.id).map((profile) => [profile.id, profile])));
}

function previewUrlFromEvidenceRefs(refs) {
	for (const ref of refs) {
		if (typeof ref === 'string' && /^https?:\/\//.test(ref)) {
			return ref;
		}
		if (!ref || typeof ref !== 'object') {
			continue;
		}
		const candidate = ref.preview_url || ref.url || ref.urls?.preview || ref.preview?.url || ref.evidence?.preview_url;
		if (candidate) {
			return candidate;
		}
	}
	return '';
}

function text(value) {
	return String(value || '').trim();
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function parseJsonObject(value, name) {
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${name} must be a JSON object.`);
	}
	return parsed;
}
