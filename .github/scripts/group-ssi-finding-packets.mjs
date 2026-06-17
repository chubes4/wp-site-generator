#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { routeCandidateRepo, routeReason, routeRepairMode } from './lib/finding-routing.mjs';
import {
	normalizeVisualRegions,
	probeSummary,
	visualCodeEvidenceFromPacket,
} from './lib/visual-artifacts.mjs';

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
	packets.push(...(Array.isArray(data) ? data : data.packets || []));
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
		const repairMode = routeRepairMode(packet, candidateRepo);
		const rootCause = rootCauseForPacket(packet);
		const groupId = groupIdForPacket(candidateRepo, rootCause, packet);
		const key = JSON.stringify([
			candidateRepo,
			rootCause,
			groupId,
			packet.converter,
			packet.block_name,
			packet.category,
			packet.reason_code,
		]);

		if (!groupMap.has(key)) {
			groupMap.set(key, {
				owner_repo: candidateRepo,
				root_cause: rootCause,
				group_id: groupId,
				candidate_repo: candidateRepo,
				kind: packet.kind,
				converter: packet.converter,
				block_name: packet.block_name,
				category: packet.category,
				reason_code: packet.reason_code,
				suggested_repair_class: packet.suggested_repair_class,
				repair_mode: repairMode,
				route_reason: routeReason(packet, candidateRepo, repairMode),
				visual_summary: visualSummary(packet),
				visual_code_evidence: visualCodeEvidenceFromPacket(packet, groupVisualOptions()),
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
		schema_version: 3,
		packet_count: normalized.length,
		actionable_packet_count: actionable.length,
		deduped_packet_count: deduped.length,
		group_count: groupMap.size,
		candidate_repos: [...new Set([...groupMap.values()].map((group) => group.candidate_repo))],
		groups: [...groupMap.values()].sort((a, b) => b.count - a.count || a.candidate_repo.localeCompare(b.candidate_repo)),
	};
}

function isActionablePacket(packet) {
	const actionable = text(packet.actionable).toLowerCase();
	if (actionable === 'false') {
		return false;
	}
	if (actionable !== 'true' && ['debug', 'info', 'notice'].includes(text(packet.severity).toLowerCase())) {
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
		diagnostic_id: text(packet.diagnostic_id) || text(packet.id),
		kind: text(packet.kind).toLowerCase(),
		source_path: text(packet.source_path) || text(packet.path),
		path: text(packet.source_path) || text(packet.path),
		severity: text(packet.severity),
		category: text(packet.category).toLowerCase(),
		reason_code: text(packet.reason_code).toLowerCase(),
		suggested_repair_class: text(packet.suggested_repair_class),
		preview: text(packet.preview),
		selector: text(packet.selector),
		excerpt: text(packet.excerpt),
		source_html_preview: text(packet.source_html_preview),
		emitted_block_preview: text(packet.emitted_block_preview),
		block_name: text(packet.block_name),
		block_path: text(packet.block_path),
		converter: text(packet.converter),
		stage: text(packet.stage),
		reason: text(packet.reason),
		repair_mode: text(packet.repair_mode),
		malformed: Boolean(packet.malformed),
		actionable: packet.actionable,
		diagnostic_refs: Array.isArray(packet.diagnostic_refs) ? packet.diagnostic_refs.map(text).filter(Boolean) : [],
		asset_map_refs: Array.isArray(packet.asset_map_refs) ? packet.asset_map_refs.map(text).filter(Boolean) : [],
		artifact_names: packet.artifact_names && typeof packet.artifact_names === 'object' ? packet.artifact_names : {},
		bench_outcome: text(packet.bench_outcome),
		visual_outcome: text(packet.visual_outcome),
		visual_regions: normalizeGroupVisualRegions(packet.visual_regions),
		visual_code_evidence: visualCodeEvidenceFromPacket(packet, groupVisualOptions()),
		design_system: designText(packet.design_system),
		palette_kind: designText(packet.palette_kind),
		typography_kind: designText(packet.typography_kind),
		layout_kind: designText(packet.layout_kind),
		density: designText(packet.density),
		commerce_pattern: designText(packet.commerce_pattern),
	};
}

function visualSummary(packet) {
	if (text(packet.kind) !== 'visual_parity_mismatch') {
		return '';
	}
	const region = normalizeGroupVisualRegions(packet.visual_regions)[0];
	if (!region) {
		return text(packet.preview);
	}
	return [
		`region ${region.x},${region.y} ${region.width}x${region.height}`,
		`source ${probeSummary(region.source_matches)}`,
		`imported ${probeSummary(region.imported_matches)}`,
	].join('; ');
}

function normalizeGroupVisualRegions(value) {
	return normalizeVisualRegions(value, groupVisualOptions());
}

function groupVisualOptions() {
	return { numberMode: 'numberOrString' };
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
			packet.diagnostic_id,
			packet.category,
			packet.reason_code,
			packet.path,
			packet.selector,
			packet.source_html_preview,
			packet.emitted_block_preview,
			packet.block_name,
			packet.block_path,
			packet.converter,
			packet.stage,
			packet.reason,
			packet.repair_mode,
		]);

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(packet);
	}

	return deduped;
}

function groupSignature(packet) {
	const html = text(packet.source_html_preview).toLowerCase();
	if (/<figure\b/.test(html) && /<figcaption\b/.test(html) && !/<img\b|<picture\b|<video\b|<svg\b/.test(html)) {
		return 'figure-with-caption-only';
	}
	if (/<div\b/.test(html) && /marquee[-_]lights/.test(html)) {
		return 'div-marquee-lights';
	}

	const selector = text(packet.selector).toLowerCase().replace(/\.[-_a-z0-9]+/g, '.class');
	return selector || normalizeReason(packet.reason);
}

function rootCauseForPacket(packet) {
	return text(packet.reason_code) || text(packet.kind) || 'unknown';
}

function groupIdForPacket(candidateRepo, rootCause, packet) {
	return slugify([candidateRepo, text(packet.kind), rootCause, groupSignature(packet)].filter(Boolean).join('-')) || 'finding-group';
}

function slugify(value) {
	return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
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
