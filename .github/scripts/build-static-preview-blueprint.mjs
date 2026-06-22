#!/usr/bin/env node

import { appendGithubOutput, buildRuntimePreviewUrl, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
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
const previewEvidenceRefs = args.get('--preview-evidence-refs') || process.env.HOMEBOY_PREVIEW_EVIDENCE_REFS || process.env.WPSG_PREVIEW_EVIDENCE_REFS || '';
const allowPlaygroundFallback = args.has('--allow-playground-url-fallback') || process.env.WPSG_ALLOW_PLAYGROUND_PREVIEW_URL_FALLBACK === '1';

if (!site) {
	throw new Error('SITE or --site is required.');
}

const source = buildSsiPreviewSource({ repo: sourceRepo, sha: sourceHeadSha, branch });
const manifest = await loadSsiStackManifest(manifestPath);
const blueprint = buildSsiPreviewBlueprint({ site, source, lane, manifest });
const url = buildRuntimePreviewUrl({
	blueprint,
	evidenceRefs: previewEvidenceRefs ? JSON.parse(previewEvidenceRefs) : [],
	allowPlaygroundFallback,
});

if (outputPath) {
	await writeJsonFile(outputPath, { site, lane, branch, source, url, blueprint, stack_manifest: manifest });
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, { url }, { multiline: false });
} else {
	console.log(JSON.stringify({ site, lane, branch, source, url, blueprint, stack_manifest: manifest }, null, 2));
}
