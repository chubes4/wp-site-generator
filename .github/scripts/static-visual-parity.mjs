#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const site = process.env.SITE || process.argv[2];
const outputRoot = process.env.VISUAL_PARITY_OUTPUT || 'visual-parity-artifacts';
const sourcePort = Number(process.env.SOURCE_PORT || 4173);
const wpCodeboxCli = process.env.WP_CODEBOX_CLI || path.join(repoRoot, '.ci/wp-codebox/packages/cli/dist/index.js');
const viewport = {
	width: Number(process.env.VISUAL_PARITY_WIDTH || 1280),
	height: Number(process.env.VISUAL_PARITY_HEIGHT || 1600),
};
const maxMismatchRatio = Number(process.env.VISUAL_PARITY_MAX_MISMATCH_RATIO || 0.015);

if (!site) {
	throw new Error('Usage: SITE=<slug> node .github/scripts/static-visual-parity.mjs');
}

const siteRoot = path.join(repoRoot, 'static-sites', site);
const indexPath = path.join(siteRoot, 'index.html');
const outputDir = path.join(repoRoot, outputRoot, site);
const importReadyPath = path.join(outputDir, 'import-ready.json');
const mountedImportReadyPath = toPosix(
	path.join('/wordpress/wp-content/plugins/wp-site-generator', path.relative(repoRoot, importReadyPath))
);
const importViaAbilityPhp = [
	'<?php',
	"require_once '/wordpress/wp-load.php';",
	'wp_set_current_user( 1 );',
	"$ability = wp_get_ability( 'static-site-importer/import-theme' );",
	'if ( ! $ability ) {',
	"\tthrow new RuntimeException( 'Static Site Importer import ability is not registered.' );",
	'}',
	'$ability_result = $ability->execute( array(',
	`\t'html_path' => ${phpString(`/wordpress/wp-content/plugins/wp-site-generator/static-sites/${site}/index.html`)},`,
	`\t'slug' => ${phpString(site)},`,
	"\t'activate' => true,",
	"\t'overwrite' => true,",
	"\t'keep_source' => true,",
	') );',
	'if ( is_wp_error( $ability_result ) ) {',
	"\tthrow new RuntimeException( $ability_result->get_error_message() );",
	'}',
	"if ( empty( $ability_result['success'] ) ) {",
	"\t$error = isset( $ability_result['error'] ) && is_array( $ability_result['error'] ) ? $ability_result['error'] : array();",
	"\tthrow new RuntimeException( isset( $error['message'] ) ? (string) $error['message'] : 'Static site import failed.' );",
	'}',
	'$theme = wp_get_theme();',
	`if ( $theme->get_stylesheet() !== ${phpString(site)} ) {`,
	`\tthrow new RuntimeException( 'Expected active theme ${site}, got ' . $theme->get_stylesheet() );`,
	'}',
	'$payload = array(',
	`\t'site' => ${phpString(site)},`,
	"\t'theme' => $theme->get_stylesheet(),",
	"\t'theme_name' => $theme->get( 'Name' ),",
	"\t'active_plugins' => get_option( 'active_plugins' ),",
	"\t'woocommerce_loaded' => class_exists( 'WooCommerce' ),",
	"\t'import_result' => isset( $ability_result['result'] ) ? $ability_result['result'] : null,",
	"\t'time' => time(),",
	');',
	`file_put_contents( ${phpString(mountedImportReadyPath)}, wp_json_encode( $payload ) );`,
].join('\n');
const sourceUrl = `http://127.0.0.1:${sourcePort}/index.html`;
const importedUrl = '/';

if (!existsSync(indexPath)) {
	throw new Error(`Missing source static storefront: ${indexPath}`);
}
if (!existsSync(wpCodeboxCli)) {
	throw new Error(`Missing WP Codebox CLI build: ${wpCodeboxCli}`);
}

await mkdir(outputDir, { recursive: true });
await rm(importReadyPath, { force: true });

const sourceServer = createStaticServer(siteRoot);
await listen(sourceServer, sourcePort);

