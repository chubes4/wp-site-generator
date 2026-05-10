#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inputPaths = (process.env.FINDING_PACKET_PATHS || process.argv.slice(2).join(','))
	.split(',')
	.map((item) => item.trim())
	.filter(Boolean);
const outputPath = process.env.FINDING_GROUPS_PATH || 'php-transformer-iterator-input.json';

if (inputPaths.length === 0) {
	throw new Error('Provide finding packet JSON paths as args or FINDING_PACKET_PATHS.');
}

const packets = [];
for (const inputPath of inputPaths) {
	const data = JSON.parse(await readFile(inputPath, 'utf8'));
	packets.push(...(Array.isArray(data) ? data : data.packets || data.findings || []));
}

const grouped = groupPackets(packets);
await writeFile(outputPath, `${JSON.stringify(grouped, null, 2)}\n`);

function groupPackets(rawPackets) {
	const normalized = rawPackets.map(normalizePacket).filter((packet) => packet.kind || packet.reason || packet.preview);
	const actionable = normalized.filter(isActionablePacket);
	const deduped = dedupe(actionable);
	const groupMap = new Map();

	for (const packet of deduped) {
		const candidateRepo = routeCandidateRepo(packet);
		const key = JSON.stringify([
			candidateRepo,
			packet.kind,
			packet.converter,
			packet.block_name,
			normalizeReason(packet.reason),
		]);

		if (!groupMap.has(key)) {
			groupMap.set(key, {
				candidate_repo: candidateRepo,
				kind: packet.kind,
				converter: packet.converter,
				block_name: packet.block_name,
				reason: packet.reason,
				count: 0,
				packets: [],
			});
		}

		const group = groupMap.get(key);
		group.count += 1;
		group.packets.push(packet);
	}

	return {
		schema_version: 2,
		packet_count: normalized.length,
		actionable_packet_count: actionable.length,
		deduped_packet_count: deduped.length,
		group_count: groupMap.size,
		candidate_repos: [...new Set([...groupMap.values()].map((group) => group.candidate_repo))],
		groups: [...groupMap.values()].sort((a, b) => b.count - a.count || a.candidate_repo.localeCompare(b.candidate_repo)),
	};
}

function isActionablePacket(packet) {
	if (text(packet.actionable).toLowerCase() === 'false') {
		return false;
	}

	return !['import_clean', 'ignored_region'].includes(text(packet.kind).toLowerCase());
}

function normalizePacket(packet) {
	return {
		schema_version: numberOrString(packet.schema_version),
		site: text(packet.site),
		source_repo: text(packet.source_repo),
		source_pr: numberOrString(packet.source_pr),
		source_head_sha: text(packet.source_head_sha),
		source_branch: text(packet.source_branch),
		validation_run_id: numberOrString(packet.validation_run_id),
		candidate_repo: text(packet.candidate_repo),
		kind: text(packet.kind).toLowerCase(),
		path: text(packet.path),
		preview: text(packet.preview),
		selector: text(packet.selector),
		excerpt: text(packet.excerpt),
		source_html_preview: text(packet.source_html_preview),
		block_name: text(packet.block_name),
		converter: text(packet.converter),
		stage: text(packet.stage),
		reason: text(packet.reason),
		actionable: packet.actionable,
		artifact_names: packet.artifact_names && typeof packet.artifact_names === 'object' ? packet.artifact_names : {},
		bench_outcome: text(packet.bench_outcome),
		visual_outcome: text(packet.visual_outcome),
		design_system: designText(packet.design_system),
		palette_kind: designText(packet.palette_kind),
		typography_kind: designText(packet.typography_kind),
		layout_kind: designText(packet.layout_kind),
		density: designText(packet.density),
		commerce_pattern: designText(packet.commerce_pattern),
	};
}

function designText(value) {
	const stringValue = text(value);
	return stringValue === '' ? 'unknown' : stringValue;
}

function dedupe(packets) {
	const seen = new Set();
	const deduped = [];

	for (const packet of packets) {
		const key = JSON.stringify([
			packet.site,
			packet.source_repo,
			packet.source_pr,
			packet.kind,
			packet.path,
			packet.selector,
			packet.source_html_preview,
			packet.block_name,
			packet.converter,
			packet.stage,
			packet.reason,
		]);

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(packet);
	}

	return deduped;
}

function routeCandidateRepo(packet) {
	const explicit = text(packet.candidate_repo);
	if (isCandidateRepo(explicit)) {
		return explicit;
	}

	const kind = text(packet.kind).toLowerCase();
	if (kind === 'bench_failure') {
		return 'chubes4/wp-site-generator';
	}
	if (kind === 'visual_parity_outcome' || kind === 'visual_parity_mismatch') {
		return 'chubes4/static-site-importer';
	}
	if (kind === 'report_missing' || kind === 'import_clean') {
		return 'chubes4/static-site-importer';
	}

	const haystack = [packet.kind, packet.converter, packet.block_name, packet.stage, packet.reason, packet.path].join(' ').toLowerCase();

	if (haystack.includes('html-to-block') || haystack.includes('h2bc')) {
		return 'chubes4/html-to-blocks-converter';
	}
	if (haystack.includes('block-format-bridge') || haystack.includes('bfb') || haystack.includes('serialization')) {
		return 'chubes4/block-format-bridge';
	}
	if (haystack.includes('generator') || haystack.includes('static-site-generator') || haystack.includes('visual parity') || haystack.includes('homeboy-bench')) {
		return 'chubes4/wp-site-generator';
	}

	return 'chubes4/static-site-importer';
}

function isCandidateRepo(value) {
	return [
		'chubes4/static-site-importer',
		'chubes4/html-to-blocks-converter',
		'chubes4/block-format-bridge',
		'chubes4/wp-site-generator',
	].includes(value);
}

function normalizeReason(reason) {
	return text(reason).toLowerCase().replace(/\s+/g, ' ').trim();
}

function text(value) {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

function numberOrString(value) {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
}
