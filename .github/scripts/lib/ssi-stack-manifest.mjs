export const ssiStackRepositories = {
	homeboyExtensions: {
		id: 'homeboy_extensions',
		label: 'Homeboy Extensions',
		url: 'https://github.com/Extra-Chill/homeboy-extensions',
		gitUrl: 'https://github.com/Extra-Chill/homeboy-extensions.git',
		ref: 'main',
		refType: 'branch',
	},
	wpCodebox: {
		id: 'wp_codebox',
		label: 'WP Codebox',
		url: 'https://github.com/Automattic/wp-codebox',
		gitUrl: 'https://github.com/Automattic/wp-codebox.git',
		ref: 'main',
		refType: 'branch',
	},
	staticSiteImporter: {
		id: 'static_site_importer',
		label: 'Static Site Importer',
		url: 'https://github.com/chubes4/static-site-importer',
		gitUrl: 'https://github.com/chubes4/static-site-importer.git',
		ref: 'main',
		refType: 'branch',
		targetFolderName: 'static-site-importer',
	},
	blockFormatBridge: {
		id: 'block_format_bridge',
		label: 'Block Format Bridge',
		url: 'https://github.com/chubes4/block-format-bridge',
		gitUrl: 'https://github.com/chubes4/block-format-bridge.git',
		ref: 'main',
		refType: 'branch',
		targetFolderName: 'block-format-bridge',
	},
	blockArtifactCompiler: {
		id: 'block_artifact_compiler',
		label: 'Block Artifact Compiler',
		url: 'https://github.com/chubes4/block-artifact-compiler',
		gitUrl: 'https://github.com/chubes4/block-artifact-compiler.git',
		ref: 'main',
		refType: 'branch',
		targetFolderName: 'block-artifact-compiler',
	},
	htmlToBlocksConverter: {
		id: 'html_to_blocks_converter',
		label: 'HTML to Blocks Converter',
		url: 'https://github.com/chubes4/html-to-blocks-converter',
		gitUrl: 'https://github.com/chubes4/html-to-blocks-converter.git',
		ref: 'main',
		refType: 'branch',
		targetFolderName: 'html-to-blocks-converter',
	},
};

export const ssiStackHarness = {
	id: 'wp_site_generator_validation_harness',
	label: 'WP Site Generator validation harness scripts',
	url: 'https://github.com/chubes4/wp-site-generator',
	gitUrl: 'https://github.com/chubes4/wp-site-generator.git',
	ref: 'main',
	refType: 'branch',
};

export function buildSsiStackManifest({ harnessSha = '', resolved = {} } = {}) {
	return {
		schema_version: 1,
		harness: normalizeEntry({ ...ssiStackHarness, sha: harnessSha || resolved[ssiStackHarness.id] || '' }),
		repositories: Object.fromEntries(
			Object.values(ssiStackRepositories).map((repository) => [
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
		...(entry.targetFolderName ? { target_folder_name: entry.targetFolderName } : {}),
	};
}
