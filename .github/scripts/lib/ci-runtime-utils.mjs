import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export {
	resolveVisualParityOutputRoot,
	resolveRuntimeAccessUrl,
	runtimeBundleExecution,
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
