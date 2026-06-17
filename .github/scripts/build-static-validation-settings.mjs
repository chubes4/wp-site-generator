#!/usr/bin/env node

import { appendGithubOutput, parseArgs, readJsonFile, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiStackManifest } from './lib/ssi-stack-manifest.mjs';
import { buildSsiImportWorkload, buildSsiStackBlueprint, buildSsiStackProfile } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const outputPath = args.get('--output') || process.env.STATIC_VALIDATION_SETTINGS_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const manifestPath = args.get('--manifest') || process.env.SSI_STACK_MANIFEST_PATH || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const workloads = buildWorkloads(site);
const manifest = manifestPath ? await readJsonFile(manifestPath) : buildSsiStackManifest();
const settings = buildSettings(workloads, manifest);
const payload = { site, settings, workloads, stack_manifest: manifest };

if (outputPath) {
	await writeJsonFile(outputPath, payload);
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, {
		settings: JSON.stringify(settings),
		workloads: JSON.stringify(workloads),
		stack_manifest: JSON.stringify(manifest),
	});
} else {
	console.log(JSON.stringify(payload, null, 2));
}

function buildWorkloads(siteSlug) {
	return [buildSsiImportWorkload(siteSlug)];
}

function buildSettings(workloads, manifest) {
	return {
		wp_codebox_blueprint: buildSsiStackBlueprint({}, buildSsiStackProfile(manifest)),
		wp_codebox_workloads: workloads,
	};
}
