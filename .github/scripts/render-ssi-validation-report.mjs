#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const site = process.env.SITE || '';
const benchPath = process.env.BENCH_PATH || 'homeboy-ci-results/bench.json';

const signalMetrics = [
	['ssi_signal_total_count', 'total classified signals'],
	['ssi_core_html_count', 'core/html blocks'],
	['ssi_fallback_count', 'fallback blocks'],
	['ssi_freeform_block_count', 'freeform blocks'],
	['ssi_invalid_block_count', 'invalid blocks'],
	['ssi_manifest_error_count', 'manifest errors'],
	['ssi_product_candidate_rejected_count', 'rejected product candidates'],
	['ssi_unassigned_region_count', 'unassigned regions'],
	['ssi_ignored_region_count', 'ignored regions'],
];

const consumedMetricPatterns = [
	/^(max|mean|min|p50|p95|p99)_ms$/,
	/^ssi_report_readable_(max|mean|min|p50|p95|p99)$/,
	/^ssi_report_top_level_keys_(max|mean|min|p50|p95|p99)$/,
	...signalMetrics.map(([key]) => new RegExp(`^${escapeRegExp(key)}(_(max|mean|min|p50|p95|p99))?$`)),
];

const benchText = await readInput(benchPath).catch((error) => {
	console.log(`_Bench artifact could not be read: ${escapeText(error?.message || error)}_`);
	process.exit(0);
});
const bench = parseJson(benchText);
if (!bench) {
	console.log('_Bench artifact is not valid JSON._');
	process.exit(0);
}
const ssi = bench?.data?.results?.scenarios?.find((scenario) => scenario?.id === 'ssi-import');

if (!ssi) {
	console.log('_SSI workload did not run._');
	process.exit(0);
}

console.log(renderReport(ssi));

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

function renderReport(ssi) {
	const metrics = ssi?.metrics && typeof ssi.metrics === 'object' ? ssi.metrics : {};
	const sections = [];

	sections.push(renderSignalTable(metrics));

	const perf = renderPerfTable(metrics);
	if (perf) {
		sections.push(perf);
	}

	const unexpected = renderUnexpectedMetrics(metrics);
	if (unexpected) {
		sections.push(unexpected);
	}

	sections.push(renderImportReport(ssi?.metadata?.import_report_summary));

	return sections.filter(Boolean).join('\n\n');
}

function renderSignalTable(metrics) {
	if (Object.keys(metrics).length === 0) {
		return '_No SSI metrics emitted yet._';
	}

	const rows = signalMetrics.map(([key, label]) => `| ${label} | ${formatCount(metricValue(metrics, key))} |`);
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

	const fallbacks = Array.isArray(summary.fallback_diagnostics) ? summary.fallback_diagnostics : [];
	const findings = Array.isArray(summary.findings) ? summary.findings : [];

	if (fallbacks.length > 0) {
		lines.push('', '| Site | Selector | Excerpt | Source HTML | Block | Converter | Stage | Reason |');
		lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const diagnostic of fallbacks) {
			lines.push(`| \`${escapeCell(site)}\` | ${escapeCell(diagnostic?.selector)} | ${escapeCell(diagnostic?.excerpt)} | ${escapeCell(diagnostic?.source_html_preview)} | \`${escapeCell(diagnostic?.block_name)}\` | \`${escapeCell(diagnostic?.converter)}\` | \`${escapeCell(diagnostic?.stage)}\` | ${escapeCell(diagnostic?.reason)} |`);
		}
	} else if (findings.length === 0) {
		lines.push('', '_No classified validation signals found in the import report._');
	} else {
		lines.push('', '| Kind | Path | Preview |');
		lines.push('| --- | --- | --- |');
		for (const finding of findings) {
			lines.push(`| \`${escapeCell(finding?.kind)}\` | \`${escapeCell(finding?.path)}\` | ${escapeCell(finding?.preview)} |`);
		}
	}

	return lines.join('\n');
}

function metricValue(metrics, key) {
	return numericValue(metrics[`${key}_max`] ?? metrics[key]);
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
	return String(value ?? '');
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
