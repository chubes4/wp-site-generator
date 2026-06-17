#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { loadJsonOrNull, loadRecoveredSsiImportSummary, recoveredSsiScenarioFromImportSummary } from './lib/ssi-import-summary.mjs';
import { ssiBacMetrics, ssiSignalMetrics, validationReportMetricValue } from './lib/ssi-metrics.mjs';

import { manifestSummaryRows } from './lib/ssi-stack-manifest.mjs';

const site = process.env.SITE || '';
const benchPath = process.env.BENCH_PATH || 'homeboy-ci-results/bench.json';
const visualSummaryPath = process.env.VISUAL_SUMMARY_PATH || `visual-parity-artifacts/${site}/summary.json`;
const importReadyPath = process.env.IMPORT_READY_PATH || `visual-parity-artifacts/${site}/import-ready.json`;
const manifestPath = process.env.SSI_STACK_MANIFEST_PATH || 'homeboy-ci-results/ssi-stack-manifest.json';

const consumedMetricPatterns = [
	/^(max|mean|min|p50|p95|p99)_ms$/,
	/^ssi_report_readable_(max|mean|min|p50|p95|p99)$/,
	/^ssi_report_top_level_keys_(max|mean|min|p50|p95|p99)$/,
	...ssiSignalMetrics.map(([key]) => new RegExp(`^${escapeRegExp(key)}(_(max|mean|min|p50|p95|p99))?$`)),
	...ssiBacMetrics.map(([key]) => new RegExp(`^${escapeRegExp(key)}(_(max|mean|min|p50|p95|p99))?$`)),
];

const benchRead = await readInput(benchPath)
	.then((text) => ({ text, error: '' }))
	.catch((error) => ({ text: '', error: error?.message || String(error) }));
const bench = benchRead.text ? parseJson(benchRead.text) : null;
const stackManifest = await loadJsonOrNull(manifestPath);
const ssi = (bench?.data?.payload || bench?.data)?.results?.scenarios?.find((scenario) => scenario?.id === 'ssi-import') || await loadRecoveredSsiScenario();

if (!ssi) {
	if (benchRead.error) {
		console.log([renderStackManifest(stackManifest), `_Bench artifact could not be read: ${escapeText(benchRead.error)}_`].filter(Boolean).join('\n\n'));
		process.exit(0);
	}
	if (benchRead.text && !bench) {
		console.log([renderStackManifest(stackManifest), '_Bench artifact is not valid JSON._'].filter(Boolean).join('\n\n'));
		process.exit(0);
	}
	const benchFailure = detectBenchFailure(bench);
	if (benchFailure) {
		console.log([renderStackManifest(stackManifest), renderBenchFailure(benchFailure)].filter(Boolean).join('\n\n'));
		process.exit(0);
	}
	console.log([renderStackManifest(stackManifest), '_SSI workload did not run._'].filter(Boolean).join('\n\n'));
	process.exit(0);
}

console.log(renderReport(ssi, stackManifest));

async function readInput(path) {
	if (path === '-') {
		return await new Promise((resolve, reject) => {
			let data = '';
			process.stdin.setEncoding('utf8');
			process.stdin.on('data', (chunk) => {
				data += chunk;
			});
			process.stdin.on('end', () => resolve(data));
			process.stdin.on('error', reject);
		});
	}

	return readFile(path, 'utf8');
}

async function loadRecoveredSsiScenario() {
	return recoveredSsiScenarioFromImportSummary(await loadRecoveredSsiImportSummary([visualSummaryPath, importReadyPath]));
}

function renderReport(ssi, stackManifest) {
	const metrics = ssi?.metrics && typeof ssi.metrics === 'object' ? ssi.metrics : {};
	const sections = [];

	sections.push(renderStackManifest(stackManifest));
	sections.push(renderSignalTable(metrics));

	const perf = renderPerfTable(metrics);
	if (perf) {
		sections.push(perf);
	}

	const unexpected = renderUnexpectedMetrics(metrics);
	if (unexpected) {
		sections.push(unexpected);
	}

	const importReportSummary = ssi?.metadata?.import_report_summary;
	sections.push(renderBacStatus(metrics, importReportSummary?.block_artifact_compiler));
	sections.push(renderSourceDocuments(importReportSummary?.source_documents, importReportSummary?.diagnostics));
	sections.push(renderImportReport(importReportSummary));

	return sections.filter(Boolean).join('\n\n');
}

function renderStackManifest(manifest) {
	if (!manifest || typeof manifest !== 'object') {
		return '';
	}

	const rows = manifestSummaryRows(manifest)
		.map((entry) => `| ${escapeCell(entry.label)} | \`${escapeCell(entry.ref)}\` | \`${escapeCell(shortSha(entry.sha))}\` |`);
	if (rows.length === 0) {
		return '';
	}

	return ['### Validation Harness Refs', '| Component | Ref | SHA |', '| --- | --- | --- |', ...rows].join('\n');
}

function shortSha(value) {
	return value ? String(value).slice(0, 12) : 'unresolved';
}

