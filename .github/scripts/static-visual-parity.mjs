#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { buildSsiImportAbilityPhp, requiresCommerceStack } from './lib/ssi-stack-profile.mjs';
import { resolveStaticSiteCandidateSource } from './lib/static-site-candidate.mjs';
import { buildSsiRuntimeBlueprint, loadSsiStackManifest } from './lib/ssi-stack-runtime.mjs';

const require = createRequire(import.meta.url);
const { runStaticVisualParity } = require('homeboy-extension-wordpress/static-visual-parity');

const repoRoot = process.cwd();
const requestedSite = process.env.SITE || process.argv[2] || '';
const lane = process.env.TARGET_LANE || process.env.LANE || 'wordpress';
const manifestPath = process.env.SSI_STACK_MANIFEST_PATH || '';
const outputRoot = process.env.VISUAL_PARITY_OUTPUT || 'visual-parity-artifacts';
const sourcePort = Number(process.env.SOURCE_PORT || 4173);
const wpCodeboxCli = process.env.WP_CODEBOX_CLI || path.join(repoRoot, '.ci/wp-codebox/packages/cli/dist/index.js');
const viewport = {
	width: Number(process.env.VISUAL_PARITY_WIDTH || 1280),
	height: Number(process.env.VISUAL_PARITY_HEIGHT || 1600),
};
const maxMismatchRatio = Number(process.env.VISUAL_PARITY_MAX_MISMATCH_RATIO || 0.015);

const candidateSource = await resolveStaticSiteCandidateSource({
	repoRoot,
	site: requestedSite,
	candidatePath: process.env.STATIC_SITE_CANDIDATE_PATH || '',
	sourceStaticSiteDir: process.env.SOURCE_STATIC_SITE_DIR || '',
	requireIndex: true,
});
const site = candidateSource.site;
const siteRoot = candidateSource.sourceDirectory;
const indexPath = path.join(siteRoot, 'index.html');
const outputDir = path.join(repoRoot, outputRoot, site);
const importReadyPath = path.join(outputDir, 'import-ready.json');
const mountedImportReadyPath = toPosix(
	path.join('/wordpress/wp-content/plugins/wp-site-generator', path.relative(repoRoot, importReadyPath))
);
const importViaAbilityPhp = buildSsiImportAbilityPhp({
	htmlPath: `${candidateSource.mountedSourceDirectory}/index.html`,
	siteSlug: site,
	markerPath: mountedImportReadyPath,
	assertActiveTheme: true,
});
if (!existsSync(indexPath)) {
	throw new Error(`Missing source static storefront: ${indexPath}`);
}
if (!existsSync(wpCodeboxCli)) {
	throw new Error(`Missing WP Codebox CLI build: ${wpCodeboxCli}`);
}

await mkdir(outputDir, { recursive: true });
await rm(importReadyPath, { force: true });

const manifest = await loadSsiStackManifest(manifestPath);
const blueprint = buildSsiRuntimeBlueprint({
	lane,
	landingPage: '/',
	steps: [
		{
			step: 'runPHP',
			code: importViaAbilityPhp,
		},
	],
}, manifest);

try {
	await runStaticVisualParity({
		sourceDirectory: siteRoot,
		outputDirectory: outputDir,
		artifactsDirectory: outputDir,
		sourcePort,
		candidateUrl: '/',
		sourceLabel: `static-html-${site}`,
		candidateLabel: `imported-wordpress-${site}`,
		viewport,
		maxMismatchRatio,
		extraVisualArgs: ['max-regions=8'],
		wpCodeboxBin: wpCodeboxCli,
		cwd: repoRoot,
		blueprint,
		mounts: [
			{
				source: repoRoot,
				target: '/wordpress/wp-content/plugins/wp-site-generator',
				mode: 'readonly',
			},
		],
		readinessFile: importReadyPath,
		validateReadiness: (readiness) => {
			if (requiresCommerceStack(lane) && !readiness?.woocommerce_loaded) {
				throw new Error('Visual parity import completed without WooCommerce loaded for commerce lane.');
			}
		},
		metadata: {
			site,
			stack_manifest: manifest,
		},
	});
} catch (error) {
	if (error?.diagnostics) {
		const { writeFile } = await import('node:fs/promises');
		await writeFile(path.join(outputDir, 'frontend-readiness-error.json'), JSON.stringify(error.diagnostics, null, 2));
	}
	throw error;
}

function toPosix(value) {
	return value.split(path.sep).join('/');
}
