#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { candidateRepoFromDiagnostic } from './lib/finding-routing.mjs';
import { resolveStaticSiteCandidateSource } from './lib/static-site-candidate.mjs';
import { loadJsonOrNull, loadRecoveredSsiImportSummary } from './lib/ssi-import-summary.mjs';
import { ssiAggregateQualityMetrics } from './lib/ssi-metrics.mjs';
import {
	categoryFromDiagnostic,
	converterFromDiagnostic,
	dedupeFindingPackets,
	kindFromDiagnostic,
	numberOrString,
	repairClassFromDiagnostic,
	repairModeFromDiagnostic,
	ssiFindingPacketSchemaVersion,
	stageFromDiagnostic,
	text,
} from './lib/ssi-finding-packets.mjs';
import {
	formatRatio,
	normalizeVisualRegions,
	probeSummary,
	visualCodeEvidenceFromRegion,
	visualRegionSummary,
} from './lib/visual-artifacts.mjs';

const requestedSite = process.env.SITE || '';
const candidatePath = process.env.STATIC_SITE_CANDIDATE_PATH || '';
const sourceStaticSiteDir = process.env.SOURCE_STATIC_SITE_DIR || '';
const candidateSource = candidatePath || sourceStaticSiteDir
	? await resolveStaticSiteCandidateSource({ site: requestedSite, candidatePath, sourceStaticSiteDir })
	: null;
const site = candidateSource?.site || requiredEnv('SITE');
const sourceRepo = requiredEnv('SOURCE_REPO');
const sourcePr = process.env.SOURCE_PR || '';
const sourceHeadSha = process.env.SOURCE_HEAD_SHA || '';
const sourceBranch = process.env.SOURCE_BRANCH || '';
const validationRunId = process.env.VALIDATION_RUN_ID || '';
const benchPath = process.env.BENCH_PATH || 'homeboy-ci-results/bench.json';
const outputPath = process.env.FINDING_PACKETS_PATH || 'homeboy-ci-results/finding-packets.json';
const candidateRepo = process.env.CANDIDATE_REPO || 'chubes4/static-site-importer';
const designPath = process.env.DESIGN_JSON_PATH || (candidateSource ? path.join(candidateSource.sourceDirectory, 'design.json') : `static-sites/${site}/design.json`);
const designDistributionPath = process.env.DESIGN_DISTRIBUTION_PATH || 'homeboy-ci-results/design-distribution.json';
const visualDiffPath = process.env.VISUAL_DIFF_PATH || `visual-parity-artifacts/${site}/visual-diff.json`;
const visualSummaryPath = process.env.VISUAL_SUMMARY_PATH || `visual-parity-artifacts/${site}/summary.json`;
const importReadyPath = process.env.IMPORT_READY_PATH || `visual-parity-artifacts/${site}/import-ready.json`;
const benchOutcome = (process.env.BENCH_OUTCOME || '').toLowerCase();
const visualOutcome = (process.env.VISUAL_OUTCOME || '').toLowerCase();
const generatorRepo = 'chubes4/wp-site-generator';

const designFields = await loadDesignFields(designPath);

const artifactNames = {
	ssi_validation: `ssi-validation-${site}`,
	visual_parity: `visual-parity-${site}`,
	finding_packet_set: path.basename(outputPath),
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
	const recoveredImportReadiness = await loadImportReadiness();

	const packets = [];
	const benchFailure = detectBenchFailure(bench, benchReadError);
	if (benchFailure) {
		packets.push(packetFromBenchFailure(benchFailure));
	}

	const summary = findSsiSummary(bench) || recoveredImportReadiness?.import_report_summary || null;
	if (!summary) {
		// If the bench runner itself failed, the generator-routed bench_failure
		// packet above is the actionable root-cause signal. Do not also route a
		// synthetic missing-report packet to SSI for a scenario that never ran.
		if (!benchFailure) {
			packets.push(packetFromMissingSummary(benchFailure, benchReadError));
		}
	} else {
		const diagnostics = asArray(summary.diagnostics);
		const aggregateDiagnostics = aggregateQualityDiagnostics(summary, recoveredImportReadiness);
		for (const diagnostic of diagnostics) {
			packets.push(packetFromModernDiagnostic(diagnostic, summary));
		}
		for (const diagnostic of aggregateDiagnostics) {
			packets.push(packetFromModernDiagnostic(diagnostic, summary));
		}
		// Even on a clean import emit a baseline
		// info packet so the grouped payload always carries at least one
		// candidate-routed entry. The PHP transformer iterator depends on a
		// non-empty group set to do useful work.
		if (diagnostics.length === 0 && aggregateDiagnostics.length === 0) {
			packets.push(packetFromCleanImport(summary));
		}
	}

	const visualDiff = await loadVisualDiff(visualDiffPath);
	if (visualDiff && visualDiff.pass === false) {
		packets.push(packetFromVisualDiff(visualDiff));
	} else if (visualOutcome && visualOutcome !== 'success' && visualOutcome !== 'skipped') {
		packets.push(packetFromVisualOutcome(visualOutcome));
	}

	return dedupeFindingPackets(packets, { scope: 'packet_emission' });
}

