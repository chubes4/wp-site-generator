import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export {
	buildRuntimePreviewUrl,
	resolveVisualParityOutputRoot,
	runtimeBundleExecution,
	runtimePackageProfiles,
	runtimePackageAbility,
	runtimeValidationArtifactEnvelopeSchema,
	runtimeWorkspaceRecipeSchema,
	runtimeToolProfileInputs,
	runtimeToolProfiles,
	runtimeWorkflowBuilderExecution,
} from './runtime-domain-inputs.mjs';

export {
	wordpressRuntimeAbilityId,
	wordpressRuntimeApi,
	wordpressRuntimeBlueprintSchema,
	wordpressRuntimePluginMountTarget,
	wordpressRuntimePhpFileStep,
	wordpressRuntimePhpStep,
	wordpressRuntimeRequireWpLoadPhp,
	wordpressRuntimeSettingsDescriptor,
	wordpressRuntimeSettingsFields,
} from './wordpress-runtime-api.mjs';

export {
	homeboyRuntimeApi,
	homeboyRuntimeProviderProfile,
	runtimeProviderInvocationContract,
	runtimeWorkspaceCommandAbility,
	runtimeWorkspacePublishAbility,
} from './homeboy-runtime-api.mjs';
export function parseArgs(argv) {
	const parsed = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}
		const next = argv[i + 1];
		parsed.set(arg, next && !next.startsWith('--') ? next : '1');
		if (next && !next.startsWith('--')) {
			i += 1;
		}
	}
	return parsed;
}

