import { readFile } from 'node:fs/promises';

import { ssiMetricValueFromImportSummary } from './ssi-metrics.mjs';

export async function loadJsonOrNull(inputPath) {
	try {
		return JSON.parse(await readFile(inputPath, 'utf8'));
	} catch {
		return null;
	}
}

export async function loadRecoveredSsiImportSummary(inputPaths) {
	for (const inputPath of inputPaths.filter(Boolean)) {
		const data = await loadJsonOrNull(inputPath);
		const importReadiness = data?.importReadiness && typeof data.importReadiness === 'object' ? data.importReadiness : data;
		const importResult = importReadiness?.import_result && typeof importReadiness.import_result === 'object' ? importReadiness.import_result : null;
		const summary = importResult?.import_report_summary && typeof importResult.import_report_summary === 'object'
			? importResult.import_report_summary
			: null;
		if (summary) {
			return { import_readiness: importReadiness, import_result: importResult, import_report_summary: summary };
		}
	}

	return null;
}

export function metricsFromImportSummary(summary, quality = null) {
	const source = quality && typeof quality === 'object' ? { ...summary, ...quality } : summary;
	return {
		ssi_signal_total_count: ssiMetricValueFromImportSummary('ssi_signal_total_count', source),
		ssi_core_html_count: ssiMetricValueFromImportSummary('ssi_core_html_count', source),
		ssi_fallback_count: ssiMetricValueFromImportSummary('ssi_fallback_count', source),
		ssi_freeform_block_count: ssiMetricValueFromImportSummary('ssi_freeform_block_count', source),
		ssi_invalid_block_count: ssiMetricValueFromImportSummary('ssi_invalid_block_count', source),
	};
}

export function recoveredSsiScenarioFromImportSummary(recovered) {
	if (!recovered?.import_report_summary) {
		return null;
	}
	const summary = {
		path: recovered.import_result?.report_path || recovered.import_report_summary.path,
		readable: recovered.import_report_summary.readable ?? true,
		...recovered.import_report_summary,
	};
	return {
		id: 'ssi-import',
		metrics: metricsFromImportSummary(summary, recovered.import_result?.quality),
		metadata: { import_report_summary: summary },
	};
}
