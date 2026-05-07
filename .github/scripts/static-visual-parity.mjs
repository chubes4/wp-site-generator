#!/usr/bin/env node

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

if (!site) {
	throw new Error('Usage: SITE=<slug> node .github/scripts/static-visual-parity.mjs');
}

const siteRoot = path.join(repoRoot, 'static-sites', site);
const indexPath = path.join(siteRoot, 'index.html');
const outputDir = path.join(repoRoot, outputRoot, site);
const sourceUrl = `http://127.0.0.1:${sourcePort}/index.html`;
const importedUrl = `http://127.0.0.1:${wordpressPort}/`;

if (!existsSync(indexPath)) {
	throw new Error(`Missing source static storefront: ${indexPath}`);
}
if (!existsSync(playgroundCli)) {
	throw new Error(`Missing wp-playground-cli binary: ${playgroundCli}`);
}

await mkdir(outputDir, { recursive: true });

const sourceServer = createStaticServer(siteRoot);
await listen(sourceServer, sourcePort);

const blueprintPath = path.join(tmpdir(), `wc-static-visual-parity-${site}-${Date.now()}.json`);
const blueprint = {
	$schema: 'https://playground.wordpress.net/blueprint-schema.json',
	landingPage: '/',
	preferredVersions: { php: '8.3', wp: 'latest' },
	steps: [
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
			step: 'wp-cli',
			command:
				`wp static-site-importer import-theme /wordpress/wp-content/plugins/wc-site-generator/static-sites/${site}/index.html ` +
				`--slug=${site} --activate --overwrite --keep-source --format=json`,
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
		'--php',
		'8.3',
		'--wp',
		'latest',
		'--blueprint',
		blueprintPath,
		'--mount',
		`${repoRoot}:/wordpress/wp-content/plugins/wc-site-generator`,
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
	await waitForUrl(importedUrl, 120_000, () => playground.exitCode !== null);
	const importReadiness = await waitForImportedTheme({
		url: importedUrl,
		site,
		indexPath,
		timeoutMs: 120_000,
		shouldStop: () => playground.exitCode !== null,
	});
	await captureParityScreenshots({ sourceUrl, importedUrl, outputDir });
	await writeSummary({ site, sourceUrl, importedUrl, outputDir, playgroundOutput, importReadiness });
} finally {
	sourceServer.close();
	if (playground.exitCode === null) {
		playground.kill('SIGTERM');
	}
}

async function waitForImportedTheme({ url, site, indexPath, timeoutMs, shouldStop }) {
	const started = Date.now();
	const expectedText = await getExpectedStorefrontText(indexPath, site);
	const themeMarker = `wp-content/themes/${site}`;
	let lastError = null;

	while (Date.now() - started < timeoutMs) {
		if (shouldStop()) {
			throw new Error(`Playground server exited before the ${site} import became visible`);
		}

		try {
			const response = await fetch(`${url}?visual-parity-ready=${Date.now()}`, {
				headers: { 'cache-control': 'no-cache' },
			});
			const html = await response.text();
			const normalizedHtml = normalizeText(html);

			if (html.includes(themeMarker)) {
				return { marker: themeMarker, source: 'theme_path' };
			}

			if (expectedText && normalizedHtml.includes(normalizeText(expectedText))) {
				return { marker: expectedText, source: 'source_text' };
			}

			lastError = new Error(`import markers not visible yet; HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(
		`Timed out waiting for imported ${site} theme at ${url}: ${lastError?.message || 'no response'}`
	);
}

async function getExpectedStorefrontText(indexPath, site) {
	const html = await readFile(indexPath, 'utf8');
	const candidates = [
		matchTagText(html, 'h1'),
		matchTagText(html, 'title'),
		humanizeSlug(site),
	].filter(Boolean);

	return candidates.find((candidate) => normalizeText(candidate).length >= 6) || '';
}

function matchTagText(html, tagName) {
	const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
	return match ? stripTags(match[1]) : '';
}

function stripTags(value) {
	return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).trim();
}

function decodeHtmlEntities(value) {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'");
}

function humanizeSlug(value) {
	return value
		.split('-')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function normalizeText(value) {
	return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
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

async function waitForUrl(url, timeoutMs, shouldStop) {
	const started = Date.now();
	let lastError = null;

	while (Date.now() - started < timeoutMs) {
		if (shouldStop()) {
			throw new Error(`Playground server exited before ${url} became available`);
		}

		try {
			const response = await fetch(url);
			if (response.ok || [301, 302, 401, 403].includes(response.status)) {
				return;
			}
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
}

async function captureParityScreenshots({ sourceUrl, importedUrl, outputDir }) {
	const browser = await chromium.launch();
	try {
		await screenshot(browser, sourceUrl, path.join(outputDir, 'source.png'));
		await screenshot(browser, importedUrl, path.join(outputDir, 'imported.png'));
	} finally {
		await browser.close();
	}
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
		await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
	} finally {
		await page.close();
	}
}

async function writeSummary({ site, sourceUrl, importedUrl, outputDir, playgroundOutput, importReadiness }) {
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
				artifacts: ['source.png', 'imported.png', 'comparison.html'],
				playgroundOutputTail: playgroundOutput.slice(-4000),
			},
			null,
			2
		)
	);
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