export function requiredValue(name, value) {
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

export function requiredEnv(env, name) {
	return requiredValue(name, env[name]);
}

export function resolveReplayRunId(env = process.env) {
	if (env.GITHUB_RUN_ID) {
		return String(env.GITHUB_RUN_ID);
	}
	if (env.WPSG_REPLAY_ID) {
		return String(env.WPSG_REPLAY_ID);
	}
	if (env.HOMEBOY_REPLAY_ID) {
		return String(env.HOMEBOY_REPLAY_ID);
	}
	throw new Error('GITHUB_RUN_ID is required in GitHub Actions. For local replay plan generation, set WPSG_REPLAY_ID or HOMEBOY_REPLAY_ID explicitly.');
}

export function requireLocalReplaySeed(env = process.env) {
	if (env.GITHUB_RUN_ID || env.WPSG_RANDOMNESS_SEED) {
		return;
	}
	throw new Error('WPSG_RANDOMNESS_SEED is required for local site generation replay plans. GitHub Actions may omit it and derive the seed from GITHUB_RUN_ID.');
}

export function envOrArg(args, argName, env, envName, fallback = '') {
	return args.get(argName) || env[envName] || fallback;
}

export function repoPathResolver(repoRoot = process.env.GITHUB_WORKSPACE || process.cwd()) {
	return (...segments) => path.join(repoRoot, ...segments);
}

export async function writeJsonFile(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function readJsonOrNull(filePath) {
	if (!filePath) {
		return null;
	}
	try {
		return await readJsonFile(filePath);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

export function textValue(value) {
	return String(value ?? '').trim();
}

export function numberValue(value, fallback = 0) {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export async function appendGithubOutput(filePath, values, { multiline = true } = {}) {
	const chunks = [];
	for (const [key, value] of Object.entries(values)) {
		if (!multiline && !String(value).includes('\n')) {
			chunks.push(`${key}=${value}`);
			continue;
		}
		const delimiter = `EOF_${Math.random().toString(16).slice(2)}`;
		chunks.push(`${key}<<${delimiter}\n${value}\n${delimiter}`);
	}
	await writeFile(filePath, `${chunks.join('\n')}\n`, { flag: 'a' });
}

export function readHomeboyAgentRuntimeOverrides(env) {
	return {
		source: 'homeboy-agent-runtime-env',
		runtimeId: env.HOMEBOY_AGENT_RUNTIME || '',
		runtimeBin: env.HOMEBOY_AGENT_RUNTIME_BIN || '',
		provider: env.HOMEBOY_AGENT_RUNTIME_PROVIDER || '',
		model: env.HOMEBOY_AGENT_RUNTIME_MODEL || '',
		providerPluginPaths: splitList(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGIN_PATHS || ''),
		providerPlugins: parseJsonArray(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGINS || ''),
		componentContracts: parseJsonArray(env.HOMEBOY_AGENT_RUNTIME_COMPONENTS || ''),
		secretEnv: splitList(env.HOMEBOY_AGENT_RUNTIME_SECRET_ENV || ''),
		runtimeEnv: parseJsonObject(env.HOMEBOY_AGENT_RUNTIME_ENV || ''),
		runtimeConfigMounts: parseJsonArray(env.HOMEBOY_AGENT_RUNTIME_CONFIG_MOUNTS || ''),
		runtimeStateMounts: parseJsonArray(env.HOMEBOY_AGENT_RUNTIME_STATE_MOUNTS || ''),
	};
}

export function applyHomeboyAgentRuntimeOverrides(config, runtimeTaskInput, runtimeOverrides) {
	if (runtimeOverrides.provider) {
		config.provider = runtimeOverrides.provider;
		runtimeTaskInput.provider = runtimeOverrides.provider;
	}
	if (runtimeOverrides.model) {
		config.model = runtimeOverrides.model;
		runtimeTaskInput.model = runtimeOverrides.model;
	}
	if (runtimeOverrides.providerPluginPaths.length > 0) {
		config.provider_plugin_paths = runtimeOverrides.providerPluginPaths;
	}
	if (runtimeOverrides.providerPlugins) {
		config.provider_plugins = runtimeOverrides.providerPlugins;
	}
	if (runtimeOverrides.componentContracts) {
		config.component_contracts = runtimeOverrides.componentContracts;
	}
	if (runtimeOverrides.secretEnv.length > 0) {
		config.secret_env = runtimeOverrides.secretEnv;
	}
	if (runtimeOverrides.runtimeEnv) {
		config.runtime_env = runtimeOverrides.runtimeEnv;
	}
	if (runtimeOverrides.runtimeConfigMounts) {
		config.runtime_config_mounts = runtimeOverrides.runtimeConfigMounts;
	}
	if (runtimeOverrides.runtimeStateMounts) {
		config.runtime_state_mounts = runtimeOverrides.runtimeStateMounts;
	}
	if (runtimeOverrides.runtimeId) {
		config.runtime_id = runtimeOverrides.runtimeId;
	}
	if (runtimeOverrides.runtimeBin) {
		config.runtime_bin = runtimeOverrides.runtimeBin;
	}
}

export function buildHomeboyAgentRuntimeConfig(runtimeOverrides) {
	return compactObject({
		source: runtimeOverrides.source,
		runtime_id: runtimeOverrides.runtimeId,
		runtime_bin: runtimeOverrides.runtimeBin,
		provider: runtimeOverrides.provider,
		model: runtimeOverrides.model,
		provider_plugin_paths: runtimeOverrides.providerPluginPaths,
		provider_plugins: runtimeOverrides.providerPlugins,
		component_contracts: runtimeOverrides.componentContracts,
		secret_env: runtimeOverrides.secretEnv,
		runtime_env: runtimeOverrides.runtimeEnv,
		runtime_config_mounts: runtimeOverrides.runtimeConfigMounts,
		runtime_state_mounts: runtimeOverrides.runtimeStateMounts,
	});
}

function compactObject(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => {
		if (value === undefined || value === null || value === '') {
			return false;
		}
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		if (typeof value === 'object') {
			return Object.keys(value).length > 0;
		}
		return true;
	}));
}

function splitList(value) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseJsonObject(value) {
	if (!value) {
		return null;
	}
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Expected JSON object');
	}
	return parsed;
}

function parseJsonArray(value) {
	if (!value) {
		return null;
	}
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error('Expected JSON array');
	}
	return parsed;
}
