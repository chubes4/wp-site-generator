#!/usr/bin/env node

import { appendGithubOutput, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildWebsiteArtifactFromSource, resolveStaticSiteCandidateSource } from './lib/static-site-candidate.mjs';
import { buildSsiValidationSettings, loadSsiStackManifest, loadWordPressRuntimeSettingsDescriptor } from './lib/ssi-stack-runtime.mjs';

const args = parseArgs(process.argv.slice(2));
const site = args.get('--site') || process.env.SITE || '';
const lane = args.get('--lane') || process.env.TARGET_LANE || process.env.LANE || 'wordpress';
const outputPath = args.get('--output') || process.env.STATIC_VALIDATION_SETTINGS_PATH || '';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const manifestPath = args.get('--manifest') || process.env.SSI_STACK_MANIFEST_PATH || '';
const runtimeSettingsDescriptorPath = args.get('--runtime-settings-descriptor') || process.env.WORDPRESS_RUNTIME_SETTINGS_DESCRIPTOR_PATH || '.github/homeboy/wordpress-runtime/ssi-validation-settings.descriptor.json';
const candidatePath = args.get('--candidate') || process.env.STATIC_SITE_CANDIDATE_PATH || '';
const sourceStaticSiteDir = args.get('--source-static-site-dir') || process.env.SOURCE_STATIC_SITE_DIR || '';
const materializedRoot = args.get('--materialized-root') || process.env.MATERIALIZED_STATIC_SITE_ROOT || '.ci/static-site-candidates';

const candidateSource = await resolveStaticSiteCandidateSource({ site, candidatePath, sourceStaticSiteDir, materializedRoot });
const websiteArtifact = await buildWebsiteArtifactFromSource(candidateSource);

const manifest = await loadSsiStackManifest(manifestPath);
const runtimeSettingsDescriptor = await loadWordPressRuntimeSettingsDescriptor(runtimeSettingsDescriptorPath);
const { settings, workloads } = buildSsiValidationSettings({ site: candidateSource.site, lane, manifest, websiteArtifact, runtimeSettingsDescriptor });
const payload = { site: candidateSource.site, lane, candidate_source: candidateSource, website_artifact: websiteArtifact, settings, workloads, runtime_settings_descriptor: runtimeSettingsDescriptor, stack_manifest: manifest };

if (outputPath) {
	await writeJsonFile(outputPath, payload);
}

if (githubOutput) {
	await appendGithubOutput(githubOutput, {
		site: candidateSource.site,
		source_static_site_dir: candidateSource.sourceDirectory,
		settings: JSON.stringify(settings),
		workloads: JSON.stringify(workloads),
		wordpress_runtime_workloads: JSON.stringify(settings.wordpress_runtime_workloads),
		stack_manifest: JSON.stringify(manifest),
	});
} else {
	console.log(JSON.stringify(payload, null, 2));
}
