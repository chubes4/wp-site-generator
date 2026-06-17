import { readFile, writeFile } from 'node:fs/promises';

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

export async function writeJsonFile(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
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
		runtimeId: env.HOMEBOY_AGENT_RUNTIME || 'wp-codebox',
		runtimeBin: env.HOMEBOY_AGENT_RUNTIME_BIN || '',
		provider: env.HOMEBOY_AGENT_RUNTIME_PROVIDER || '',
		model: env.HOMEBOY_AGENT_RUNTIME_MODEL || '',
		providerPluginPaths: splitList(env.HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGIN_PATHS || ''),
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
	config.runtime_id = runtimeOverrides.runtimeId;
	if (runtimeOverrides.runtimeBin) {
		config.runtime_bin = runtimeOverrides.runtimeBin;
	}
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
