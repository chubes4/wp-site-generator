#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const schemaVersion = 2;
const site = requiredEnv('SITE');
const sourceRepo = requiredEnv('SOURCE_REPO');
const sourcePr = process.env.SOURCE_PR || '';
const sourceHeadSha = process.env.SOURCE_HEAD_SHA || '';
const sourceBranch = process.env.SOURCE_BRANCH || '';
const validationRunId = process.env.VALIDATION_RUN_ID || '';
const benchPath = process.env.BENCH_PATH || 'homeboy-ci-results/bench.json';
const outputPath = process.env.FINDING_PACKETS_PATH || 'homeboy-ci-results/finding-packets.json';
const candidateRepo = process.env.CANDIDATE_REPO || 'chubes4/static-site-importer';
const designPath = process.env.DESIGN_JSON_PATH || `static-sites/${site}/design.json`;
const designDistributionPath = process.env.DESIGN_DISTRIBUTION_PATH || 'homeboy-ci-results/design-distribution.json';
const visualDiffPath = process.env.VISUAL_DIFF_PATH || `visual-parity-artifacts/${site}/visual-diff.json`;
const benchOutcome = (process.env.BENCH_OUTCOME || '').toLowerCase();
const visualOutcome = (process.env.VISUAL_OUTCOME || '').toLowerCase();
const generatorRepo = 'chubes4/wp-site-generator';

const designFields = await loadDesignFields(designPath);

const artifactNames = {
	ssi_validation: `ssi-validation-${site}`,
	visual_parity: `visual-parity-${site}`,
	finding_packets_file: path.basename(outputPath),
	design_distribution_file: path.basename(designDistributionPath),
};

