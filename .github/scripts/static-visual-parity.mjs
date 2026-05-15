#!/usr/bin/env node

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { waitForWordPressReady } = require('homeboy-extension-wordpress/playground-readiness');

const repoRoot = process.cwd();
const site = process.env.SITE || process.argv[2];
const outputRoot = process.env.VISUAL_PARITY_OUTPUT || 'visual-parity-artifacts';
const sourcePort = Number(process.env.SOURCE_PORT || 4173);
const wordpressPort = Number(process.env.WORDPRESS_PORT || 9400);
const playgroundCli = process.env.PLAYGROUND_CLI || path.join(repoRoot, 'node_modules/.bin/wp-playground-cli');
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
const importedUrl = `http://127.0.0.1:${wordpressPort}/`;

if (!existsSync(indexPath)) {
	throw new Error(`Missing source static storefront: ${indexPath}`);
}
if (!existsSync(playgroundCli)) {
	throw new Error(`Missing wp-playground-cli binary: ${playgroundCli}`);
}

await mkdir(outputDir, { recursive: true });
await rm(importReadyPath, { force: true });

const sourceServer = createStaticServer(siteRoot);
await listen(sourceServer, sourcePort);

const blueprintPath = path.join(tmpdir(), `wp-static-visual-parity-${site}-${Date.now()}.json`);
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
		{ step: 'login', username: 'admin', password: 'password' },
	],
};
await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));

const playground = spawn(
	playgroundCli,
	[
		'server',
		'--port',
		String(wordpressPort),
		'--workers',
		'6',
		'--php',
		'8.3',
		'--wp',
		'latest',
		'--blueprint',
		blueprintPath,
		'--mount',
		`${repoRoot}:/wordpress/wp-content/plugins/wp-site-generator`,
		'--login',
	],
	{ stdio: ['ignore', 'pipe', 'pipe'] }
);

let playgroundOutput = '';
playground.stdout.on('data', (data) => {
	playgroundOutput += data.toString();
	process.stdout.write(data);
});
playground.stderr.on('data', (data) => {
	playgroundOutput += data.toString();
	process.stderr.write(data);
});

try {
	const importReadiness = await waitForImportMarker(importReadyPath, 180_000, () => playground.exitCode !== null);
	if (!importReadiness.woocommerce_loaded) {
		throw new Error('Visual parity import completed without WooCommerce loaded.');
	}
	const wordpressReadiness = await waitForWordPressReady(importedUrl, {
		timeoutMs: 120_000,
		readyOnSelfRedirect: true,
		playgroundProcess: playground,
		playgroundOutput: () => playgroundOutput,
	});
	if (wordpressReadiness.status === 'process_exited') {
		throw new Error(`Playground server exited before WordPress became available: ${importedUrl}`);
	}
	const visualDiff = await captureParityScreenshots({ sourceUrl, importedUrl, outputDir });
	await writeSummary({ site, sourceUrl, importedUrl, outputDir, playgroundOutput, importReadiness, visualDiff });
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
	if (playground.exitCode === null) {
		playground.kill('SIGTERM');
	}
}

