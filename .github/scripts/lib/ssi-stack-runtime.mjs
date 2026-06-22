import { codeboxWorkspaceRecipeSchema, readJsonFile, wordpressRuntimeSettingsDescriptor, wordpressRuntimeSettingsFields } from './ci-runtime-utils.mjs';
import { buildSsiStackManifest } from './ssi-stack-manifest.mjs';
import { buildBlocksEnginePhpTransformerProbePhp, buildSsiImportWebsiteArtifactFromDirectoryPhp, buildSsiImportWorkload, buildSsiStackBlueprint, buildSsiStackProfile } from './ssi-stack-profile.mjs';

export const defaultWordPressRuntimeSettingsDescriptorPath = '.github/homeboy/wordpress-runtime/ssi-validation-settings.descriptor.json';

const fallbackWordPressRuntimeSettingsDescriptor = wordpressRuntimeSettingsDescriptor();

export async function loadSsiStackManifest(manifestPath = '') {
	return manifestPath ? await readJsonFile(manifestPath) : buildSsiStackManifest();
}

export async function loadWordPressRuntimeSettingsDescriptor(descriptorPath = defaultWordPressRuntimeSettingsDescriptorPath) {
	return descriptorPath ? await readJsonFile(descriptorPath) : fallbackWordPressRuntimeSettingsDescriptor;
}

export function buildSsiRuntimeProfile(manifest = buildSsiStackManifest()) {
	return buildSsiStackProfile(manifest);
}

export function buildSsiRuntimeBlueprint(options = {}, manifest = buildSsiStackManifest()) {
	return buildSsiStackBlueprint(options, buildSsiRuntimeProfile(manifest));
}

export function buildWordPressRuntimeSettings({ blueprint, workloads = [], descriptor = fallbackWordPressRuntimeSettingsDescriptor } = {}) {
	const fields = wordpressRuntimeSettingsFields(descriptor);
	const settings = {
		[fields.blueprint]: blueprint,
		[fields.workloads]: workloads,
	};

	return settings;
}

export function buildSsiValidationSettings({ site, lane = 'wordpress', manifest = buildSsiStackManifest(), websiteArtifact = null, runtimeSettingsDescriptor = fallbackWordPressRuntimeSettingsDescriptor } = {}) {
	const workloads = [buildSsiImportWorkload(site, { websiteArtifact })];
	const blueprint = buildSsiRuntimeBlueprint({ lane }, manifest);
	return {
		settings: buildWordPressRuntimeSettings({ blueprint, workloads, descriptor: runtimeSettingsDescriptor }),
		workloads,
		runtime_settings_descriptor: runtimeSettingsDescriptor,
	};
}

export function buildSsiPreviewSource({ repo = 'chubes4/wp-site-generator', sha = '', tag = '', artifactSource = '' } = {}) {
	if (sha) {
		return {
			repo,
			ref: sha,
			refType: 'commit',
			provenance: 'immutable-head-sha',
		};
	}
	if (tag) {
		return {
			repo,
			ref: tag,
			refType: 'tag',
			provenance: 'immutable-tag',
		};
	}
	if (artifactSource) {
		return {
			repo,
			artifactSource,
			refType: 'artifact',
			provenance: 'immutable-artifact-source',
		};
	}

	throw new Error('SOURCE_HEAD_SHA, SOURCE_TAG, or SOURCE_ARTIFACT_SOURCE is required for deterministic Playground preview provenance.');
}

export function buildSsiPreviewBlueprint({ site, source, lane = 'wordpress', manifest = buildSsiStackManifest() } = {}) {
	return buildSsiRuntimeBlueprint({
		lane,
		landingPage: '/',
		steps: [
			{
				step: 'writeFiles',
				writeToPath: '/tmp/static-site',
				filesTree: source.artifactSource ? {
					resource: 'url',
					url: source.artifactSource,
				} : {
					resource: 'git:directory',
					url: `https://github.com/${source.repo}`,
					ref: source.ref,
					refType: source.refType,
					path: `static-sites/${site}`,
				},
			},
			{
				step: 'runPHP',
				code: buildBlocksEnginePhpTransformerProbePhp({ trailingNewline: true }),
			},
			{
				step: 'runPHP',
				code: buildSsiImportWebsiteArtifactFromDirectoryPhp({
					sourceDirectory: '/tmp/static-site',
					siteSlug: site,
					trailingNewline: true,
				}),
			},
			{ step: 'login', username: 'admin', password: 'password' },
		],
	}, manifest);
}

export function buildWpCodeboxRecipe({ blueprint, mounts = [], workflowSteps = [], artifactsDirectory = '' } = {}) {
	return {
		schema: codeboxWorkspaceRecipeSchema(),
		runtime: {
			wp: 'latest',
			blueprint,
		},
		inputs: { mounts },
		workflow: { steps: workflowSteps },
		artifacts: {
			directory: artifactsDirectory,
		},
	};
}