const packets = await buildPackets();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packets, null, 2)}\n`);

await mkdir(path.dirname(designDistributionPath), { recursive: true });
await writeFile(
	designDistributionPath,
	`${JSON.stringify(buildDesignDistribution(), null, 2)}\n`,
);

async function buildPackets() {
	let bench = null;
	let benchReadError = '';
	try {
		bench = JSON.parse(await readFile(benchPath, 'utf8'));
	} catch (error) {
		benchReadError = error?.message || String(error);
	}

	const packets = [];
	const benchFailure = detectBenchFailure(bench, benchReadError);
	if (benchFailure) {
		packets.push(packetFromBenchFailure(benchFailure));
	}

	const summary = findSsiSummary(bench);
	if (!summary) {
		// Bench did not produce a parseable SSI scenario summary. Always emit
		// a routing packet so the iterator has at least one finding to act
		// on instead of receiving an empty payload.
		packets.push(packetFromMissingSummary(benchFailure, benchReadError));
	} else {
		const fallbacks = asArray(summary.fallback_diagnostics);
		const freeforms = asArray(summary.freeform_diagnostics);
		const findings = asArray(summary.findings);
		for (const diagnostic of fallbacks) {
			packets.push(packetFromFallbackDiagnostic(diagnostic));
		}
		for (const diagnostic of freeforms) {
			packets.push(packetFromFreeformDiagnostic(diagnostic));
		}
		for (const finding of findings) {
			packets.push(packetFromFinding(finding));
		}
		// Even on a clean import (no fallbacks, no findings) emit a baseline
		// info packet so the grouped payload always carries at least one
		// candidate-routed entry. The PHP transformer iterator depends on a
		// non-empty group set to do useful work.
		if (fallbacks.length === 0 && freeforms.length === 0 && findings.length === 0) {
			packets.push(packetFromCleanImport(summary));
		}
	}

	const visualDiff = await loadVisualDiff(visualDiffPath);
	if (visualDiff && visualDiff.pass === false) {
		packets.push(packetFromVisualDiff(visualDiff));
	} else if (visualOutcome && visualOutcome !== 'success' && visualOutcome !== 'skipped') {
		packets.push(packetFromVisualOutcome(visualOutcome));
	}

	return dedupePackets(packets);
}

async function loadVisualDiff(inputPath) {
	try {
		return JSON.parse(await readFile(inputPath, 'utf8'));
	} catch {
		return null;
	}
}

function findSsiSummary(bench) {
	const scenarios = asArray(bench?.data?.results?.scenarios);
	const scenario = scenarios.find((item) => item?.id === 'ssi-import');

	return scenario?.metadata?.import_report_summary || null;
}

function detectBenchFailure(bench, benchReadError) {
	if (benchReadError) {
		return {
			source: 'bench_artifact_unreadable',
			detail: benchReadError,
			exit_code: '',
			status: '',
			stderr_tail: '',
		};
	}
	if (!bench || typeof bench !== 'object') {
		return null;
	}
	const data = bench.data && typeof bench.data === 'object' ? bench.data : null;
	const status = text(data?.status);
	const exitCode = data?.exit_code;
	const benchSucceeded = bench.success === true && status !== 'failed' && (exitCode === 0 || exitCode === undefined);
	if (benchSucceeded) {
		return null;
	}
	const failure = data?.failure && typeof data.failure === 'object' ? data.failure : {};
	return {
		source: 'bench_runner',
		detail: '',
		exit_code: exitCode === undefined || exitCode === null ? '' : String(exitCode),
		status,
		stderr_tail: text(failure.stderr_tail),
		component_id: text(failure.component_id),
		component_path: text(failure.component_path),
		scenario_id: text(failure.scenario_id),
	};
}

function packetBase(overrideRepo) {
	return {
		schema_version: schemaVersion,
		site,
		source_repo: sourceRepo,
		source_pr: normalizeNumber(sourcePr),
		source_head_sha: sourceHeadSha,
		source_branch: sourceBranch,
		validation_run_id: normalizeNumber(validationRunId),
		candidate_repo: overrideRepo || candidateRepo,
		artifact_names: artifactNames,
		bench_outcome: benchOutcome,
		visual_outcome: visualOutcome,
		design_system: designFields.design_system,
		palette_kind: designFields.palette_kind,
		typography_kind: designFields.typography_kind,
		layout_kind: designFields.layout_kind,
		density: designFields.density,
		commerce_pattern: designFields.commerce_pattern,
	};
}

function packetFromFallbackDiagnostic(diagnostic) {
	const blockName = text(diagnostic?.block_name);

	return {
		...packetBase(),
		kind: blockName.toLowerCase() === 'core/html' ? 'core_html' : 'fallback',
		path: text(diagnostic?.path),
		preview: text(diagnostic?.preview),
		selector: text(diagnostic?.selector),
		excerpt: text(diagnostic?.excerpt),
		source_html_preview: text(diagnostic?.source_html_preview),
		block_name: blockName,
		converter: text(diagnostic?.converter),
		stage: text(diagnostic?.stage),
		reason: text(diagnostic?.reason),
	};
}

function packetFromFreeformDiagnostic(diagnostic) {
	return {
		...packetBase(),
		kind: 'freeform_block',
		path: text(diagnostic?.path),
		preview: text(diagnostic?.emitted_block_preview) || text(diagnostic?.source_html_preview),
		selector: text(diagnostic?.selector),
		excerpt: text(diagnostic?.excerpt),
		source_html_preview: text(diagnostic?.source_html_preview),
		emitted_block_preview: text(diagnostic?.emitted_block_preview),
		block_name: text(diagnostic?.block_name) || 'core/freeform',
		block_path: text(diagnostic?.block_path),
		converter: text(diagnostic?.converter),
		stage: text(diagnostic?.stage),
		reason: text(diagnostic?.reason),
		malformed: Boolean(diagnostic?.malformed),
		repair_mode: 'pr_or_issue',
	};
}

function packetFromFinding(finding) {
	const kind = text(finding?.kind);
	const sourceHtml = text(finding?.source_html_preview);
	const emittedBlock = text(finding?.emitted_block_preview);
	const isAggregateFreeform = kind.toLowerCase() === 'freeform_block' && !sourceHtml && !emittedBlock;

	return {
		...packetBase(),
		kind,
		path: text(finding?.path),
		preview: text(finding?.preview),
		selector: text(finding?.selector),
		excerpt: text(finding?.excerpt),
		source_html_preview: sourceHtml,
		emitted_block_preview: emittedBlock,
		block_name: text(finding?.block_name),
		converter: text(finding?.converter),
		stage: text(finding?.stage),
		reason: text(finding?.reason),
		repair_mode: isAggregateFreeform ? 'issue_only' : text(finding?.repair_mode),
	};
}

function packetFromBenchFailure(failure) {
	const reasonParts = [];
	if (failure.status) {
		reasonParts.push(`status=${failure.status}`);
	}
	if (failure.exit_code !== '') {
		reasonParts.push(`exit_code=${failure.exit_code}`);
	}
	if (failure.source) {
		reasonParts.push(`source=${failure.source}`);
	}
	if (failure.stderr_tail) {
		reasonParts.push(`stderr_tail=${truncate(failure.stderr_tail, 220)}`);
	}
	if (failure.detail) {
		reasonParts.push(`detail=${truncate(failure.detail, 220)}`);
	}
	const reason = reasonParts.join('; ') || 'Homeboy bench step did not produce a parseable scenario summary.';
	return {
		...packetBase(generatorRepo),
		kind: 'bench_failure',
		path: benchPath,
		preview: truncate(failure.stderr_tail || failure.detail || reason, 180),
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'homeboy-bench',
		stage: failure.source || 'bench_runner',
		reason,
	};
}

function packetFromMissingSummary(failure, benchReadError) {
	const reasonParts = ['SSI workload did not emit import_report_summary metadata.'];
	if (benchReadError) {
		reasonParts.push(`bench_artifact_read_error=${truncate(benchReadError, 180)}`);
	}
	if (failure?.status) {
		reasonParts.push(`bench_status=${failure.status}`);
	}
	if (failure && failure.exit_code !== '') {
		reasonParts.push(`bench_exit_code=${failure.exit_code}`);
	}
	return {
		...packetBase(),
		kind: 'report_missing',
		path: benchPath,
		preview: 'No SSI import_report_summary metadata in bench output.',
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'static-site-importer',
		stage: 'workload',
		reason: reasonParts.join('; '),
	};
}

function packetFromCleanImport(summary) {
	const topKeys = Array.isArray(summary?.top_level_keys) ? summary.top_level_keys.join(',') : '';
	return {
		...packetBase(),
		kind: 'import_clean',
		path: text(summary?.path),
		preview: 'SSI import completed without fallback diagnostics or classified findings.',
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'static-site-importer',
		stage: 'baseline',
		reason: topKeys ? `import_report top_level_keys=${truncate(topKeys, 180)}` : 'import_report present, no fallbacks or findings recorded.',
	};
}

function packetFromVisualOutcome(outcome) {
	return {
		...packetBase(),
		kind: 'visual_parity_outcome',
		path: '.github/scripts/static-visual-parity.mjs',
		preview: `visual parity step outcome=${outcome}`,
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'visual-parity',
		stage: 'screenshots',
		reason: `Static visual parity capture reported outcome=${outcome}; decoupled from packet emission.`,
	};
}

function packetFromVisualDiff(diff) {
	const mismatchPercent = `${(Number(diff.mismatchRatio || 0) * 100).toFixed(2)}%`;
	const thresholdPercent = `${(Number(diff.threshold || 0) * 100).toFixed(2)}%`;
	const sourceSize = `${diff.source?.width || 0}x${diff.source?.height || 0}`;
	const importedSize = `${diff.imported?.width || 0}x${diff.imported?.height || 0}`;
	const regions = visualRegions(diff);
	const topRegion = regions[0] || null;
	const regionSummary = topRegion
		? ` top_region=x:${topRegion.x},y:${topRegion.y},w:${topRegion.width},h:${topRegion.height},mismatch=${formatRatio(topRegion.mismatchRatio)} source=${probeSummary(topRegion.source_matches)} imported=${probeSummary(topRegion.imported_matches)}`
		: '';
	return {
		...packetBase(),
		kind: 'visual_parity_mismatch',
		path: visualDiffPath,
		preview: `source=${sourceSize} imported=${importedSize} mismatch=${mismatchPercent}${regionSummary}`,
		selector: topRegion ? `screenshot region ${topRegion.x},${topRegion.y} ${topRegion.width}x${topRegion.height}` : '',
		excerpt: topRegion ? topRegionExcerpt(topRegion) : '',
		source_html_preview: '',
		block_name: '',
		converter: 'visual-parity',
		stage: 'screenshot_diff',
		reason: `Imported WordPress screenshot differs from source static HTML screenshot: mismatch=${mismatchPercent}, threshold=${thresholdPercent}, mismatched_pixels=${diff.mismatchPixels || 0}, total_pixels=${diff.totalPixels || 0}, dimension_mismatch=${diff.dimensionMismatch ? 'yes' : 'no'}.${regionSummary} See visual-parity artifact files source.png, imported.png, diff.png, and visual-diff.json.`,
		visual_regions: regions,
		visual_code_evidence: topRegion ? visualCodeEvidence(topRegion) : {},
	};
}

function visualRegions(diff) {
	return asArray(diff?.regions)
		.filter((region) => region && typeof region === 'object')
		.slice(0, 8)
		.map((region) => ({
			rank: Number(region.rank || 0),
			x: Number(region.x || 0),
			y: Number(region.y || 0),
			width: Number(region.width || 0),
			height: Number(region.height || 0),
			mismatchPixels: Number(region.mismatchPixels || 0),
			totalPixels: Number(region.totalPixels || 0),
			mismatchRatio: Number(region.mismatchRatio || 0),
			source_matches: visualProbes(region.source_matches),
			imported_matches: visualProbes(region.imported_matches),
			layout_deltas: visualLayoutDeltas(region.layout_deltas),
		}));
}

function visualProbes(probes) {
	return asArray(probes)
		.filter((probe) => probe && typeof probe === 'object')
		.slice(0, 5)
		.map((probe) => ({
			selector: text(probe.selector),
			path: text(probe.path),
			text: truncate(probe.text, 180),
			html: truncate(probe.html, 1000),
			child_summary: truncate(probe.child_summary, 500),
			computed_style: styleSnapshot(probe.computed_style),
			matched_css_rules: cssRules(probe.matched_css_rules),
			rect: probe.rect && typeof probe.rect === 'object' ? {
				x: Number(probe.rect.x || 0),
				y: Number(probe.rect.y || 0),
				width: Number(probe.rect.width || 0),
				height: Number(probe.rect.height || 0),
			} : {},
		}));
}

function visualCodeEvidence(region) {
	return {
		source: asArray(region.source_matches).slice(0, 3).map(probeCodeEvidence),
		imported: asArray(region.imported_matches).slice(0, 3).map(probeCodeEvidence),
	};
}

function probeCodeEvidence(probe) {
	return {
		selector: text(probe.selector),
		path: text(probe.path),
		text: truncate(probe.text, 180),
		html: truncate(probe.html, 1000),
		child_summary: truncate(probe.child_summary, 500),
		computed_style: styleSnapshot(probe.computed_style),
		matched_css_rules: cssRules(probe.matched_css_rules),
	};
}

function visualLayoutDeltas(value) {
	return asArray(value)
		.filter((delta) => delta && typeof delta === 'object')
		.slice(0, 3)
		.map((delta) => ({
			pair: Number(delta.pair || 0),
			source_selector: text(delta.source_selector),
			imported_selector: text(delta.imported_selector),
			source_path: text(delta.source_path),
			imported_path: text(delta.imported_path),
			source_child_summary: truncate(delta.source_child_summary, 500),
			imported_child_summary: truncate(delta.imported_child_summary, 500),
			rect_delta: delta.rect_delta && typeof delta.rect_delta === 'object' ? {
				x: Number(delta.rect_delta.x || 0),
				y: Number(delta.rect_delta.y || 0),
				width: Number(delta.rect_delta.width || 0),
				height: Number(delta.rect_delta.height || 0),
			} : {},
			style_diffs: asArray(delta.style_diffs)
				.filter((diff) => diff && typeof diff === 'object')
				.slice(0, 16)
				.map((diff) => ({
					property: text(diff.property),
					source: truncate(diff.source, 180),
					imported: truncate(diff.imported, 180),
				})),
		}));
}

function styleSnapshot(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const snapshot = {};
	for (const [key, rawValue] of Object.entries(value)) {
		const normalized = truncate(rawValue, 180);
		if (normalized !== '') {
			snapshot[key] = normalized;
		}
	}
	return snapshot;
}

function cssRules(value) {
	return asArray(value)
		.filter((rule) => rule && typeof rule === 'object')
		.slice(0, 8)
		.map((rule) => ({
			selector: text(rule.selector),
			media: text(rule.media),
			css: truncate(rule.css, 700),
		}));
}

function probeSummary(probes) {
	const probe = asArray(probes)[0];
	if (!probe) {
		return 'none';
	}
	return truncate([probe.selector, probe.text, styleSummary(probe.computed_style)].filter(Boolean).join(' '), 160);
}

function styleSummary(style) {
	if (!style || typeof style !== 'object') {
		return '';
	}
	return [
		['display', style.display],
		['font', style['font-family']],
		['size', style['font-size']],
		['bg', style['background-color']],
	]
		.filter(([, value]) => text(value) !== '')
		.map(([key, value]) => `${key}=${text(value)}`)
		.join(' ');
}

function topRegionExcerpt(region) {
	return truncate([
		`region ${region.x},${region.y} ${region.width}x${region.height}`,
		`source: ${probeSummary(region.source_matches)}`,
		`imported: ${probeSummary(region.imported_matches)}`,
	].join('; '), 260);
}

function formatRatio(value) {
	return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function truncate(value, length) {
	const s = text(value);
	return s.length <= length ? s : s.slice(0, length);
}

function dedupePackets(packets) {
	const seen = new Set();
	const deduped = [];

	for (const packet of packets) {
		const key = JSON.stringify([
			packet.kind,
			packet.path,
			packet.preview,
			packet.selector,
			packet.excerpt,
			packet.source_html_preview,
			packet.emitted_block_preview,
			packet.block_name,
			packet.converter,
			packet.stage,
			packet.reason,
			packet.repair_mode,
		]);

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(packet);
	}

	return deduped;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeNumber(value) {
	if (value === '') {
		return '';
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
}

function text(value) {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

async function loadDesignFields(filePath) {
	const fallback = {
		schema_version: '',
		design_system: 'unknown',
		palette_kind: 'unknown',
		typography_kind: 'unknown',
		layout_kind: 'unknown',
		density: 'unknown',
		commerce_pattern: 'unknown',
		accent_palette: [],
		font_family_primary: '',
		font_family_secondary: '',
		notes: '',
		source: 'missing',
	};

	let raw;
	try {
		raw = await readFile(filePath, 'utf8');
	} catch {
		return fallback;
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...fallback, source: 'invalid_json' };
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ...fallback, source: 'invalid_shape' };
	}

	const accent = Array.isArray(parsed.accent_palette)
		? parsed.accent_palette.filter((item) => typeof item === 'string')
		: [];

	return {
		schema_version: numberOrText(parsed.schema_version),
		design_system: stringOr(parsed.design_system, 'unknown'),
		palette_kind: stringOr(parsed.palette_kind, 'unknown'),
		typography_kind: stringOr(parsed.typography_kind, 'unknown'),
		layout_kind: stringOr(parsed.layout_kind, 'unknown'),
		density: stringOr(parsed.density, 'unknown'),
		commerce_pattern: stringOr(parsed.commerce_pattern, 'unknown'),
		accent_palette: accent,
		font_family_primary: stringOr(parsed.font_family_primary, ''),
		font_family_secondary: stringOr(parsed.font_family_secondary, ''),
		notes: stringOr(parsed.notes, ''),
		source: 'design_json',
	};
}

function buildDesignDistribution() {
	return {
		schema_version: 1,
		generated_at: new Date().toISOString(),
		validation_run_id: normalizeNumber(validationRunId),
		source_repo: sourceRepo,
		source_pr: normalizeNumber(sourcePr),
		source_head_sha: sourceHeadSha,
		source_branch: sourceBranch,
		sites: [
			{
				site,
				design_json_path: designPath,
				design_json_status: designFields.source,
				design_system: designFields.design_system,
				palette_kind: designFields.palette_kind,
				typography_kind: designFields.typography_kind,
				layout_kind: designFields.layout_kind,
				density: designFields.density,
				commerce_pattern: designFields.commerce_pattern,
				accent_palette: designFields.accent_palette,
				font_family_primary: designFields.font_family_primary,
				font_family_secondary: designFields.font_family_secondary,
				notes: designFields.notes,
			},
		],
		totals: {
			design_system: { [designFields.design_system]: 1 },
			palette_kind: { [designFields.palette_kind]: 1 },
			typography_kind: { [designFields.typography_kind]: 1 },
			layout_kind: { [designFields.layout_kind]: 1 },
			density: { [designFields.density]: 1 },
			commerce_pattern: { [designFields.commerce_pattern]: 1 },
		},
	};
}

function stringOr(value, fallback) {
	if (typeof value === 'string' && value.trim() !== '') {
		return value;
	}
	return fallback;
}

function numberOrText(value) {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
}