async function loadImportReadiness() {
	return loadRecoveredSsiImportSummary([visualSummaryPath, importReadyPath]);
}

async function loadJson(inputPath) {
	return loadJsonOrNull(inputPath);
}

async function loadVisualDiff(inputPath) {
	return loadJson(inputPath);
}

function findSsiSummary(bench) {
	const scenarios = asArray((bench?.data?.payload || bench?.data)?.results?.scenarios);
	const scenario = scenarios.find((item) => item?.id === 'ssi-import');

	return scenario?.metadata?.import_report_summary || null;
}

function aggregateQualityDiagnostics(summary, readiness = null) {
	const diagnostics = [];
	const quality = summary?.quality && typeof summary.quality === 'object'
		? summary.quality
		: readiness?.import_result?.quality && typeof readiness.import_result.quality === 'object'
			? readiness.import_result.quality
			: {};
	const diagnosticRefs = quality.diagnostic_refs && typeof quality.diagnostic_refs === 'object' ? quality.diagnostic_refs : {};
	const reportPath = text(summary?.path) || text(readiness?.import_result?.report_path) || 'import-report.json';
	const entryFile = text(summary?.entry_file) || text(readiness?.import_result?.source_dir) || reportPath;

	for (const config of ssiAggregateQualityMetrics) {
		const count = numeric(summary?.[config.metric]) ?? numeric(quality?.[config.metric]);
		if (!count || count <= 0) {
			continue;
		}
		diagnostics.push({
			diagnostic_id: `${config.type}-${site}`,
			type: config.type,
			category: 'fallback_block',
			reason_code: config.reason_code,
			suggested_repair_class: 'converter_support',
			candidate_repo: 'chubes4/html-to-blocks-converter',
			converter: 'html-to-blocks-converter',
			stage: 'generated_theme_block_analysis',
			block_name: config.block_name,
			source_path: entryFile,
			message: `${config.message} count=${count}`,
			excerpt: `${config.metric}=${count}`,
			diagnostic_refs: asArray(diagnosticRefs[config.metric]),
			repair_mode: 'issue_only',
		});
	}

	return diagnostics;
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
	const data = bench.data && typeof bench.data === 'object'
		? bench.data.payload && typeof bench.data.payload === 'object'
			? bench.data.payload
			: bench.data
		: null;
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
		schema_version: ssiFindingPacketSchemaVersion,
		site,
		source_repo: sourceRepo,
		source_pr: numberOrString(sourcePr),
		source_head_sha: sourceHeadSha,
		source_branch: sourceBranch,
		validation_run_id: numberOrString(validationRunId),
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

function packetFromModernDiagnostic(diagnostic, summary) {
	const type = text(diagnostic?.type) || 'import_diagnostic';
	const category = text(diagnostic?.category) || categoryFromDiagnostic(type, diagnostic);
	const reasonCode = text(diagnostic?.reason_code) || text(diagnostic?.reason) || type;
	const blockName = text(diagnostic?.block_name);
	const sourcePath = text(diagnostic?.source_path) || text(diagnostic?.path);
	const suggestedRepairClass = text(diagnostic?.suggested_repair_class) || repairClassFromDiagnostic(type);
	const repairMode = text(diagnostic?.repair_mode) || repairModeFromDiagnostic(diagnostic, category, suggestedRepairClass);
	const routedCandidateRepo = candidateRepoFromDiagnostic(diagnostic, type, category, suggestedRepairClass);

	return {
		...packetBase(routedCandidateRepo),
		diagnostic_id: text(diagnostic?.diagnostic_id) || text(diagnostic?.id),
		kind: kindFromDiagnostic(type, category, blockName),
		source_path: sourcePath,
		path: sourcePath,
		severity: text(diagnostic?.severity) || 'warning',
		category,
		reason_code: reasonCode,
		suggested_repair_class: suggestedRepairClass,
		preview: text(diagnostic?.message) || text(diagnostic?.excerpt) || reasonCode,
		selector: text(diagnostic?.selector),
		excerpt: text(diagnostic?.excerpt) || text(diagnostic?.message),
		source_html_preview: text(diagnostic?.source_html_preview),
		emitted_block_preview: text(diagnostic?.emitted_block_preview),
		block_name: blockName,
		block_path: text(diagnostic?.block_path),
		converter: text(diagnostic?.converter) || converterFromDiagnostic(type, category),
		stage: text(diagnostic?.stage) || stageFromDiagnostic(type, category),
		reason: text(diagnostic?.message) || reasonCode,
		diagnostic_refs: diagnosticRefs(diagnostic, summary),
		asset_map_refs: assetMapRefs(diagnostic, summary),
		repair_mode: repairMode,
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
		diagnostic_id: 'bench-runner-failure',
		kind: 'bench_failure',
		source_path: benchPath,
		path: benchPath,
		severity: 'error',
		category: 'generator_policy',
		reason_code: failure.source || 'bench_runner_failure',
		suggested_repair_class: 'repair_validation_harness',
		preview: truncate(failure.stderr_tail || failure.detail || reason, 180),
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'homeboy-bench',
		stage: failure.source || 'bench_runner',
		reason,
		diagnostic_refs: [],
		asset_map_refs: [],
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
		diagnostic_id: 'import-report-missing',
		kind: 'report_missing',
		source_path: benchPath,
		path: benchPath,
		severity: 'error',
		category: 'import_report',
		reason_code: 'import_report_summary_missing',
		suggested_repair_class: 'emit_import_report_summary',
		preview: 'No SSI import_report_summary metadata in bench output.',
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'static-site-importer',
		stage: 'workload',
		reason: reasonParts.join('; '),
		diagnostic_refs: [],
		asset_map_refs: [],
	};
}

function packetFromCleanImport(summary) {
	const topKeys = Array.isArray(summary?.top_level_keys) ? summary.top_level_keys.join(',') : '';
	return {
		...packetBase(),
		diagnostic_id: 'import-clean',
		kind: 'import_clean',
		source_path: text(summary?.path),
		path: text(summary?.path),
		severity: 'info',
		category: 'import_report',
		reason_code: 'import_clean',
		suggested_repair_class: '',
		preview: 'SSI import completed without machine-actionable diagnostics.',
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'static-site-importer',
		stage: 'baseline',
		reason: topKeys ? `import_report top_level_keys=${truncate(topKeys, 180)}` : 'import_report present, no diagnostics recorded.',
		diagnostic_refs: [],
		asset_map_refs: [],
	};
}

function packetFromVisualOutcome(outcome) {
	return {
		...packetBase(generatorRepo),
		diagnostic_id: `visual-parity-outcome-${outcome || 'unknown'}`,
		kind: 'visual_parity_outcome',
		source_path: '.github/scripts/static-visual-parity.mjs',
		path: '.github/scripts/static-visual-parity.mjs',
		severity: 'warning',
		category: 'visual_parity',
		reason_code: `visual_outcome_${outcome || 'unknown'}`,
		suggested_repair_class: 'inspect_visual_parity_policy',
		preview: `visual parity step outcome=${outcome}`,
		selector: '',
		excerpt: '',
		source_html_preview: '',
		block_name: '',
		converter: 'visual-parity',
		stage: 'screenshots',
		reason: `Static visual parity capture reported outcome=${outcome}; decoupled from packet emission.`,
		diagnostic_refs: [],
		asset_map_refs: [],
	};
}

function packetFromVisualDiff(diff) {
	const mismatchPercent = `${(Number(diff.mismatchRatio || 0) * 100).toFixed(2)}%`;
	const thresholdPercent = `${(Number(diff.threshold || 0) * 100).toFixed(2)}%`;
	const sourceSize = `${diff.source?.width || 0}x${diff.source?.height || 0}`;
	const importedSize = `${diff.imported?.width || 0}x${diff.imported?.height || 0}`;
	const regions = normalizePacketVisualRegions(diff?.regions);
	const topRegion = regions[0] || null;
	const regionSummary = topRegion
		? ` top_region=x:${topRegion.x},y:${topRegion.y},w:${topRegion.width},h:${topRegion.height},mismatch=${formatRatio(topRegion.mismatchRatio)} source=${probeSummary(topRegion.source_matches, { includeStyleLabels: true })} imported=${probeSummary(topRegion.imported_matches, { includeStyleLabels: true })}`
		: '';
	return {
		...packetBase(generatorRepo),
		diagnostic_id: `visual-parity-${site}`,
		kind: 'visual_parity_mismatch',
		source_path: visualDiffPath,
		path: visualDiffPath,
		severity: 'warning',
		category: 'visual_parity',
		reason_code: 'visual_parity_mismatch',
		suggested_repair_class: 'inspect_visual_parity_policy',
		preview: `source=${sourceSize} imported=${importedSize} mismatch=${mismatchPercent}${regionSummary}`,
		selector: topRegion ? `screenshot region ${topRegion.x},${topRegion.y} ${topRegion.width}x${topRegion.height}` : '',
		excerpt: topRegion ? topRegionExcerpt(topRegion) : '',
		source_html_preview: '',
		block_name: '',
		converter: 'visual-parity',
		stage: 'screenshot_diff',
		reason: `Imported WordPress screenshot differs from source static HTML screenshot: mismatch=${mismatchPercent}, threshold=${thresholdPercent}, mismatched_pixels=${diff.mismatchPixels || 0}, total_pixels=${diff.totalPixels || 0}, dimension_mismatch=${diff.dimensionMismatch ? 'yes' : 'no'}.${regionSummary} See visual-parity artifact files source.png, imported.png, diff.png, and visual-diff.json.`,
		diagnostic_refs: [],
		asset_map_refs: [],
		visual_regions: regions,
		visual_code_evidence: topRegion ? visualCodeEvidenceFromRegion(topRegion, visualPacketOptions()) : {},
	};
}

function topRegionExcerpt(region) {
	return truncate(visualRegionSummary(region, { includeStyleLabels: true, maxSummaryLength: 160 }), 260);
}

function normalizePacketVisualRegions(regions) {
	return normalizeVisualRegions(regions, visualPacketOptions());
}

function visualPacketOptions() {
	return {
		textLimit: 180,
		htmlLimit: 1000,
		childSummaryLimit: 500,
		styleLimit: 180,
		styleDiffLimit: 180,
		cssLimit: 700,
		dropEmptyStyleValues: true,
		includeStyleLabels: true,
	};
}

function diagnosticRefs(diagnostic, summary = {}) {
	const refs = [];
	if (Array.isArray(diagnostic?.diagnostic_refs)) {
		refs.push(...diagnostic.diagnostic_refs.map(text).filter(Boolean));
	}
	const diagnosticId = text(diagnostic?.diagnostic_id) || text(diagnostic?.id);
	if (diagnosticId) {
		refs.push(diagnosticId);
	}
	const qualityRefs = summary?.quality?.diagnostic_refs;
	if (qualityRefs && typeof qualityRefs === 'object') {
		for (const value of Object.values(qualityRefs)) {
			if (Array.isArray(value) && (!diagnosticId || value.includes(diagnosticId))) {
				refs.push(...value.map(text).filter(Boolean));
			}
		}
	}
	return [...new Set(refs)];
}

function assetMapRefs(diagnostic, summary = {}) {
	const refs = [];
	for (const field of ['asset_map_refs', 'asset_map_ref']) {
		const value = diagnostic?.[field];
		if (Array.isArray(value)) {
			refs.push(...value.map(text).filter(Boolean));
		} else if (value && typeof value === 'object') {
			refs.push(JSON.stringify(value));
		} else if (text(value)) {
			refs.push(text(value));
		}
	}
	for (const field of ['key', 'url', 'href', 'src']) {
		if (text(diagnostic?.[field])) {
			refs.push(`${field}:${text(diagnostic[field])}`);
		}
	}
	const assetMap = summary?.asset_map && typeof summary.asset_map === 'object' ? summary.asset_map : {};
	const unresolved = Array.isArray(assetMap.unresolved) ? assetMap.unresolved : [];
	const sourcePath = text(diagnostic?.source_path) || text(diagnostic?.path);
	for (const item of unresolved) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		if (!sourcePath || text(item.source_path) === sourcePath || text(item.source) === sourcePath) {
			for (const field of ['key', 'url']) {
				if (text(item[field])) {
					refs.push(`${field}:${text(item[field])}`);
				}
			}
		}
	}
	return [...new Set(refs)];
}

function truncate(value, length) {
	const s = text(value);
	return s.length <= length ? s : s.slice(0, length);
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function numeric(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
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
		validation_run_id: numberOrString(validationRunId),
		source_repo: sourceRepo,
		source_pr: numberOrString(sourcePr),
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
