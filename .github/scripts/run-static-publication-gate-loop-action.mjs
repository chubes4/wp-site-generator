#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { evaluateStaticSitePublishGateContract } from './lib/ssi-metrics.mjs';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));

const validation = findArtifact(input.controller, 'import_validation_result');
if (!validation) {
	throw new Error('static-publication-gate requires an import_validation_result artifact from an earlier loop action.');
}
const visualParity = findArtifact(input.controller, 'visual_parity_artifact');
if (!visualParity) {
	throw new Error('static-publication-gate requires a visual_parity_artifact artifact from an earlier loop action.');
}

const publishGate = evaluateStaticSitePublishGateContract({ validation, visualParity });

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/static-publication-gate-loop-action-result/v1',
	success: true,
	artifacts: {
		static_site_publish_gate: publishGate,
	},
}, null, 2)}\n`);

function findArtifact(controller, artifactId) {
	for (const lineage of [...(controller?.task_lineage || [])].reverse()) {
		const value = artifactFromOutputs(lineage?.outputs, artifactId);
		if (value) {
			return value.payload || value;
		}
	}
	for (const event of [...(controller?.history || [])].reverse()) {
		const outcomes = event?.payload?.execution?.result?.aggregate?.outcomes || [];
		for (const outcome of [...outcomes].reverse()) {
			const value = artifactFromOutputs(outcome?.outputs, artifactId) || artifactFromOutputs(outcome?.metadata, artifactId);
			if (value) {
				return value.payload || value;
			}
		}
		const direct = artifactFromOutputs(event?.payload?.execution?.result?.result, artifactId) || artifactFromOutputs(event?.payload?.execution?.result, artifactId);
		if (direct) {
			return direct.payload || direct;
		}
	}
	return null;
}

function artifactFromOutputs(outputs, artifactId) {
	const artifacts = outputs?.artifacts || outputs?.typed_artifacts || outputs?.typedArtifacts || {};
	return artifacts[artifactId];
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}
