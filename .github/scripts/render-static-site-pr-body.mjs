#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizePublishGateRows as normalizeSsiPublishGateRows, normalizeValidationMetricRows } from './lib/ssi-metrics.mjs';

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
	return normalizeSsiPublishGateRows(publishGate);
}

export function normalizeValidationMetrics(validation = {}) {
	return normalizeValidationMetricRows(validation);
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
