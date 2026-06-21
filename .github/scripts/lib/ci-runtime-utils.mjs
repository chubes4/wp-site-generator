import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtimeApiAbilities = Object.freeze({
	runRuntimePackage: 'agents/run-runtime-package',
});

export const codeboxRuntimeBackend = Object.freeze({
	provider: 'codebox',
	workspaceCaptureAbility: 'wp-codebox/runner-workspace-capture',
	workspaceCommandAbility: 'wp-codebox/runner-workspace-command',
	workspacePublishAbility: 'wp-codebox/runner-workspace-publish',
	toolCallTranscriptRecordAbility: 'wp-codebox/record-tool-call-transcript',
	artifactHandoffAbility: 'wp-codebox/handoff-artifacts',
});

export const runtimeAbilityNames = Object.freeze({
	workspaceCapture: codeboxRuntimeBackend.workspaceCaptureAbility,
	workspaceCommand: codeboxRuntimeBackend.workspaceCommandAbility,
	workspacePublish: codeboxRuntimeBackend.workspacePublishAbility,
	toolCallTranscriptRecord: codeboxRuntimeBackend.toolCallTranscriptRecordAbility,
	artifactHandoff: codeboxRuntimeBackend.artifactHandoffAbility,
});

export const runtimePackageProfile = Object.freeze({
	id: 'wpsg-agent-runtime-package',
	compatibilityId: 'wpsg-codebox-runtime-package',
	provider: codeboxRuntimeBackend.provider,
	runtimeTaskAbility: runtimeApiAbilities.runRuntimePackage,
	runtimeBundleAbility: runtimeApiAbilities.runRuntimePackage,
	runtimeWorkflowAbility: runtimeApiAbilities.runRuntimePackage,
});

export const runtimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: 'workspace-iteration',
		abilityRequirements: Object.freeze([
			runtimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeBackend.workspaceCommandAbility,
			codeboxRuntimeBackend.workspacePublishAbility,
		]),
		abilityTools: Object.freeze([
			{ name: 'workspace_clone', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_worktree_add', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_read', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_write', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_edit', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_git_status', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_git_commit', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'workspace_git_push', ability: codeboxRuntimeBackend.workspaceCommandAbility },
			{ name: 'create_github_pull_request', ability: codeboxRuntimeBackend.workspacePublishAbility },
			{ name: 'create_github_issue', ability: codeboxRuntimeBackend.workspacePublishAbility },
		]),
	}),
	workspacePublication: Object.freeze({
		id: 'workspace-publication',
		abilityRequirements: Object.freeze([
			runtimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeBackend.workspacePublishAbility,
		]),
		abilityTools: Object.freeze([]),
	}),
});

export function runtimePackageProfiles() {
	const profile = {
		id: runtimePackageProfile.id,
		runtime_task_ability: runtimePackageProfile.runtimeTaskAbility,
		runtime_bundle_ability: runtimePackageProfile.runtimeBundleAbility,
		runtime_workflow_ability: runtimePackageProfile.runtimeWorkflowAbility,
		ability_requirements: [runtimePackageProfile.runtimeTaskAbility],
	};
	return {
		[runtimePackageProfile.id]: profile,
		[runtimePackageProfile.compatibilityId]: {
			...profile,
			id: runtimePackageProfile.compatibilityId,
		},
	};
}

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
	if (runtimeOverrides.runtimeId) {
		config.runtime_id = runtimeOverrides.runtimeId;
	}
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
