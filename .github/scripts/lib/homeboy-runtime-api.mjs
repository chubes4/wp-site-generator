const missingRuntimeContractMessage = 'WPSG requires HOMEBOY_AGENT_RUNTIME_PROVIDER_INVOCATION_CONTRACT from the upstream runtime provider contract.';

export const homeboyRuntimeApi = Object.freeze({
	visualParity: Object.freeze({
		outputRoot: 'visual-parity-artifacts',
	}),
});

export function runtimeProviderInvocationContract(env = process.env) {
	const contract = parseJsonObject(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_INVOCATION_CONTRACT, 'HOMEBOY_AGENT_RUNTIME_PROVIDER_INVOCATION_CONTRACT');
	if (!contract) {
		throw new Error(missingRuntimeContractMessage);
	}
	return contract;
}

export function resolveVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || homeboyRuntimeApi.visualParity.outputRoot;
}

export function runtimeWorkspaceRecipeSchema(env = process.env) {
	return requiredContractValue('HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA', env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA);
}

export function runtimeValidationArtifactEnvelopeSchema(env = process.env) {
	return requiredContractValue('HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA', env.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA);
}

export function runtimeWorkspaceCommandAbility(env = process.env) {
	return requiredContractValue('provider invocation contract abilities.workspaceCommand', runtimeProviderInvocationContract(env).abilities?.workspaceCommand);
}

export function runtimeWorkspacePublishAbility(env = process.env) {
	return requiredContractValue('provider invocation contract abilities.workspacePublish', runtimeProviderInvocationContract(env).abilities?.workspacePublish);
}

export function homeboyRuntimeProviderProfile(env = process.env) {
	const profile = parseJsonObject(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON, 'HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON');
	if (!profile) {
		throw new Error('WPSG requires HOMEBOY_AGENT_RUNTIME_PROVIDER_PROFILE_JSON from the upstream runtime provider profile.');
	}
	return {
		...profile,
		workspaceCommandAbility: profile.workspaceCommandAbility || runtimeWorkspaceCommandAbility(env),
		workspacePublishAbility: profile.workspacePublishAbility || runtimeWorkspacePublishAbility(env),
	};
}

export function buildRuntimePreviewUrl({ evidenceRefs = [], env = process.env } = {}) {
	const refs = Array.isArray(evidenceRefs) ? evidenceRefs : (evidenceRefs ? [evidenceRefs] : []);
	const evidenceUrl = previewUrlFromEvidenceRefs(refs.length > 0 ? refs : parseEvidenceRefs(env.HOMEBOY_PREVIEW_EVIDENCE_REFS || env.WPSG_PREVIEW_EVIDENCE_REFS));
	if (evidenceUrl) {
		return evidenceUrl;
	}
	if (env.HOMEBOY_RUNTIME_PREVIEW_URL) {
		return env.HOMEBOY_RUNTIME_PREVIEW_URL;
	}
	throw new Error('WPSG requires preview evidence refs from HOMEBOY_PREVIEW_EVIDENCE_REFS or HOMEBOY_RUNTIME_PREVIEW_URL.');
}

function parseEvidenceRefs(value) {
	if (!value) {
		return [];
	}
	const parsed = JSON.parse(value);
	return Array.isArray(parsed) ? parsed : [parsed];
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

function requiredContractValue(name, value) {
	if (!value) {
		throw new Error(`WPSG requires ${name} from the upstream runtime contract.`);
	}
	return value;
}

function parseJsonObject(value, name) {
	if (!value) {
		return null;
	}
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${name} must be a JSON object.`);
	}
	return parsed;
}
