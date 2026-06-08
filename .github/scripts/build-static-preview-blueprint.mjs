#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

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
	return {
		$schema: 'https://playground.wordpress.net/blueprint-schema.json',
		landingPage: '/',
		preferredVersions: { php: '8.3', wp: 'latest' },
		steps: [
			pluginStep('wordpress.org/plugins', 'woocommerce', 'woocommerce'),
			pluginStep('git:directory', 'block-artifact-compiler', 'block-artifact-compiler', 'https://github.com/chubes4/block-artifact-compiler'),
			pluginStep('git:directory', 'block-format-bridge', 'block-format-bridge', 'https://github.com/chubes4/block-format-bridge'),
			pluginStep('git:directory', 'static-site-importer', 'static-site-importer', 'https://github.com/chubes4/static-site-importer'),
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
				code: importPhp(siteSlug),
			},
			{ step: 'login', username: 'admin', password: 'password' },
		],
	};
}

function importPhp(siteSlug) {
	return `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user( 1 );
$ability = wp_get_ability( 'static-site-importer/import-theme' );
if ( ! $ability ) {
	throw new RuntimeException( 'Static Site Importer import ability is not registered.' );
}
$ability_result = $ability->execute( array(
	'html_path' => '/tmp/static-site/index.html',
	'slug' => ${phpString(siteSlug)},
	'activate' => true,
	'overwrite' => true,
	'keep_source' => true,
) );
if ( is_wp_error( $ability_result ) ) {
	throw new RuntimeException( $ability_result->get_error_message() );
}
if ( empty( $ability_result['success'] ) ) {
	$error = isset( $ability_result['error'] ) && is_array( $ability_result['error'] ) ? $ability_result['error'] : array();
	throw new RuntimeException( isset( $error['message'] ) ? (string) $error['message'] : 'Static site import failed.' );
}
`;
}

function phpString(value) {
	return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function pluginStep(resource, slug, targetFolderName, url = '') {
	const pluginData = resource === 'wordpress.org/plugins'
		? { resource, slug }
		: { resource, url, ref: 'main', refType: 'branch' };

	return {
		step: 'installPlugin',
		pluginData,
		options: { activate: true, targetFolderName },
	};
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
