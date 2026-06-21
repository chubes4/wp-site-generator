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

export const ssiBlocksEngineMetrics = [
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

export function normalizeValidationMetricRows(validation = {}) {
	return [
		['Status', validation.passed === false || validation.status === 'failed' ? 'failed' : validation.status || 'passed'],
		...ssiPrBodyMetrics.map(([label, key]) => [label, validationMetricValue(validation, key)]),
	];
}

export function normalizePublishGateRows(publishGate = {}) {
	const gates = publishGate.gates && typeof publishGate.gates === 'object' ? publishGate.gates : {};
	return [
		['fallback_blocks', 'Fallback blocks'],
		['conversion_findings', 'Conversion findings'],
		['visual_parity', 'Visual parity'],
	].filter(([key]) => gates[key] && typeof gates[key] === 'object').map(([key, label]) => ({
		label,
		passed: gates[key].passed === true,
		value: key === 'visual_parity'
			? `status=${gates[key].status ?? ''}; mismatches=${gates[key].mismatch_count ?? 0}; max_delta=${gates[key].max_delta_ratio ?? 0}`
			: gates[key].value,
		target: gates[key].target || '',
	}));
}

export function evaluateValidationGateContracts({ validation = {}, visualParity = {} } = {}) {
	const metrics = validation.metrics && typeof validation.metrics === 'object' ? validation.metrics : validation;
	const conversion = validation.conversion_findings && typeof validation.conversion_findings === 'object'
		? validation.conversion_findings
		: metrics.conversion_findings && typeof metrics.conversion_findings === 'object'
			? metrics.conversion_findings
			: {};
	const visualSummary = visualParity.summary && typeof visualParity.summary === 'object'
		? visualParity.summary
		: validation.visual_parity && typeof validation.visual_parity === 'object'
			? validation.visual_parity
			: metrics.visual_parity && typeof metrics.visual_parity === 'object'
				? metrics.visual_parity
				: {};

	const fallbackCount = validationMetricValue(validation, 'ssi_fallback_count');
	const conversionFindingCount = numberValue(
		conversion.actionable ?? conversion.actionable_count ?? conversion.total ?? metrics.actionable_conversion_count ?? metrics.total_findings ?? metrics.diagnostic_count ?? metrics.ssi_signal_total_count
	);
	const visualStatus = text(visualSummary.status || metrics.visual_parity_status || validation.visual_parity_status).toLowerCase();
	const visualMismatchCount = numberValue(visualSummary.mismatch_count ?? metrics.visual_mismatch_count);
	const visualMaxDeltaRatio = numberValue(visualSummary.max_delta_ratio ?? metrics.visual_max_delta_ratio);
	const visualStatusPasses = ['pass', 'passed', 'ok'].includes(visualStatus);

	const gates = {
		fallback_blocks: {
			passed: fallbackCount === 0,
			value: fallbackCount,
			target: 'value === 0',
		},
		conversion_findings: {
			passed: conversionFindingCount === 0,
			value: conversionFindingCount,
			target: 'value === 0',
		},
		visual_parity: {
			passed: visualStatusPasses && visualMismatchCount === 0 && visualMaxDeltaRatio === 0,
			status: visualStatus || 'missing',
			mismatch_count: visualMismatchCount,
			max_delta_ratio: visualMaxDeltaRatio,
			target: 'status passes and mismatch_count === 0 and max_delta_ratio === 0',
		},
	};

	return gates;
}

export function evaluateStaticSitePublishGateContract({ validation = {}, visualParity = {} } = {}) {
	const gates = evaluateValidationGateContracts({ validation, visualParity });
	const failedGates = Object.entries(gates)
		.filter(([, gate]) => !gate.passed)
		.map(([gateId]) => gateId);

	return {
		schema: 'wp-site-generator/StaticSitePublishGate/v1',
		publish_allowed: failedGates.length === 0,
		gates,
		failed_gates: failedGates,
	};
}

export function validationReportMetricValue(metrics = {}, key) {
	return numericValue(metrics[`${key}_max`] ?? metrics[key]);
}

function numericValue(value) {
	if (value === undefined || value === null || value === '') {
		return null;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function numberValue(value) {
	const valueNumber = numericValue(value);
	return valueNumber === null ? 0 : valueNumber;
}

function text(value) {
	return String(value ?? '').trim();
}