const recipePath = path.join(tmpdir(), `wp-static-visual-parity-${site}-${Date.now()}.json`);
const blueprint = {
	$schema: 'https://playground.wordpress.net/blueprint-schema.json',
	landingPage: '/',
	preferredVersions: { php: '8.3', wp: 'latest' },
	steps: [
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'wordpress.org/plugins',
				slug: 'woocommerce',
			},
			options: {
				activate: true,
				targetFolderName: 'woocommerce',
			},
		},
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'git:directory',
				url: 'https://github.com/chubes4/block-artifact-compiler',
				ref: 'main',
				refType: 'branch',
			},
			options: {
				activate: true,
				targetFolderName: 'block-artifact-compiler',
			},
		},
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'git:directory',
				url: 'https://github.com/chubes4/block-format-bridge',
				ref: 'main',
				refType: 'branch',
			},
			options: {
				activate: true,
				targetFolderName: 'block-format-bridge',
			},
		},
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'git:directory',
				url: 'https://github.com/chubes4/static-site-importer',
				ref: 'main',
				refType: 'branch',
			},
			options: {
				activate: true,
				targetFolderName: 'static-site-importer',
			},
		},
		{
			step: 'runPHP',
			code: importViaAbilityPhp,
		},
	],
};
const recipe = {
	schema: 'wp-codebox/workspace-recipe/v1',
	runtime: {
		wp: 'latest',
		blueprint,
	},
	inputs: {
		mounts: [
			{
				source: repoRoot,
				target: '/wordpress/wp-content/plugins/wp-site-generator',
				mode: 'readonly',
			},
		],
	},
	workflow: {
		steps: [
			{
				command: 'wordpress.visual-compare',
				args: [
					`source-url=${sourceUrl}`,
					`candidate-url=${importedUrl}`,
					`source-label=static-html-${site}`,
					`candidate-label=imported-wordpress-${site}`,
					`viewport=${viewport.width}x${viewport.height}`,
					'full-page=true',
					'wait-for=domcontentloaded',
					'threshold=0.1',
					'include-aa=true',
					'max-regions=8',
				],
			},
		],
	},
	artifacts: {
		directory: outputDir,
	},
};
await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);

try {
	const codeboxResult = await runWpCodeboxRecipe(recipePath);
	const importReadiness = await readImportMarker(importReadyPath);
	if (!importReadiness.woocommerce_loaded) {
		throw new Error('Visual parity import completed without WooCommerce loaded.');
	}
	const visualDiff = await normalizeCodeboxVisualCompare({ codeboxResult, outputDir });
	await writeSummary({ site, sourceUrl, importedUrl, outputDir, codeboxResult, importReadiness, visualDiff });
	if (!visualDiff.pass) {
		throw new Error(
			`Visual parity mismatch ${formatPercent(visualDiff.mismatchRatio)} exceeds threshold ${formatPercent(visualDiff.threshold)}`
		);
	}
} catch (error) {
	if (error?.diagnostics) {
		await writeFile(path.join(outputDir, 'frontend-readiness-error.json'), JSON.stringify(error.diagnostics, null, 2));
	}
	throw error;
} finally {
	sourceServer.close();
}

async function readImportMarker(markerPath) {
	if (!existsSync(markerPath)) {
		throw new Error(`WP Codebox recipe completed without writing import marker: ${markerPath}`);
	}
	return JSON.parse(await readFile(markerPath, 'utf8'));
}

function createStaticServer(root) {
	const contentTypes = new Map([
		['.css', 'text/css; charset=utf-8'],
		['.html', 'text/html; charset=utf-8'],
		['.js', 'text/javascript; charset=utf-8'],
		['.json', 'application/json; charset=utf-8'],
		['.png', 'image/png'],
		['.jpg', 'image/jpeg'],
		['.jpeg', 'image/jpeg'],
		['.svg', 'image/svg+xml'],
		['.webp', 'image/webp'],
	]);

	return createServer((request, response) => {
		const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
		const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
		const resolvedPath = path.normalize(path.join(root, requestedPath));

		if (!resolvedPath.startsWith(root) || !existsSync(resolvedPath)) {
			response.writeHead(404);
			response.end('Not found');
			return;
		}

		response.writeHead(200, {
			'content-type': contentTypes.get(path.extname(resolvedPath).toLowerCase()) || 'application/octet-stream',
		});
		createReadStream(resolvedPath).pipe(response);
	});
}

function listen(server, port) {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', resolve);
	});
}

async function runWpCodeboxRecipe(recipePath) {
	const output = await runCommand(process.execPath, [wpCodeboxCli, 'recipe-run', '--recipe', recipePath, '--json'], {
		cwd: repoRoot,
	});
	try {
		return JSON.parse(output.stdout);
	} catch (error) {
		throw new Error(`WP Codebox recipe did not emit JSON: ${error.message}\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}`);
	}
}