function detectBenchFailure(bench) {
	if (!bench || typeof bench !== 'object' || bench.success === true) {
		return null;
	}
	const data = bench.data && typeof bench.data === 'object'
		? bench.data.payload && typeof bench.data.payload === 'object'
			? bench.data.payload
			: bench.data
		: {};
	const failure = data.failure && typeof data.failure === 'object' ? data.failure : {};

	return {
		status: data.status || '',
		exit_code: data.exit_code ?? '',
		stderr_tail: failure.stderr_tail || '',
	};
}

function renderBenchFailure(failure) {
	const details = [];
	if (failure.status) {
		details.push(`- **Status:** \`${escapeCell(failure.status)}\``);
	}
	if (failure.exit_code !== '') {
		details.push(`- **Exit code:** \`${escapeCell(failure.exit_code)}\``);
	}
	if (failure.stderr_tail) {
		details.push(`- **Stderr tail:** ${escapeCell(failure.stderr_tail)}`);
	}

	return ['### Homeboy Bench Failure', '_SSI workload did not produce a scenario because the bench runner failed before report diagnostics ran._', ...details].join('\n');
}

function renderSignalTable(metrics) {
	if (Object.keys(metrics).length === 0) {
		return '_No SSI metrics emitted yet._';
	}

	const rows = ssiSignalMetrics.map(([key, label]) => `| ${label} | ${formatCount(metricValue(metrics, key))} |`);
	return ['### SSI Signals', '| Signal | Count |', '| --- | ---: |', ...rows].join('\n');
}

function renderPerfTable(metrics) {
	const rows = [
		['mean_ms', 'mean'],
		['p95_ms', 'p95'],
		['max_ms', 'max'],
	]
		.map(([key, label]) => [label, numericValue(metrics[key])])
		.filter(([, value]) => value !== null)
		.map(([label, value]) => `| ${label} | ${formatMs(value)} |`);

	if (rows.length === 0) {
		return '';
	}

	return ['### Import Perf', '| Metric | Value |', '| --- | ---: |', ...rows].join('\n');
}

function renderUnexpectedMetrics(metrics) {
	const rows = Object.entries(metrics)
		.filter(([key, value]) => !consumedMetricPatterns.some((pattern) => pattern.test(key)) && numericValue(value) !== 0)
		.map(([key, value]) => `| \`${escapeCell(key)}\` | ${escapeCell(formatValue(value))} |`);

	if (rows.length === 0) {
		return '';
	}

	return ['### Other Metrics', '| Metric | Value |', '| --- | ---: |', ...rows].join('\n');
}

function renderBacStatus(metrics, compiler) {
	const summary = compiler && typeof compiler === 'object' ? compiler : {};
	const rows = ssiBacMetrics.map(([key, label]) => `| ${label} | ${formatCount(metricValue(metrics, key))} |`);

	const lines = ['### Block Artifact Compiler', '| Signal | Count |', '| --- | ---: |', ...rows];
	if (summary.status) {
		lines.push('', `- **Status:** \`${escapeCell(summary.status)}\``);
	}
	if (summary.import_mode) {
		lines.push('', `- **Import mode:** \`${escapeCell(summary.import_mode)}\``);
	}

	const websiteSummary = summary.website_artifact_summary && typeof summary.website_artifact_summary === 'object' ? summary.website_artifact_summary : {};
	if (Object.keys(websiteSummary).length > 0) {
		lines.push('', '| Website Artifact Summary | Value |');
		lines.push('| --- | --- |');
		for (const [key, value] of Object.entries(websiteSummary)) {
			lines.push(`| \`${escapeCell(key)}\` | ${escapeCell(formatValue(value))} |`);
		}
	}

	const sourceDocuments = summary.source_documents && typeof summary.source_documents === 'object' ? summary.source_documents : {};
	if (Object.keys(sourceDocuments).length > 0) {
		lines.push('', renderSourceDocumentTable('BAC Source Documents', sourceDocuments));
	}

	const candidateCounts = summary.candidate_counts && typeof summary.candidate_counts === 'object' ? summary.candidate_counts : {};
	const candidateRows = Object.entries(candidateCounts)
		.filter(([, value]) => numericValue(value) !== null)
		.map(([key, value]) => `| ${labelFromKey(key)} | ${formatCount(numericValue(value))} |`);
	if (candidateRows.length > 0) {
		lines.push('', '| BAC Candidate | Count |');
		lines.push('| --- | ---: |');
		lines.push(...candidateRows);
	}

	const websiteArtifact = summary.website_artifact && typeof summary.website_artifact === 'object' ? summary.website_artifact : {};
	const diagnostics = Array.isArray(websiteArtifact.diagnostics) ? websiteArtifact.diagnostics : [];
	if (diagnostics.length > 0) {
		lines.push('', '| Compiler Diagnostic | Severity | Message |');
		lines.push('| --- | --- | --- |');
		for (const diagnostic of diagnostics) {
			lines.push(`| \`${escapeCell(diagnostic?.code || diagnostic?.type || diagnostic?.id)}\` | \`${escapeCell(diagnostic?.severity || diagnostic?.level)}\` | ${escapeCell(diagnostic?.message)} |`);
		}
	}

	return lines.join('\n');
}

