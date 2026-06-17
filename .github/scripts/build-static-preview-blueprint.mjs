#!/usr/bin/env node

import { appendGithubOutput, parseArgs, readJsonFile, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiStackManifest } from './lib/ssi-stack-manifest.mjs';

import { buildSsiImportAbilityPhp, buildSsiStackBlueprint, buildSsiStackProfile } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const branch = args.get('--branch') || process.env.BRANCH || process.env.SOURCE_BRANCH || 'main';
const outputPath = args.get('--output') || process.env.STATIC_PREVIEW_BLUEPRINT_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const manifestPath = args.get('--manifest') || process.env.SSI_STACK_MANIFEST_PATH || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const manifest = manifestPath ? await readJsonFile(manifestPath) : buildSsiStackManifest();
const blueprint = buildBlueprint(site, branch, manifest);
const url = `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(blueprint))}`;

if (outputPath) {
	await writeJsonFile(outputPath, { site, branch, url, blueprint, stack_manifest: manifest });
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, { url }, { multiline: false });
} else {
	console.log(JSON.stringify({ site, branch, url, blueprint, stack_manifest: manifest }, null, 2));
}

function buildBlueprint(siteSlug, branchName, manifest) {
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
	}, buildSsiStackProfile(manifest));
}
