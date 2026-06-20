import { readFileSync } from 'node:fs';

const defaultConfigUrl = new URL('./ssi-stack-manifest.config.json', import.meta.url);
const defaultSsiStackConfig = readSsiStackConfig(defaultConfigUrl);

export const ssiStackRepositories = repositoriesByExportName(defaultSsiStackConfig.repositories);
export const ssiStackHarness = defaultSsiStackConfig.harness;

export function loadSsiStackConfig({ configPath = process.env.SSI_STACK_CONFIG_PATH || '', env = process.env } = {}) {
	const fileConfig = configPath ? readSsiStackConfig(configPath) : defaultSsiStackConfig;
	const overrideConfig = env.SSI_STACK_CONFIG_JSON ? parseConfigJson(env.SSI_STACK_CONFIG_JSON, 'SSI_STACK_CONFIG_JSON') : null;
	return validateSsiStackConfig(mergeSsiStackConfig(fileConfig, overrideConfig));
}

export function buildSsiStackManifest({ harnessSha = '', resolved = {}, config = loadSsiStackConfig() } = {}) {
	return {
		schema_version: 1,
		harness: normalizeEntry({ ...config.harness, sha: harnessSha || resolved[config.harness.id] || '' }),
		repositories: Object.fromEntries(
			Object.values(config.repositories).map((repository) => [
				repository.id,
				normalizeEntry({ ...repository, sha: resolved[repository.id] || '' }),
			])
		),
	};
}

export function manifestEntry(manifest, id) {
	if (manifest?.harness?.id === id) {
		return manifest.harness;
	}

	return manifest?.repositories?.[id] || null;
}

export function gitDirectoryResource(manifest, id) {
	const entry = manifestEntry(manifest, id);
	if (!entry) {
		throw new Error(`Unknown SSI stack manifest entry: ${id}`);
	}

	return {
		resource: 'git:directory',
		url: entry.url,
		ref: entry.sha || entry.ref,
		refType: entry.sha ? 'commit' : entry.ref_type,
		...(entry.path ? { path: entry.path } : {}),
	};
}

export function manifestSummaryRows(manifest) {
	const entries = [manifest?.harness, ...Object.values(manifest?.repositories || {})].filter(Boolean);
	return entries.map((entry) => ({
		label: entry.label || entry.id,
		ref: entry.ref,
		sha: entry.sha || '',
		url: entry.url || '',
	}));
}

function normalizeEntry(entry) {
	return {
		id: entry.id,
		label: entry.label,
		url: entry.url,
		git_url: entry.gitUrl || entry.git_url || entry.url,
		ref: entry.ref,
		ref_type: entry.refType || entry.ref_type,
		sha: entry.sha || '',
		...(entry.path ? { path: entry.path } : {}),
		...(entry.targetFolderName ? { target_folder_name: entry.targetFolderName } : {}),
		...(entry.target_folder_name ? { target_folder_name: entry.target_folder_name } : {}),
	};
}

function readSsiStackConfig(configPath) {
	const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
	return validateSsiStackConfig(parsed);
}

function parseConfigJson(value, source) {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new Error(`${source} must be valid JSON: ${error.message}`);
	}
}

function mergeSsiStackConfig(base, override) {
	if (!override) {
		return base;
	}

	return {
		...base,
		...override,
		harness: { ...base.harness, ...(override.harness || {}) },
		repositories: Object.fromEntries(
			Object.entries(base.repositories).map(([id, repository]) => [
				id,
				{ ...repository, ...(override.repositories?.[id] || {}) },
			])
		),
	};
}

function validateSsiStackConfig(config) {
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('SSI stack config must be a JSON object.');
	}
	if (config.schema_version !== 1) {
		throw new Error('SSI stack config schema_version must be 1.');
	}

	const harness = validateConfigEntry(config.harness, 'harness');
	const repositories = config.repositories;
	if (!repositories || typeof repositories !== 'object' || Array.isArray(repositories)) {
		throw new Error('SSI stack config repositories must be a JSON object.');
	}

	return {
		schema_version: 1,
		harness,
		repositories: Object.fromEntries(
			Object.entries(repositories).map(([id, repository]) => {
				const entry = validateConfigEntry(repository, `repositories.${id}`);
				if (entry.id !== id) {
					throw new Error(`SSI stack config repositories.${id}.id must match its repository key.`);
				}
				return [id, entry];
			})
		),
	};
}

function validateConfigEntry(entry, path) {
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
		throw new Error(`SSI stack config ${path} must be a JSON object.`);
	}

	const normalized = normalizeEntry(entry);
	for (const field of ['id', 'label', 'url', 'git_url', 'ref', 'ref_type']) {
		if (!normalized[field] || typeof normalized[field] !== 'string') {
			throw new Error(`SSI stack config ${path}.${field} must be a non-empty string.`);
		}
	}
	if (!['branch', 'tag', 'commit'].includes(normalized.ref_type)) {
		throw new Error(`SSI stack config ${path}.ref_type must be branch, tag, or commit.`);
	}

	return normalized;
}

function repositoriesByExportName(repositories) {
	return {
		homeboyExtensions: repositories.homeboy_extensions,
		wpCodebox: repositories.wp_codebox,
		staticSiteImporter: repositories.static_site_importer,
		blocksEnginePhpTransformer: repositories.blocks_engine_php_transformer,
		blockFormatBridge: repositories.block_format_bridge,
		blockArtifactCompiler: repositories.block_artifact_compiler,
		htmlToBlocksConverter: repositories.html_to_blocks_converter,
	};
}
