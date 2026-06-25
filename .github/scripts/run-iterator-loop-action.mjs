#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const findingGroup = findArtifact(input.controller, 'finding_group') || { groups: [], packet_count: 0 };
const packetCount = Number(findingGroup.packet_count || 0);

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/iterator-loop-action-result/v1',
	success: true,
	artifacts: {
		iterator_upstream_issue: {
			schema: 'github/Issue/v1',
			status: packetCount > 0 ? 'ready_for_routing' : 'skipped_no_findings',
			mode: 'deterministic_loop_dry_run',
			number: null,
			url: null,
			title: packetCount > 0 ? 'Route SSI finding group' : 'No SSI findings to route',
			body: packetCount > 0 ? JSON.stringify(findingGroup, null, 2) : 'Static validation produced no finding packets; no upstream issue is needed.',
			finding_packet_count: packetCount,
		},
		iterator_upstream_pull_request: {
			schema: 'github/PullRequest/v1',
			status: packetCount > 0 ? 'not_created_issue_routing_only' : 'skipped_no_findings',
			mode: 'deterministic_loop_dry_run',
			number: null,
			url: null,
			title: null,
			body: null,
			finding_packet_count: packetCount,
		},
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
