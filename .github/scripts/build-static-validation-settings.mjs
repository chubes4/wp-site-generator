#!/usr/bin/env node

import { appendGithubOutput, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';

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
	return [
		{
			id: 'ssi-import',
			label: `Static Site Importer: ${siteSlug}`,
			run: [
				{
					type: 'wp-cli',
					command: `static-site-importer import-theme /wordpress/wp-content/plugins/wp-site-generator/static-sites/${siteSlug}/index.html --slug=${siteSlug} --activate --overwrite --keep-source --format=json`,
					parse: 'json',
				},
				{
					type: 'php',
					file: '.github/homeboy/ssi-import-diagnostics.php',
				},
			],
			artifacts: {
				import_report: {
					path: `wp-content/themes/${siteSlug}/import-report.json`,
					kind: 'json',
					label: 'Static Site Importer report',
				},
			},
		},
	];
}

function buildSettings(workloads) {
	return {
		wp_codebox_blueprint: {
			$schema: 'https://playground.wordpress.net/blueprint-schema.json',
			preferredVersions: { php: '8.3', wp: 'latest' },
			steps: [
				pluginStep('wordpress.org/plugins', 'woocommerce', 'woocommerce'),
				pluginStep('git:directory', 'block-artifact-compiler', 'block-artifact-compiler', 'https://github.com/chubes4/block-artifact-compiler'),
				pluginStep('git:directory', 'block-format-bridge', 'block-format-bridge', 'https://github.com/chubes4/block-format-bridge'),
				pluginStep('git:directory', 'static-site-importer', 'static-site-importer', 'https://github.com/chubes4/static-site-importer'),
			],
		},
		wp_codebox_workloads: workloads,
	};
}

function pluginStep(resource, slug, targetFolderName, url = '') {
	const pluginData = resource === 'wordpress.org/plugins'
		? { resource, slug }
		: { resource, url, ref: 'main', refType: 'branch' };

	return {
		step: 'installPlugin',
		pluginData,
		options: {
			activate: true,
			targetFolderName,
		},
	};
}
