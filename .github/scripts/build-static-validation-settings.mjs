#!/usr/bin/env node

import { appendGithubOutput, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiImportWorkload, buildSsiStackBlueprint } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const lane = args.get('--lane') || process.env.TARGET_LANE || process.env.LANE || 'wordpress';
const outputPath = args.get('--output') || process.env.STATIC_VALIDATION_SETTINGS_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const workloads = buildWorkloads(site);
const settings = buildSettings(workloads, lane);
const payload = { site, lane, settings, workloads };

if (outputPath) {
	await writeJsonFile(outputPath, payload);
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, {
		settings: JSON.stringify(settings),
		workloads: JSON.stringify(workloads),
	});
} else {
	console.log(JSON.stringify(payload, null, 2));
}

function buildWorkloads(siteSlug) {
	return [buildSsiImportWorkload(siteSlug)];
}

function buildSettings(workloads, targetLane) {
	return {
		wp_codebox_blueprint: buildSsiStackBlueprint({ lane: targetLane }),
		wp_codebox_workloads: workloads,
	};
}
