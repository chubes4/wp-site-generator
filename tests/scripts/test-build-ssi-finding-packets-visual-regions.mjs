#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tmp = await mkdtemp(path.join(tmpdir(), 'ssi-visual-regions-'));
const benchPath = path.join(tmp, 'bench.json');
const visualDiffPath = path.join(tmp, 'visual-diff.json');
const outputPath = path.join(tmp, 'finding-packets.json');

await writeFile(
	benchPath,
	JSON.stringify({
		success: true,
		data: {
			status: 'success',
			results: {
				scenarios: [
					{
						id: 'ssi-import',
						metadata: {
							import_report_summary: {
								path: 'import-report.json',
								fallback_diagnostics: [],
								findings: [],
							},
						},
					},
				],
			},
		},
	})
);

await writeFile(
	visualDiffPath,
	JSON.stringify({
		pass: false,
		threshold: 0.015,
		mismatchPixels: 900,
		totalPixels: 10000,
		mismatchRatio: 0.09,
		dimensionMismatch: false,
		source: { width: 100, height: 100 },
		imported: { width: 100, height: 100 },
		regions: [
			{
				rank: 1,
				x: 0,
				y: 32,
				width: 100,
				height: 64,
				mismatchPixels: 800,
				totalPixels: 6400,
				mismatchRatio: 0.125,
				source_matches: [
					{
						selector: 'section.hero',
						path: 'body > main > section.hero',
						text: 'Original hero copy',
						html: '<section class="hero"><h1>Original hero copy</h1></section>',
						child_summary: 'h1',
						computed_style: {
							display: 'grid',
							'font-size': '48px',
							'background-color': 'rgb(17, 24, 39)',
						},
						matched_css_rules: [
							{ selector: '.hero', media: '', css: '.hero { display: grid; }' },
						],
						rect: { x: 0, y: 32, width: 100, height: 64 },
					},
				],
				imported_matches: [
					{
						selector: 'main.wp-block-group',
						path: 'body > main.wp-block-group',
						text: 'Imported hero copy',
						html: '<main class="wp-block-group"><h1>Imported hero copy</h1></main>',
						child_summary: 'h1',
						computed_style: {
							display: 'block',
							'font-size': '40px',
							'background-color': 'rgba(0, 0, 0, 0)',
						},
						matched_css_rules: [
							{ selector: '.wp-block-group', media: '', css: '.wp-block-group { display: block; }' },
						],
						rect: { x: 0, y: 32, width: 100, height: 64 },
					},
				],
				layout_deltas: [
					{
						pair: 1,
						source_selector: 'section.hero',
						imported_selector: 'main.wp-block-group',
						source_path: 'body > main > section.hero',
						imported_path: 'body > main.wp-block-group',
						source_child_summary: 'h1',
						imported_child_summary: 'h1',
						rect_delta: { x: 0, y: 0, width: 0, height: 0 },
						style_diffs: [
							{ property: 'display', source: 'grid', imported: 'block' },
							{ property: 'font-size', source: '48px', imported: '40px' },
						],
					},
				],
			},
		],
	})
);

const result = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-ssi-finding-packets.mjs')], {
	cwd: repoRoot,
	env: {
		...process.env,
		SITE: 'demo-store',
		SOURCE_REPO: 'chubes4/wp-site-generator',
		BENCH_PATH: benchPath,
		VISUAL_DIFF_PATH: visualDiffPath,
		FINDING_PACKETS_PATH: outputPath,
		DESIGN_DISTRIBUTION_PATH: path.join(tmp, 'design-distribution.json'),
	},
	encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const packets = JSON.parse(await readFile(outputPath, 'utf8'));
const visualPacket = packets.find((packet) => packet.kind === 'visual_parity_mismatch');
assert.ok(visualPacket, 'Expected visual parity packet');
assert.equal(visualPacket.selector, 'screenshot region 0,32 100x64');
assert.equal(visualPacket.visual_regions.length, 1);
assert.equal(visualPacket.visual_regions[0].source_matches[0].selector, 'section.hero');
assert.equal(visualPacket.visual_regions[0].source_matches[0].computed_style.display, 'grid');
assert.equal(visualPacket.visual_regions[0].source_matches[0].path, 'body > main > section.hero');
assert.match(visualPacket.visual_regions[0].source_matches[0].html, /<section/);
assert.equal(visualPacket.visual_regions[0].source_matches[0].matched_css_rules[0].selector, '.hero');
assert.equal(visualPacket.visual_regions[0].layout_deltas[0].style_diffs[0].property, 'display');
assert.equal(visualPacket.visual_code_evidence.imported[0].computed_style['font-size'], '40px');
assert.match(visualPacket.preview, /top_region=x:0,y:32,w:100,h:64/);
assert.match(visualPacket.excerpt, /Original hero copy/);
