#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));

const validation = requireArtifact(input.controller, 'import_validation_result');
const staticValidation = requireArtifact(input.controller, 'static_validation_run');
const visual = requireArtifact(input.controller, 'visual_parity_artifact');
const revalidation = requireArtifact(input.controller, 'revalidation_attempt');
const findings = requireArtifact(input.controller, 'finding_packet_set');
const failed = [];
if (!['settings_built', 'passed', 'pass'].includes(String(validation.status || '').toLowerCase())) failed.push('import_validation_result');
if (!['passed', 'pass'].includes(String(staticValidation.status || '').toLowerCase())) failed.push('static_validation_run');
if (!['passed', 'pass'].includes(String(visual.summary?.status || visual.status || '').toLowerCase())) failed.push('visual_parity_artifact');
if (!['passed', 'pass'].includes(String(revalidation.status || '').toLowerCase())) failed.push('revalidation_attempt');

const reviewerGateOutcome = {
	schema: 'wp-site-generator/SsiStackReviewerGate/v1',
	decision: failed.length === 0 ? 'PASS' : 'BLOCK',
	mode: 'deterministic_loop_gate',
	failed_artifacts: failed,
	finding_packet_count: Array.isArray(findings.packets) ? findings.packets.length : 0,
	summary: failed.length === 0 ? 'Deterministic validation artifacts satisfy reviewer gate.' : `Reviewer gate blocked by: ${failed.join(', ')}`,
};

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/reviewer-gate-loop-action-result/v1',
	success: true,
	artifacts: {
		reviewer_gate_outcome: reviewerGateOutcome,
	},
}, null, 2)}\n`);

function requireArtifact(controller, artifactId) {
	const artifact = findArtifact(controller, artifactId);
	if (!artifact) {
		throw new Error(`reviewer gate requires a ${artifactId} artifact from an earlier loop action.`);
	}
	return artifact;
}

function findArtifact(controller, artifactId) {
	for (const lineage of [...(controller?.task_lineage || [])].reverse()) {
		const value = artifactFromOutputs(lineage?.outputs, artifactId);
		if (value) return value.payload || value;
	}
	for (const event of [...(controller?.history || [])].reverse()) {
		const outcomes = event?.payload?.execution?.result?.aggregate?.outcomes || [];
		for (const outcome of [...outcomes].reverse()) {
			const value = artifactFromOutputs(outcome?.outputs, artifactId) || artifactFromOutputs(outcome?.metadata, artifactId);
			if (value) return value.payload || value;
		}
		const direct = artifactFromOutputs(event?.payload?.execution?.result?.result, artifactId) || artifactFromOutputs(event?.payload?.execution?.result, artifactId);
		if (direct) return direct.payload || direct;
	}
	return null;
}

function artifactFromOutputs(outputs, artifactId) {
	const artifacts = outputs?.artifacts || outputs?.typed_artifacts || outputs?.typedArtifacts || {};
	return artifacts[artifactId];
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
