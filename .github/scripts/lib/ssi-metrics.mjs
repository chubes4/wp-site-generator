export const ssiSignalMetrics = [
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

export const ssiBacMetrics = [
	['ssi_bac_available', 'compiler available'],
	['ssi_bac_website_artifact_present', 'website artifact present'],
	['ssi_bac_fragment_count', 'compiled fragments'],
	['ssi_bac_component_count', 'components'],
	['ssi_bac_rejected_count', 'rejected inputs'],
	['ssi_bac_diagnostic_count', 'compiler diagnostics'],
];

export const ssiImportMetricAliases = {
	ssi_signal_total_count: ['diagnostic_count', 'total_findings', 'total'],
	ssi_core_html_count: ['core_html_block_count', 'core_html_blocks'],
	ssi_fallback_count: ['fallback_count', 'fallback_blocks', 'fallback_block_count'],
	ssi_freeform_block_count: ['freeform_block_count', 'freeform_blocks'],
	ssi_invalid_block_count: ['invalid_block_count', 'invalid_blocks'],
};

export const ssiPrBodyMetrics = [
	['Fallback blocks', 'ssi_fallback_count'],
	['Core HTML blocks', 'ssi_core_html_count'],
	['Freeform blocks', 'ssi_freeform_block_count'],
	['Invalid blocks', 'ssi_invalid_block_count'],
	['Total findings', 'ssi_signal_total_count'],
];

export const ssiAggregateQualityMetrics = [
	{
		metric: 'fallback_count',
		type: 'unsupported_html_fallback',
		block_name: '',
		reason_code: 'unsupported_html_fallback',
		message: 'Import readiness reported unsupported HTML fallback blocks.',
	},
	{
		metric: 'core_html_block_count',
		type: 'core_html_block',
		block_name: 'core/html',
		reason_code: 'generated_document_contains_core_html',
		message: 'Import readiness reported generated core/html blocks.',
	},
	{
		metric: 'freeform_block_count',
		type: 'freeform_block',
		block_name: 'core/freeform',
		reason_code: 'generated_document_contains_core_freeform',
		message: 'Import readiness reported generated core/freeform blocks.',
	},
	{
		metric: 'invalid_block_count',
		type: 'invalid_block',
		block_name: '',
		reason_code: 'generated_document_contains_invalid_block',
		message: 'Import readiness reported invalid generated blocks.',
	},
];

export function ssiMetricValueFromImportSummary(metricKey, source = {}) {
	const direct = numericValue(source?.[metricKey]);
	if (direct !== null) {
		return direct;
	}
	for (const alias of ssiImportMetricAliases[metricKey] || []) {
		const value = numericValue(source?.[alias]);
		if (value !== null) {
			return value;
		}
	}
	return 0;
}

export function validationMetricValue(validation = {}, metricKey) {
	const metrics = validation.metrics && typeof validation.metrics === 'object' ? validation.metrics : validation;
	const conversion = validation.conversion_findings && typeof validation.conversion_findings === 'object'
		? validation.conversion_findings
		: metrics.conversion_findings && typeof metrics.conversion_findings === 'object'
			? metrics.conversion_findings
			: {};
	const sources = [metrics, conversion];
	for (const source of sources) {
		const value = ssiMetricValueFromImportSummary(metricKey, source);
		if (value !== 0) {
			return value;
		}
	}
	return 0;
}

function numericValue(value) {
	if (value === undefined || value === null || value === '') {
		return null;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
