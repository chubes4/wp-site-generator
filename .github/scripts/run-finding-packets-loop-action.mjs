#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));

const packetSet = findArtifact(input.controller, 'finding_packet_set') || {
	schema: 'wp-site-generator/FindingPacketSet/v1',
	packets: [],
	actionable_conversion_count: 0,
};
const packets = Array.isArray(packetSet.packets) ? packetSet.packets : [];
const findingGroup = {
	schema: 'wp-site-generator/FindingGroup/v1',
	status: packets.length > 0 ? 'ready' : 'empty',
	groups: packets.length > 0 ? [{ group_id: 'default', packets }] : [],
	packet_count: packets.length,
	note: packets.length > 0 ? 'Grouped deterministic finding packets.' : 'No findings were produced by static validation.',
};

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/finding-packets-loop-action-result/v1',
	success: true,
	artifacts: {
		finding_packet_set: packetSet,
		finding_group: findingGroup,
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
