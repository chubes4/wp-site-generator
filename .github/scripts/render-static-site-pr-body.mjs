#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function renderStaticSitePrBody({ candidate = {}, validation = {}, publishGate = {}, closes = '' } = {}) {
	const title = text(candidate.title || candidate.site_title || candidate.name || 'Static site candidate');
	const siteId = text(candidate.site_id || candidate.slug || '');
	const summary = text(candidate.summary || candidate.description || 'Generated static site candidate ready for review.');
	const artifactRefs = normalizeArtifactRefs(validation.artifacts);
	const metrics = normalizeValidationMetrics(validation);
	const lines = [
		'## Summary',
		`- ${summary}`,
	];

	if (siteId) {
		lines.push(`- Site ID: \`${siteId}\``);
	}

	lines.push('', '## Import validation', '', '| Metric | Value |', '| --- | --- |');
	for (const [label, value] of metrics) {
		lines.push(`| ${escapeCell(label)} | ${escapeCell(formatValue(value))} |`);
	}

	const gates = normalizePublishGateRows(publishGate);
	if (gates.length > 0) {
		lines.push('', '## Publication gate', '', `- Publish allowed: ${publishGate.publish_allowed === true ? 'true' : 'false'}`, '', '| Gate | Result | Value | Target |', '| --- | --- | --- | --- |');
		for (const gate of gates) {
			lines.push(`| ${escapeCell(gate.label)} | ${gate.passed ? 'pass' : 'fail'} | ${escapeCell(formatValue(gate.value))} | ${escapeCell(gate.target)} |`);
		}
	}

	if (artifactRefs.length > 0) {
		lines.push('', '## Artifacts');
		for (const ref of artifactRefs) {
			lines.push(`- ${ref}`);
		}
	}

	if (closes) {
		lines.push('', closes);
	}

	return lines.join('\n');
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

export function normalizeValidationMetrics(validation = {}) {
	const metrics = validation.metrics && typeof validation.metrics === 'object' ? validation.metrics : validation;
	const conversion = validation.conversion_findings && typeof validation.conversion_findings === 'object'
		? validation.conversion_findings
		: metrics.conversion_findings && typeof metrics.conversion_findings === 'object'
			? metrics.conversion_findings
			: {};

	return [
		['Status', validation.passed === false || validation.status === 'failed' ? 'failed' : validation.status || 'passed'],
		['Fallback blocks', numberLike(metrics.fallback_blocks ?? metrics.fallback_block_count ?? metrics.ssi_fallback_count)],
		['Core HTML blocks', numberLike(conversion.core_html_blocks ?? metrics.core_html_block_count ?? metrics.ssi_core_html_count)],
		['Freeform blocks', numberLike(conversion.freeform_blocks ?? metrics.freeform_block_count ?? metrics.ssi_freeform_block_count)],
		['Invalid blocks', numberLike(conversion.invalid_blocks ?? metrics.invalid_block_count ?? metrics.ssi_invalid_block_count)],
		['Total findings', numberLike(conversion.total ?? metrics.total_findings ?? metrics.diagnostic_count ?? metrics.ssi_signal_total_count)],
	];
}

function normalizeArtifactRefs(refs) {
	if (!refs) {
		return [];
	}
	if (Array.isArray(refs)) {
		return refs.map((ref) => text(ref)).filter(Boolean);
	}
	if (typeof refs === 'object') {
		return Object.entries(refs)
			.map(([label, value]) => `${label}: ${text(value)}`)
			.filter((entry) => !entry.endsWith(': '));
	}
	return [text(refs)].filter(Boolean);
}

function numberLike(value) {
	if (value === undefined || value === null || value === '') {
		return 0;
	}
	return value;
}

function formatValue(value) {
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	return text(value);
}

function text(value) {
	return String(value ?? '').trim();
}

function escapeCell(value) {
	return text(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

async function cli() {
	const candidatePath = process.env.STATIC_SITE_CANDIDATE_PATH || process.argv[2];
	const validationPath = process.env.IMPORT_VALIDATION_RESULT_PATH || process.argv[3];
	const publishGatePath = process.env.STATIC_SITE_PUBLISH_GATE_PATH || process.argv[4];
	const closes = process.env.PR_CLOSES || '';
	const candidate = candidatePath ? JSON.parse(await readFile(candidatePath, 'utf8')) : {};
	const validation = validationPath ? JSON.parse(await readFile(validationPath, 'utf8')) : {};
	const publishGate = publishGatePath ? JSON.parse(await readFile(publishGatePath, 'utf8')) : {};
	console.log(renderStaticSitePrBody({ candidate, validation, publishGate, closes }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	cli().catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exit(1);
	});
}
