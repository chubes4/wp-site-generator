#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

import { buildSsiImportAbilityPhp, buildSsiStackBlueprint } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const branch = args.get('--branch') || process.env.BRANCH || process.env.SOURCE_BRANCH || 'main';
const outputPath = args.get('--output') || process.env.STATIC_PREVIEW_BLUEPRINT_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const blueprint = buildBlueprint(site, branch);
const url = `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(blueprint))}`;

if (outputPath) {
	await writeFile(outputPath, `${JSON.stringify({ site, branch, url, blueprint }, null, 2)}\n`);
}

if (githubOutput) {
	await writeFile(githubOutput, `url=${url}\n`, { flag: 'a' });
} else {
	console.log(JSON.stringify({ site, branch, url, blueprint }, null, 2));
}

function buildBlueprint(siteSlug, branchName) {
	return buildSsiStackBlueprint({
		landingPage: '/',
		steps: [
			{
				step: 'writeFiles',
				writeToPath: '/tmp/static-site',
				filesTree: {
					resource: 'git:directory',
					url: 'https://github.com/chubes4/wp-site-generator',
					ref: branchName,
					refType: 'branch',
					path: `static-sites/${siteSlug}`,
				},
			},
			{
				step: 'runPHP',
				code: buildSsiImportAbilityPhp({
					htmlPath: '/tmp/static-site/index.html',
					siteSlug,
					trailingNewline: true,
				}),
			},
			{ step: 'login', username: 'admin', password: 'password' },
		],
	});
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
