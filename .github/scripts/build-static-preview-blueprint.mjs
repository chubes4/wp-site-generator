#!/usr/bin/env node

import { appendGithubOutput, parseArgs, readJsonFile, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiStackManifest } from './lib/ssi-stack-manifest.mjs';

import { buildSsiImportAbilityPhp, buildSsiStackBlueprint, buildSsiStackProfile } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const branch = args.get('--branch') || process.env.BRANCH || process.env.SOURCE_BRANCH || 'main';
const lane = args.get('--lane') || process.env.TARGET_LANE || process.env.LANE || 'wordpress';
const sourceRepo = args.get('--source-repo') || process.env.SOURCE_REPO || 'chubes4/wp-site-generator';
const sourceHeadSha = args.get('--source-head-sha') || process.env.SOURCE_HEAD_SHA || '';
const outputPath = args.get('--output') || process.env.STATIC_PREVIEW_BLUEPRINT_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const manifestPath = args.get('--manifest') || process.env.SSI_STACK_MANIFEST_PATH || '';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const source = buildSourceProvenance({ sourceRepo, sourceHeadSha, branch });
const manifest = manifestPath ? await readJsonFile(manifestPath) : buildSsiStackManifest();
const blueprint = buildBlueprint(site, source, lane, manifest);
const url = `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(blueprint))}`;

if (outputPath) {
	await writeJsonFile(outputPath, { site, lane, branch, source, url, blueprint, stack_manifest: manifest });
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, { url }, { multiline: false });
} else {
	console.log(JSON.stringify({ site, lane, branch, source, url, blueprint, stack_manifest: manifest }, null, 2));
}

function buildSourceProvenance({ sourceRepo: repo, sourceHeadSha: sha, branch: branchName }) {
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
		ref: branchName,
		refType: 'branch',
		provenance: 'mutable-branch-fallback',
		fallback_reason: 'SOURCE_HEAD_SHA was not provided, so Playground preview must use SOURCE_BRANCH/BRANCH.',
	};
}

function buildBlueprint(siteSlug, source, targetLane, manifest) {
	return buildSsiStackBlueprint({
		lane: targetLane,
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
