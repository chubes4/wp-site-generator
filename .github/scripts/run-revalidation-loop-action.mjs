#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));

const staticValidationRun = requireArtifact(input.controller, 'static_validation_run');
const importValidationResult = requireArtifact(input.controller, 'import_validation_result');
const visualParityArtifact = requireArtifact(input.controller, 'visual_parity_artifact');
const findingPacketSet = requireArtifact(input.controller, 'finding_packet_set');

const revalidationAttempt = {
	schema: 'wp-site-generator/RevalidationAttempt/v1',
	status: 'passed',
	mode: 'deterministic_loop_pass_through',
	static_validation_status: staticValidationRun.status || '',
	import_validation_status: importValidationResult.status || '',
	visual_parity_status: visualParityArtifact.summary?.status || visualParityArtifact.status || '',
	finding_packet_count: Array.isArray(findingPacketSet.packets) ? findingPacketSet.packets.length : 0,
};

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/revalidation-loop-action-result/v1',
	success: true,
	artifacts: {
		revalidation_attempt: revalidationAttempt,
		static_validation_run: staticValidationRun,
		import_validation_result: importValidationResult,
		visual_parity_artifact: visualParityArtifact,
		finding_packet_set: findingPacketSet,
	},
}, null, 2)}\n`);

function requireArtifact(controller, artifactId) {
	const artifact = findArtifact(controller, artifactId);
	if (!artifact) {
		throw new Error(`revalidation requires a ${artifactId} artifact from an earlier loop action.`);
	}
	return artifact;
}

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
