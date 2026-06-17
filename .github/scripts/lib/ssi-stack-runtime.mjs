import { readJsonFile } from './ci-runtime-utils.mjs';
import { buildSsiStackManifest } from './ssi-stack-manifest.mjs';
import { buildSsiImportAbilityPhp, buildSsiImportWorkload, buildSsiStackBlueprint, buildSsiStackProfile } from './ssi-stack-profile.mjs';

export async function loadSsiStackManifest(manifestPath = '') {
	return manifestPath ? await readJsonFile(manifestPath) : buildSsiStackManifest();
}

export function buildSsiRuntimeProfile(manifest = buildSsiStackManifest()) {
	return buildSsiStackProfile(manifest);
}

export function buildSsiRuntimeBlueprint(options = {}, manifest = buildSsiStackManifest()) {
	return buildSsiStackBlueprint(options, buildSsiRuntimeProfile(manifest));
}

export function buildSsiValidationSettings({ site, lane = 'wordpress', manifest = buildSsiStackManifest(), sourceHtmlPath = '' } = {}) {
	const workloads = [buildSsiImportWorkload(site, { htmlPath: sourceHtmlPath })];
	return {
		settings: {
			wp_codebox_blueprint: buildSsiRuntimeBlueprint({ lane }, manifest),
			wp_codebox_workloads: workloads,
		},
		workloads,
	};
}

export function buildSsiPreviewSource({ repo = 'chubes4/wp-site-generator', sha = '', branch = 'main' } = {}) {
	if (sha) {
		return {
			repo,
			ref: sha,
			refType: 'commit',
			provenance: 'immutable-head-sha',
		};
	}

	return {
		repo,
		ref: branch,
		refType: 'branch',
		provenance: 'mutable-branch-fallback',
		fallback_reason: 'SOURCE_HEAD_SHA was not provided, so Playground preview must use SOURCE_BRANCH/BRANCH.',
	};
}

export function buildSsiPreviewBlueprint({ site, source, lane = 'wordpress', manifest = buildSsiStackManifest() } = {}) {
	return buildSsiRuntimeBlueprint({
		lane,
		landingPage: '/',
		steps: [
			{
				step: 'writeFiles',
				writeToPath: '/tmp/static-site',
				filesTree: {
					resource: 'git:directory',
					url: `https://github.com/${source.repo}`,
					ref: source.ref,
					refType: source.refType,
					path: `static-sites/${site}`,
				},
			},
			{
				step: 'runPHP',
				code: buildSsiImportAbilityPhp({
					htmlPath: '/tmp/static-site/index.html',
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
		schema: 'wp-codebox/workspace-recipe/v1',
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
