#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSsiStackManifest, loadSsiStackConfig } from '../../.github/scripts/lib/ssi-stack-manifest.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-ssi-stack-manifest-'));
const manifestPath = path.join(tempDir, 'ssi-stack-manifest.json');
const settingsPath = path.join(tempDir, 'settings.json');
const previewPath = path.join(tempDir, 'preview.json');
const sourceStaticSiteDir = path.join(tempDir, 'static-site');
const site = 'issue-test-ref-manifest';

await mkdir(tempDir, { recursive: true });
await mkdir(sourceStaticSiteDir, { recursive: true });
await writeFile(path.join(sourceStaticSiteDir, 'index.html'), '<!doctype html><html><body>Manifest fixture</body></html>');
await writeJson(manifestPath, {
	schema_version: 1,
	harness: manifestEntry('wp_site_generator_validation_harness', 'WP Site Generator validation harness scripts', 'https://github.com/chubes4/wp-site-generator', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
		repositories: {
			homeboy_extensions: manifestEntry('homeboy_extensions', 'Homeboy Extensions', 'https://github.com/Extra-Chill/homeboy-extensions', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
			wp_codebox: manifestEntry('wp_codebox', 'WP Codebox', 'https://github.com/Automattic/wp-codebox', 'cccccccccccccccccccccccccccccccccccccccc'),
			static_site_importer: manifestEntry('static_site_importer', 'Static Site Importer', 'https://github.com/chubes4/static-site-importer', 'dddddddddddddddddddddddddddddddddddddddd'),
			blocks_engine_php_transformer: manifestEntry('blocks_engine_php_transformer', 'Blocks Engine PHP Transformer', 'https://github.com/Automattic/blocks-engine', '9999999999999999999999999999999999999999', { path: 'php-transformer', target_folder_name: 'blocks-engine-php-transformer' }),
		},
	});

const settingsResult = spawnSync(process.execPath, [
	path.join(repoRoot, '.github/scripts/build-static-validation-settings.mjs'),
	'--site', site,
	'--source-static-site-dir', sourceStaticSiteDir,
	'--manifest', manifestPath,
	'--output', settingsPath,
], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(settingsResult.status, 0, settingsResult.stderr || settingsResult.stdout);

const previewResult = spawnSync(process.execPath, [
	path.join(repoRoot, '.github/scripts/build-static-preview-blueprint.mjs'),
	'--site', site,
	'--branch', `static/${site}`,
	'--manifest', manifestPath,
	'--output', previewPath,
], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(previewResult.status, 0, previewResult.stderr || previewResult.stdout);

const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
const preview = JSON.parse(await readFile(previewPath, 'utf8'));

assert.equal(settings.stack_manifest.repositories.static_site_importer.sha, 'dddddddddddddddddddddddddddddddddddddddd');
assert.equal(preview.stack_manifest.repositories.blocks_engine_php_transformer.sha, '9999999999999999999999999999999999999999');

assert.equal(settings.runtime_settings_descriptor.settings_fields.blueprint, 'wordpress_runtime_blueprint');
assert.deepEqual(Object.keys(settings.settings).filter((key) => key.startsWith('wp' + '_codebox_')), []);

const settingsPluginRefs = gitDirectoryRefs(settings.settings.wordpress_runtime_blueprint.steps);
const previewPluginRefs = gitDirectoryRefs(preview.blueprint.steps);
for (const refs of [settingsPluginRefs, previewPluginRefs]) {
	assert.deepEqual(refs, [
		['https://github.com/Automattic/blocks-engine', '9999999999999999999999999999999999999999', 'commit', 'php-transformer'],
		['https://github.com/chubes4/static-site-importer', 'dddddddddddddddddddddddddddddddddddddddd', 'commit', ''],
	]);
}

const previewRunPhp = preview.blueprint.steps.filter((step) => step.step === 'runPHP').map((step) => step.code).join('\n');
const validationRunPhp = settings.workloads.flatMap((workload) => workload.run).filter((step) => step.type === 'php' && step.code).map((step) => step.code).join('\n');
assert.match(previewRunPhp, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'preview probes Blocks Engine php-transformer helpers/classes before import');
assert.match(previewRunPhp, /static-site-importer\/import-website-artifact/, 'preview imports through the website artifact ability');
assert.doesNotMatch(previewRunPhp, /static-site-importer\/import-theme/, 'preview import code stays on the website artifact ability');
assert.match(validationRunPhp, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'validation probes Blocks Engine php-transformer helpers/classes before import');
assert.doesNotMatch(JSON.stringify(settings.settings.wordpress_runtime_blueprint.steps), /block-artifact-compiler|block-format-bridge/, 'validation runtime installs the consolidated transformer stack');
assert.doesNotMatch(JSON.stringify(preview.blueprint.steps), /block-artifact-compiler|block-format-bridge/, 'preview runtime installs the consolidated transformer stack');

const defaultManifest = buildSsiStackManifest();
assert.equal(defaultManifest.repositories.static_site_importer.url, 'https://github.com/chubes4/static-site-importer');
assert.equal(defaultManifest.repositories.static_site_importer.ref, 'main');
assert.equal(defaultManifest.repositories.blocks_engine_php_transformer.url, 'https://github.com/Automattic/blocks-engine');
assert.equal(defaultManifest.repositories.blocks_engine_php_transformer.path, 'php-transformer');

const configPath = path.join(tempDir, 'ssi-stack-config.json');
await writeJson(configPath, {
	schema_version: 1,
	harness: manifestEntry('wp_site_generator_validation_harness', 'WP Site Generator validation harness scripts', 'https://github.com/example/wp-site-generator', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
		repositories: {
			homeboy_extensions: manifestEntry('homeboy_extensions', 'Homeboy Extensions', 'https://github.com/Extra-Chill/homeboy-extensions', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
			wp_codebox: manifestEntry('wp_codebox', 'WP Codebox', 'https://github.com/Automattic/wp-codebox', 'cccccccccccccccccccccccccccccccccccccccc'),
			static_site_importer: manifestEntry('static_site_importer', 'Static Site Importer', 'https://github.com/example/static-site-importer', 'dddddddddddddddddddddddddddddddddddddddd'),
			blocks_engine_php_transformer: manifestEntry('blocks_engine_php_transformer', 'Blocks Engine PHP Transformer', 'https://github.com/Automattic/blocks-engine', '9999999999999999999999999999999999999999', { path: 'php-transformer', target_folder_name: 'blocks-engine-php-transformer' }),
		},
	});
const fileConfigManifest = buildSsiStackManifest({ config: loadSsiStackConfig({ configPath }) });
assert.equal(fileConfigManifest.harness.url, 'https://github.com/example/wp-site-generator');
assert.equal(fileConfigManifest.repositories.static_site_importer.url, 'https://github.com/example/static-site-importer');

const envConfigManifest = buildSsiStackManifest({
	config: loadSsiStackConfig({
		env: {
			SSI_STACK_CONFIG_JSON: JSON.stringify({
				schema_version: 1,
				repositories: {
					blocks_engine_php_transformer: {
						ref: 'release/v1',
						ref_type: 'tag',
					},
				},
			}),
		},
	}),
});
assert.equal(envConfigManifest.repositories.blocks_engine_php_transformer.ref, 'release/v1');
assert.equal(envConfigManifest.repositories.blocks_engine_php_transformer.ref_type, 'tag');
assert.equal(envConfigManifest.repositories.static_site_importer.ref, 'main');

assert.throws(
	() => loadSsiStackConfig({ env: { SSI_STACK_CONFIG_JSON: JSON.stringify({ schema_version: 1, repositories: { static_site_importer: { ref_type: 'floating' } } }) } }),
	/SSI stack config repositories\.static_site_importer\.ref_type must be branch, tag, or commit\./
);

console.log('SSI stack manifest generation passed');

function gitDirectoryRefs(steps) {
	return steps
		.map((step) => step.pluginData)
		.filter((pluginData) => pluginData?.resource === 'git:directory')
		.map((pluginData) => [pluginData.url, pluginData.ref, pluginData.refType, pluginData.path || '']);
}

function manifestEntry(id, label, url, sha, extra = {}) {
	return {
		id,
		label,
		url,
		git_url: `${url}.git`,
		ref: 'main',
		ref_type: 'branch',
		sha,
		...extra,
	};
}

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
