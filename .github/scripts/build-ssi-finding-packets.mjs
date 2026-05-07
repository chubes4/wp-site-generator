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
	let bench;
	try {
		bench = JSON.parse(await readFile(benchPath, 'utf8'));
	} catch {
		return [];
	}

	const summary = findSsiSummary(bench);
	if (!summary) {
		return [];
	}

	const packets = [];
	for (const diagnostic of asArray(summary.fallback_diagnostics)) {
		packets.push(packetFromFallbackDiagnostic(diagnostic));
	}
	for (const finding of asArray(summary.findings)) {
		packets.push(packetFromFinding(finding));
	}

	return dedupePackets(packets);
}

function findSsiSummary(bench) {
	const scenarios = asArray(bench?.data?.results?.scenarios);
	const scenario = scenarios.find((item) => item?.id === 'ssi-import');

	return scenario?.metadata?.import_report_summary || null;
}

function packetBase() {
	return {
		schema_version: schemaVersion,
		site,
		source_repo: sourceRepo,
		source_pr: normalizeNumber(sourcePr),
		source_head_sha: sourceHeadSha,
		source_branch: sourceBranch,
		validation_run_id: normalizeNumber(validationRunId),
		candidate_repo: candidateRepo,
		artifact_names: artifactNames,
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

function packetFromFinding(finding) {
	return {
		...packetBase(),
		kind: text(finding?.kind),
		path: text(finding?.path),
		preview: text(finding?.preview),
		selector: text(finding?.selector),
		excerpt: text(finding?.excerpt),
		source_html_preview: text(finding?.source_html_preview),
		block_name: text(finding?.block_name),
		converter: text(finding?.converter),
		stage: text(finding?.stage),
		reason: text(finding?.reason),
	};
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
			packet.block_name,
			packet.converter,
			packet.stage,
			packet.reason,
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