function renderSourceDocuments(sourceDocuments, diagnostics = []) {
	const summary = sourceDocuments && typeof sourceDocuments === 'object' ? sourceDocuments : {};
	const mdxDiagnostics = Array.isArray(diagnostics)
		? diagnostics.filter((diagnostic) => isMdxSourceDiagnostic(diagnostic))
		: [];

	if (Object.keys(summary).length === 0 && mdxDiagnostics.length === 0) {
		return '';
	}

	const lines = ['### Source Documents'];
	if (Object.keys(summary).length > 0) {
		lines.push(renderSourceDocumentTable('SSI Source Documents', summary));
	}

	if (mdxDiagnostics.length > 0) {
		lines.push('', '| Skipped/Unsupported MDX | Source Path | Message |');
		lines.push('| --- | --- | --- |');
		for (const diagnostic of mdxDiagnostics) {
			lines.push(`| \`${escapeCell(diagnostic?.type || diagnostic?.reason_code || diagnostic?.diagnostic_id)}\` | \`${escapeCell(diagnostic?.source_path || diagnostic?.source)}\` | ${escapeCell(diagnostic?.message || diagnostic?.excerpt)} |`);
		}
	}

	return lines.join('\n');
}

function renderSourceDocumentTable(title, sourceDocuments) {
	const counts = sourceDocuments.counts_by_kind || sourceDocuments.counts_by_format || sourceDocuments.files_by_kind || {};
	const lines = [`| ${title} | Count |`, '| --- | ---: |'];
	lines.push(`| total | ${formatCount(numericValue(sourceDocuments.total_count))} |`);
	for (const [kind, count] of Object.entries(counts)) {
		lines.push(`| ${escapeCell(kind)} | ${formatCount(numericValue(count))} |`);
	}
	for (const [key, label] of [
		['skipped_mdx_count', 'skipped MDX'],
		['unresolved_link_count', 'unresolved links'],
		['markdown_parse_error_count', 'Markdown parse errors'],
	]) {
		if (numericValue(sourceDocuments[key]) !== null) {
			lines.push(`| ${label} | ${formatCount(numericValue(sourceDocuments[key]))} |`);
		}
	}

	return lines.join('\n');
}

function isMdxSourceDiagnostic(diagnostic) {
	if (!diagnostic || typeof diagnostic !== 'object') {
		return false;
	}
	const haystack = [
		diagnostic.format,
		diagnostic.source_path,
		diagnostic.source,
		diagnostic.type,
		diagnostic.reason_code,
		diagnostic.message,
	]
		.map((value) => String(value || '').toLowerCase())
		.join(' ');

	return haystack.includes('mdx') && (haystack.includes('unsupported') || haystack.includes('skipped'));
}

function renderImportReport(summary) {
	if (!summary) {
		return '### SSI Import Report\n\n_No import report summary found._';
	}

	const lines = [
		'### SSI Import Report',
		`- **Report path:** \`${summary.path || 'unknown'}\``,
		`- **Readable:** \`${Boolean(summary.readable)}\``,
		`- **Top-level keys:** \`${Array.isArray(summary.top_level_keys) ? summary.top_level_keys.join(', ') : ''}\``,
	];

	const diagnostics = Array.isArray(summary.diagnostics) ? summary.diagnostics : [];

	if (diagnostics.length === 0) {
		lines.push('', '_No classified validation signals found in the import report._');
	} else {
		lines.push('', '| Diagnostic | Severity | Category | Format | Source Path | Block | Converter | Stage | Reason Code | Repair Class | Message | Source HTML |');
		lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const diagnostic of diagnostics) {
			lines.push(`| \`${escapeCell(diagnostic?.diagnostic_id)}\` | \`${escapeCell(diagnostic?.severity)}\` | \`${escapeCell(diagnostic?.category)}\` | \`${escapeCell(diagnostic?.format)}\` | \`${escapeCell(diagnostic?.source_path)}\` | \`${escapeCell(diagnostic?.block_name)}\` | \`${escapeCell(diagnostic?.converter)}\` | \`${escapeCell(diagnostic?.stage)}\` | \`${escapeCell(diagnostic?.reason_code)}\` | \`${escapeCell(diagnostic?.suggested_repair_class)}\` | ${escapeCell(diagnostic?.message || diagnostic?.excerpt)} | ${escapeCell(diagnostic?.source_html_preview)} |`);
		}
	}

	return lines.join('\n');
}

function metricValue(metrics, key) {
	return validationReportMetricValue(metrics, key);
}

function numericValue(value) {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	}
	return null;
}

function formatCount(value) {
	if (value === null) {
		return '`n/a`';
	}
	return String(Math.trunc(value));
}

function formatMs(value) {
	return `${Math.round(value)} ms`;
}

function formatValue(value) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
	}
	if (value && typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value ?? '');
}

function labelFromKey(key) {
	return String(key || '').replaceAll('_', ' ');
}

function escapeCell(value) {
	return String(value ?? '').replaceAll('\n', ' ').replaceAll('|', '\\|');
}

function escapeText(value) {
	return String(value ?? '').replaceAll('\n', ' ');
}

function parseJson(value) {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