async function normalizeCodeboxVisualCompare({ codeboxResult, outputDir }) {
	if (codeboxResult?.success !== true) {
		throw new Error(`WP Codebox visual compare failed: ${codeboxResult?.error?.message || JSON.stringify(codeboxResult)}`);
	}
	const artifactDirectory = codeboxResult.artifacts?.directory || outputDir;
	const codeboxVisualDir = path.join(artifactDirectory, 'files', 'browser', 'visual-compare');
	const sourcePath = path.join(outputDir, 'source.png');
	const importedPath = path.join(outputDir, 'imported.png');
	const diffPath = path.join(outputDir, 'diff.png');
	await copyFile(path.join(codeboxVisualDir, 'source.png'), sourcePath);
	await copyFile(path.join(codeboxVisualDir, 'candidate.png'), importedPath);
	await copyFile(path.join(codeboxVisualDir, 'diff.png'), diffPath);

	const codeboxVisualDiff = JSON.parse(await readFile(path.join(codeboxVisualDir, 'visual-diff.json'), 'utf8'));
	const comparison = codeboxVisualDiff.comparison || {};
	const source = comparison.source || {};
	const imported = comparison.candidate || {};
	const diff = comparison.diff || {};
	const totalPixels = Number(comparison.totalPixels || 0);
	const mismatchPixels = Number(comparison.mismatchPixels || 0);
	const mismatchRatio = totalPixels > 0 ? Number(comparison.mismatchRatio || mismatchPixels / totalPixels) : 0;
	const dimensionMismatch = Boolean(comparison.dimensionMismatch);
	const result = {
		pass: mismatchRatio <= maxMismatchRatio && !dimensionMismatch,
		threshold: maxMismatchRatio,
		mismatchPixels,
		totalPixels,
		mismatchRatio,
		dimensionMismatch,
		regions: visualMismatchRegions(comparison.regions || []),
		source: {
			path: path.basename(sourcePath),
			width: Number(source.width || 0),
			height: Number(source.height || 0),
			probes: [],
		},
		imported: {
			path: path.basename(importedPath),
			width: Number(imported.width || 0),
			height: Number(imported.height || 0),
			probes: [],
		},
		diff: {
			path: path.basename(diffPath),
			width: Number(diff.width || 0),
			height: Number(diff.height || 0),
		},
		codeboxVisualCompare: {
			schema: codeboxVisualDiff.schema,
			status: codeboxVisualDiff.status,
			files: codeboxVisualDiff.files,
			artifactDirectory,
		},
	};

	await writeFile(path.join(outputDir, 'visual-diff.json'), `${JSON.stringify(result, null, 2)}\n`);
	return result;
}

function visualMismatchRegions(regions) {
	return regions.slice(0, 8).map((region, index) => {
		const width = Number(region.width || 0);
		const height = Number(region.height || 0);
		const mismatchPixels = Number(region.mismatchPixels || region.pixels || 0);
		const totalPixels = width * height;
		return {
			rank: index + 1,
			x: Number(region.x || 0),
			y: Number(region.y || 0),
			width,
			height,
			mismatchPixels,
			totalPixels,
			mismatchRatio: totalPixels > 0 ? mismatchPixels / totalPixels : 0,
			source_matches: [],
			imported_matches: [],
			layout_deltas: [],
		};
	});
}

async function writeSummary({ site, sourceUrl, importedUrl, outputDir, codeboxResult, importReadiness, visualDiff }) {
	const comparisonHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Static visual parity: ${escapeHtml(site)}</title>
<style>
body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: #1f2937; background: #f3f4f6; }
header { padding: 24px; background: #111827; color: white; }
main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px; }
section { background: white; border: 1px solid #d1d5db; border-radius: 12px; overflow: hidden; }
h2 { margin: 0; padding: 12px 16px; background: #e5e7eb; font-size: 16px; }
img { display: block; width: 100%; height: auto; }
code { color: #d1d5db; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
<h1>Static visual parity: ${escapeHtml(site)}</h1>
<p>Source: <code>${escapeHtml(sourceUrl)}</code></p>
<p>Imported: <code>${escapeHtml(importedUrl)}</code></p>
</header>
<main>
<section><h2>Source static HTML</h2><img src="source.png" alt="Source static storefront screenshot"></section>
<section><h2>Imported WordPress / Static Site Importer</h2><img src="imported.png" alt="Imported WordPress storefront screenshot"></section>
<section><h2>Pixel diff</h2><img src="diff.png" alt="Visual parity diff screenshot"></section>
</main>
</body>
</html>
`;
	await writeFile(path.join(outputDir, 'comparison.html'), comparisonHtml);
	await writeFile(
		path.join(outputDir, 'summary.json'),
		JSON.stringify(
			{
				site,
				sourceUrl,
				importedUrl,
				importReadiness,
				viewport,
				visualDiff,
				artifacts: ['source.png', 'imported.png', 'diff.png', 'visual-diff.json', 'comparison.html'],
				codeboxOutput: {
					schema: codeboxResult.schema,
					artifacts: codeboxResult.artifacts,
				},
			},
			null,
			2
		)
	);
}

function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (data) => {
			stdout += data.toString();
			process.stdout.write(data);
		});
		child.stderr.on('data', (data) => {
			stderr += data.toString();
			process.stderr.write(data);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			reject(new Error(`${command} ${args.join(' ')} exited with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
		});
	});
}

function formatPercent(value) {
	return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function phpString(value) {
	return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function toPosix(value) {
	return value.split(path.sep).join('/');
}
