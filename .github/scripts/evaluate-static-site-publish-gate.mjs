#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { numberValue, readJsonOrNull, textValue } from './lib/ci-runtime-utils.mjs';

export function evaluateStaticSitePublishGate({ validation = {}, visualParity = {} } = {}) {
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

	const fallbackCount = numberValue(metrics.fallback_blocks ?? metrics.fallback_block_count ?? metrics.ssi_fallback_count);
	const conversionFindingCount = numberValue(
		conversion.actionable ?? conversion.actionable_count ?? conversion.total ?? metrics.actionable_conversion_count ?? metrics.total_findings ?? metrics.diagnostic_count ?? metrics.ssi_signal_total_count
	);
	const visualStatus = textValue(visualSummary.status || metrics.visual_parity_status || validation.visual_parity_status).toLowerCase();
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

async function cli() {
	const validationPath = process.env.IMPORT_VALIDATION_RESULT_PATH || process.argv[2];
	const visualParityPath = process.env.VISUAL_PARITY_ARTIFACT_PATH || process.argv[3];
	const outputPath = process.env.STATIC_SITE_PUBLISH_GATE_PATH || process.argv[4];
	const validation = await readJsonOrNull(validationPath) || {};
	const visualParity = await readJsonOrNull(visualParityPath) || {};
	const result = evaluateStaticSitePublishGate({ validation, visualParity });
	const json = `${JSON.stringify(result, null, 2)}\n`;

	if (outputPath) {
		await writeFile(outputPath, json);
		return;
	}

	process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	cli().catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exit(1);
	});
}
