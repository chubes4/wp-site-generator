#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

import { buildSsiImportWorkload, buildSsiStackBlueprint } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const outputPath = args.get('--output') || process.env.STATIC_VALIDATION_SETTINGS_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const workloads = buildWorkloads(site);
const settings = buildSettings(workloads);
const payload = { site, settings, workloads };

if (outputPath) {
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
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

function buildSettings(workloads) {
	return {
		wp_codebox_blueprint: buildSsiStackBlueprint(),
		wp_codebox_workloads: workloads,
	};
}

async function appendGithubOutput(filePath, values) {
	const chunks = [];
	for (const [key, value] of Object.entries(values)) {
		const delimiter = `EOF_${Math.random().toString(16).slice(2)}`;
		chunks.push(`${key}<<${delimiter}\n${value}\n${delimiter}`);
	}
	await writeFile(filePath, `${chunks.join('\n')}\n`, { flag: 'a' });
}

function parseArgs(argv) {
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
