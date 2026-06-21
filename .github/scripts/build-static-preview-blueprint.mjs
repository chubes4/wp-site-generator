#!/usr/bin/env node

import { appendGithubOutput, buildCodeboxPlaygroundPreviewUrl, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiPreviewBlueprint, buildSsiPreviewSource, loadSsiStackManifest } from './lib/ssi-stack-runtime.mjs';

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

const source = buildSsiPreviewSource({ repo: sourceRepo, sha: sourceHeadSha, branch });
const manifest = await loadSsiStackManifest(manifestPath);
const blueprint = buildSsiPreviewBlueprint({ site, source, lane, manifest });
const url = buildCodeboxPlaygroundPreviewUrl(blueprint);

if (outputPath) {
	await writeJsonFile(outputPath, { site, lane, branch, source, url, blueprint, stack_manifest: manifest });
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, { url }, { multiline: false });
} else {
	console.log(JSON.stringify({ site, lane, branch, source, url, blueprint, stack_manifest: manifest }, null, 2));
}