async function waitForImportMarker(markerPath, timeoutMs, shouldStop) {
	const started = Date.now();
	let lastError = null;

	while (Date.now() - started < timeoutMs) {
		if (shouldStop()) {
			throw new Error(`Playground server exited before import marker was written: ${markerPath}`);
		}

		if (existsSync(markerPath)) {
			try {
				return JSON.parse(await readFile(markerPath, 'utf8'));
			} catch (error) {
				lastError = error;
			}
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for import marker ${markerPath}: ${lastError?.message || 'not written'}`);
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

async function captureParityScreenshots({ sourceUrl, importedUrl, outputDir }) {
	const browser = await chromium.launch();
	try {
		const sourcePath = path.join(outputDir, 'source.png');
		const importedPath = path.join(outputDir, 'imported.png');
		const diffPath = path.join(outputDir, 'diff.png');
		const sourceCapture = await screenshot(browser, sourceUrl, sourcePath);
		const importedCapture = await screenshot(browser, importedUrl, importedPath);
		return await writeVisualDiff({ sourcePath, importedPath, diffPath, outputDir, sourceCapture, importedCapture });
	} finally {
		await browser.close();
	}
}

async function writeVisualDiff({ sourcePath, importedPath, diffPath, outputDir, sourceCapture, importedCapture }) {
	const source = PNG.sync.read(await readFile(sourcePath));
	const imported = PNG.sync.read(await readFile(importedPath));
	const width = Math.max(source.width, imported.width);
	const height = Math.max(source.height, imported.height);
	const normalizedSource = normalizePng(source, width, height);
	const normalizedImported = normalizePng(imported, width, height);
	const diff = new PNG({ width, height });
	const mismatchPixels = pixelmatch(normalizedSource.data, normalizedImported.data, diff.data, width, height, {
		threshold: 0.1,
		includeAA: true,
	});
	const totalPixels = width * height;
	const mismatchRatio = totalPixels > 0 ? mismatchPixels / totalPixels : 0;
	const dimensionMismatch = source.width !== imported.width || source.height !== imported.height;
	const regions = visualMismatchRegions({
		source: normalizedSource,
		imported: normalizedImported,
		width,
		height,
		sourceProbes: sourceCapture?.probes || [],
		importedProbes: importedCapture?.probes || [],
	});
	const result = {
		pass: mismatchRatio <= maxMismatchRatio && !dimensionMismatch,
		threshold: maxMismatchRatio,
		mismatchPixels,
		totalPixels,
		mismatchRatio,
		dimensionMismatch,
		regions,
		source: {
			path: path.basename(sourcePath),
			width: source.width,
			height: source.height,
			probes: sourceCapture?.probes || [],
		},
		imported: {
			path: path.basename(importedPath),
			width: imported.width,
			height: imported.height,
			probes: importedCapture?.probes || [],
		},
		diff: {
			path: path.basename(diffPath),
			width,
			height,
		},
	};

	await writeFile(diffPath, PNG.sync.write(diff));
	await writeFile(path.join(outputDir, 'visual-diff.json'), `${JSON.stringify(result, null, 2)}\n`);
	return result;
}

function visualMismatchRegions({ source, imported, width, height, sourceProbes, importedProbes }) {
	const tileSize = 32;
	const minTileMismatchPixels = 12;
	const maxRegions = 8;
	const tileColumns = Math.ceil(width / tileSize);
	const tileRows = Math.ceil(height / tileSize);
	const activeTiles = new Map();

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (!pixelDiffers(source.data, imported.data, (y * width + x) * 4)) {
				continue;
			}

			const tileKey = `${Math.floor(x / tileSize)},${Math.floor(y / tileSize)}`;
			activeTiles.set(tileKey, (activeTiles.get(tileKey) || 0) + 1);
		}
	}

	const active = new Set(
		[...activeTiles.entries()]
			.filter(([, count]) => count >= minTileMismatchPixels)
			.map(([key]) => key)
	);
	const visited = new Set();
	const regions = [];

	for (const key of active) {
		if (visited.has(key)) {
			continue;
		}

		const queue = [key];
		visited.add(key);
		let minTileX = Infinity;
		let minTileY = Infinity;
		let maxTileX = -1;
		let maxTileY = -1;
		let regionMismatchPixels = 0;

		while (queue.length) {
			const current = queue.shift();
			const [tileX, tileY] = current.split(',').map(Number);
			minTileX = Math.min(minTileX, tileX);
			minTileY = Math.min(minTileY, tileY);
			maxTileX = Math.max(maxTileX, tileX);
			maxTileY = Math.max(maxTileY, tileY);
			regionMismatchPixels += activeTiles.get(current) || 0;

			for (const [nextX, nextY] of [
				[tileX - 1, tileY],
				[tileX + 1, tileY],
				[tileX, tileY - 1],
				[tileX, tileY + 1],
			]) {
				if (nextX < 0 || nextY < 0 || nextX >= tileColumns || nextY >= tileRows) {
					continue;
				}

				const nextKey = `${nextX},${nextY}`;
				if (!active.has(nextKey) || visited.has(nextKey)) {
					continue;
				}

				visited.add(nextKey);
				queue.push(nextKey);
			}
		}

		const x = minTileX * tileSize;
		const y = minTileY * tileSize;
		const regionWidth = Math.min(width - x, (maxTileX - minTileX + 1) * tileSize);
		const regionHeight = Math.min(height - y, (maxTileY - minTileY + 1) * tileSize);
		const totalRegionPixels = regionWidth * regionHeight;
		regions.push({
			x,
			y,
			width: regionWidth,
			height: regionHeight,
			mismatchPixels: regionMismatchPixels,
			totalPixels: totalRegionPixels,
			mismatchRatio: totalRegionPixels > 0 ? regionMismatchPixels / totalRegionPixels : 0,
			source_matches: matchingProbes(sourceProbes, { x, y, width: regionWidth, height: regionHeight }),
			imported_matches: matchingProbes(importedProbes, { x, y, width: regionWidth, height: regionHeight }),
		});
	}

	return regions
		.sort((a, b) => b.mismatchPixels - a.mismatchPixels)
		.slice(0, maxRegions)
		.map((region, index) => ({ rank: index + 1, ...region }));
}

function pixelDiffers(sourceData, importedData, offset) {
	const red = Math.abs(sourceData[offset] - importedData[offset]);
	const green = Math.abs(sourceData[offset + 1] - importedData[offset + 1]);
	const blue = Math.abs(sourceData[offset + 2] - importedData[offset + 2]);
	const alpha = Math.abs(sourceData[offset + 3] - importedData[offset + 3]);
	return red + green + blue + alpha > 48;
}

function matchingProbes(probes, region) {
	return probes
		.map((probe) => ({ probe, overlap: rectOverlap(region, probe.rect || {}) }))
		.filter((item) => item.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, 5)
		.map((item) => item.probe);
}

function rectOverlap(a, b) {
	const left = Math.max(Number(a.x || 0), Number(b.x || 0));
	const top = Math.max(Number(a.y || 0), Number(b.y || 0));
	const right = Math.min(Number(a.x || 0) + Number(a.width || 0), Number(b.x || 0) + Number(b.width || 0));
	const bottom = Math.min(Number(a.y || 0) + Number(a.height || 0), Number(b.y || 0) + Number(b.height || 0));
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function normalizePng(image, width, height) {
	const normalized = new PNG({ width, height });
	for (let offset = 0; offset < normalized.data.length; offset += 4) {
		normalized.data[offset] = 255;
		normalized.data[offset + 1] = 255;
		normalized.data[offset + 2] = 255;
		normalized.data[offset + 3] = 255;
	}

	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			const sourceOffset = (y * image.width + x) * 4;
			const targetOffset = (y * width + x) * 4;
			normalized.data[targetOffset] = image.data[sourceOffset];
			normalized.data[targetOffset + 1] = image.data[sourceOffset + 1];
			normalized.data[targetOffset + 2] = image.data[sourceOffset + 2];
			normalized.data[targetOffset + 3] = image.data[sourceOffset + 3];
		}
	}

	return normalized;
}

async function screenshot(browser, url, outputPath) {
	const page = await browser.newPage({ viewport });
	try {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
		await page.evaluate(async () => {
			const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const viewportHeight = window.innerHeight;
			for (let y = 0; y < document.body.scrollHeight; y += viewportHeight) {
				window.scrollTo(0, y);
				await delay(100);
			}
			window.scrollTo(0, 0);
			await Promise.race([
				Promise.all(
					Array.from(document.images)
						.filter((img) => !img.complete)
						.map(
							(img) =>
								new Promise((resolve) => {
									img.addEventListener('load', resolve, { once: true });
									img.addEventListener('error', resolve, { once: true });
								})
						)
				),
				delay(5000),
			]);
		});
		await page.addStyleTag({
			content: `
				#wpadminbar { display: none !important; }
				html { margin-top: 0 !important; }
				::-webkit-scrollbar { display: none !important; }
				html, body { scrollbar-width: none !important; }
			`,
		});
		const probes = await page.evaluate(() => {
			const computedStyleProperties = [
				'display',
				'position',
				'box-sizing',
				'width',
				'height',
				'min-height',
				'margin-top',
				'margin-right',
				'margin-bottom',
				'margin-left',
				'padding-top',
				'padding-right',
				'padding-bottom',
				'padding-left',
				'gap',
				'row-gap',
				'column-gap',
				'font-family',
				'font-size',
				'font-weight',
				'line-height',
				'letter-spacing',
				'grid-template-columns',
				'grid-template-rows',
				'align-items',
				'justify-content',
				'background-color',
				'border-radius',
			];

			function cssEscape(value) {
				return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
					? CSS.escape(value)
					: String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
			}

			function elementSelector(element) {
				const id = element.id ? `#${cssEscape(element.id)}` : '';
				const classes = Array.from(element.classList || []).slice(0, 3).map((className) => `.${cssEscape(className)}`).join('');
				return `${element.tagName.toLowerCase()}${id}${classes}`;
			}

			function textPreview(element) {
				return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
			}

			function htmlPreview(element) {
				return (element.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
			}

			function computedStyleSnapshot(element) {
				const computed = window.getComputedStyle(element);
				const snapshot = {};
				for (const property of computedStyleProperties) {
					snapshot[property] = computed.getPropertyValue(property);
				}
				return snapshot;
			}

			function matchingCssRules(element) {
				const matches = [];
				for (const sheet of Array.from(document.styleSheets || [])) {
					let rules = [];
					try {
						rules = Array.from(sheet.cssRules || []);
					} catch {
						continue;
					}
					collectMatchingRules(element, rules, matches);
					if (matches.length >= 12) {
						break;
					}
				}
				return matches.slice(0, 12);
			}

			function collectMatchingRules(element, rules, matches, media = '') {
				for (const rule of rules) {
					if (matches.length >= 12) {
						return;
					}
					if ('cssRules' in rule && rule.cssRules) {
						const condition = rule.conditionText || media;
						collectMatchingRules(element, Array.from(rule.cssRules), matches, condition);
						continue;
					}
					if (!rule.selectorText || !rule.style) {
						continue;
					}
					const selectors = String(rule.selectorText).split(',').map((selector) => selector.trim()).filter(Boolean);
					const matchedSelector = selectors.find((selector) => {
						try {
							return element.matches(selector);
						} catch {
							return false;
						}
					});
					if (!matchedSelector) {
						continue;
					}
					matches.push({
						selector: matchedSelector,
						media,
						css: String(rule.cssText || '').replace(/\s+/g, ' ').trim().slice(0, 700),
					});
				}
			}

			const candidates = Array.from(
				document.querySelectorAll('header, nav, main, section, article, aside, footer, h1, h2, h3, p, a, button, img, figure, figcaption, .wp-block-group, .wp-block-cover, .wp-block-columns, .wp-block-button')
			);

			return candidates
				.map((element) => {
					const rect = element.getBoundingClientRect();
					return {
						selector: elementSelector(element),
						text: textPreview(element),
						html: htmlPreview(element),
						computed_style: computedStyleSnapshot(element),
						matched_css_rules: matchingCssRules(element),
						rect: {
							x: Math.round(rect.left + window.scrollX),
							y: Math.round(rect.top + window.scrollY),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						},
					};
				})
				.filter((probe) => probe.rect.width > 0 && probe.rect.height > 0)
				.slice(0, 300);
		});
		await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
		return { path: outputPath, probes };
	} finally {
		await page.close();
	}
}

async function writeSummary({ site, sourceUrl, importedUrl, outputDir, playgroundOutput, importReadiness, visualDiff }) {
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
				playgroundOutputTail: playgroundOutput.slice(-4000),
			},
			null,
			2
		)
	);
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
