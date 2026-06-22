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
