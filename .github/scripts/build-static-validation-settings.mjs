#!/usr/bin/env node

import { appendGithubOutput, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiValidationSettings, loadSsiStackManifest } from './lib/ssi-stack-runtime.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const lane = args.get('--lane') || process.env.TARGET_LANE || process.env.LANE || 'wordpress';
const outputPath = args.get('--output') || process.env.STATIC_VALIDATION_SETTINGS_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const manifestPath = args.get('--manifest') || process.env.SSI_STACK_MANIFEST_PATH || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const manifest = await loadSsiStackManifest(manifestPath);
const { settings, workloads } = buildSsiValidationSettings({ site, lane, manifest });
const payload = { site, lane, settings, workloads, stack_manifest: manifest };

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
