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
		const key = JSON.stringify([
			candidateRepo,
			packet.kind,
			packet.converter,
			packet.block_name,
			packet.category,
			packet.reason_code,
			groupSignature(packet),
		]);

		if (!groupMap.has(key)) {
			groupMap.set(key, {
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
				visual_code_evidence: visualCodeEvidence(packet),
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
		visual_regions: visualRegions(packet.visual_regions),
		visual_code_evidence: visualCodeEvidence(packet),
		design_system: designText(packet.design_system),
		palette_kind: designText(packet.palette_kind),
		typography_kind: designText(packet.typography_kind),
		layout_kind: designText(packet.layout_kind),
		density: designText(packet.density),
		commerce_pattern: designText(packet.commerce_pattern),
	};
}

function visualRegions(value) {
	return Array.isArray(value)
		? value.filter((region) => region && typeof region === 'object').slice(0, 8).map((region) => ({
			rank: numberOrString(region.rank),
			x: numberOrString(region.x),
			y: numberOrString(region.y),
			width: numberOrString(region.width),
			height: numberOrString(region.height),
			mismatchPixels: numberOrString(region.mismatchPixels),
			totalPixels: numberOrString(region.totalPixels),
			mismatchRatio: numberOrString(region.mismatchRatio),
			source_matches: visualProbes(region.source_matches),
			imported_matches: visualProbes(region.imported_matches),
			layout_deltas: visualLayoutDeltas(region.layout_deltas),
		}))
		: [];
}

function visualProbes(value) {
	return Array.isArray(value)
		? value.filter((probe) => probe && typeof probe === 'object').slice(0, 5).map((probe) => ({
			selector: text(probe.selector),
			path: text(probe.path),
			text: text(probe.text),
			html: text(probe.html),
			child_summary: text(probe.child_summary),
			computed_style: objectStrings(probe.computed_style),
			matched_css_rules: cssRules(probe.matched_css_rules),
			rect: probe.rect && typeof probe.rect === 'object' ? {
				x: numberOrString(probe.rect.x),
				y: numberOrString(probe.rect.y),
				width: numberOrString(probe.rect.width),
				height: numberOrString(probe.rect.height),
			} : {},
		}))
		: [];
}

function visualLayoutDeltas(value) {
	return Array.isArray(value)
		? value.filter((delta) => delta && typeof delta === 'object').slice(0, 3).map((delta) => ({
			pair: numberOrString(delta.pair),
			source_selector: text(delta.source_selector),
			imported_selector: text(delta.imported_selector),
			source_path: text(delta.source_path),
			imported_path: text(delta.imported_path),
			source_child_summary: text(delta.source_child_summary),
			imported_child_summary: text(delta.imported_child_summary),
			rect_delta: delta.rect_delta && typeof delta.rect_delta === 'object' ? {
				x: numberOrString(delta.rect_delta.x),
				y: numberOrString(delta.rect_delta.y),
				width: numberOrString(delta.rect_delta.width),
				height: numberOrString(delta.rect_delta.height),
			} : {},
			style_diffs: Array.isArray(delta.style_diffs)
				? delta.style_diffs.filter((diff) => diff && typeof diff === 'object').slice(0, 16).map((diff) => ({
					property: text(diff.property),
					source: text(diff.source),
					imported: text(diff.imported),
				}))
				: [],
		}))
		: [];
}

function cssRules(value) {
	return Array.isArray(value)
		? value.filter((rule) => rule && typeof rule === 'object').slice(0, 8).map((rule) => ({
			selector: text(rule.selector),
			media: text(rule.media),
			css: text(rule.css),
		}))
		: [];
}

function objectStrings(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, text(raw)]));
}

function visualSummary(packet) {
	if (text(packet.kind) !== 'visual_parity_mismatch') {
		return '';
	}
	const region = visualRegions(packet.visual_regions)[0];
	if (!region) {
		return text(packet.preview);
	}
	return [
		`region ${region.x},${region.y} ${region.width}x${region.height}`,
		`source ${probeSummary(region.source_matches)}`,
		`imported ${probeSummary(region.imported_matches)}`,
	].join('; ');
}

function probeSummary(probes) {
	const probe = Array.isArray(probes) ? probes[0] : null;
	if (!probe) {
		return 'none';
	}
	const style = probe.computed_style && typeof probe.computed_style === 'object' ? probe.computed_style : {};
	return [probe.selector, probe.text, style.display, style['font-size'], style['background-color']]
		.filter((value) => text(value) !== '')
		.join(' ');
}

function visualCodeEvidence(packet) {
	const configured = packet.visual_code_evidence;
	if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
		return {
			source: visualProbes(configured.source),
			imported: visualProbes(configured.imported),
		};
	}
	const region = visualRegions(packet.visual_regions)[0];
	return region ? {
		source: region.source_matches,
		imported: region.imported_matches,
	} : {};
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

function routeCandidateRepo(packet) {
	const kind = text(packet.kind).toLowerCase();
	if (kind === 'bench_failure') {
		return 'chubes4/wp-site-generator';
	}
	if (kind === 'visual_parity_outcome' || kind === 'visual_parity_mismatch') {
		return 'chubes4/wp-site-generator';
	}
	if (kind === 'report_missing' || kind === 'import_clean') {
		return 'chubes4/static-site-importer';
	}

	const converter = text(packet.converter).toLowerCase();
	const repairClass = text(packet.suggested_repair_class).toLowerCase();
	const category = text(packet.category).toLowerCase();
	const reasonCode = text(packet.reason_code).toLowerCase();
	const stage = text(packet.stage).toLowerCase();
	const haystack = [packet.kind, converter, packet.block_name, stage, packet.reason, packet.path, category, reasonCode, repairClass].join(' ').toLowerCase();

	if ((converter.includes('html-to-block') || converter.includes('h2bc')) && (repairClass.includes('converter_support') || repairClass.includes('replace_fallback') || category.includes('fallback') || kind.includes('fallback') || kind.includes('core_html') || kind.includes('freeform'))) {
		return 'chubes4/html-to-blocks-converter';
	}
	if (haystack.includes('block-format-bridge') || haystack.includes('bfb') || haystack.includes('serialization') || category.includes('adapter') || category.includes('scope') || category.includes('bfb_report')) {
		return 'chubes4/block-format-bridge';
	}
	if (category.includes('source_region') || category.includes('source-selection') || category.includes('unresolved_asset') || category.includes('asset_map') || category.includes('import_report') || stage.includes('source_selection') || stage.includes('asset_map') || haystack.includes('source-selection') || haystack.includes('asset_map')) {
		return 'chubes4/static-site-importer';
	}
	if (haystack.includes('generator') || haystack.includes('static-site-generator') || haystack.includes('visual parity') || haystack.includes('homeboy-bench') || category.includes('generator_policy')) {
		return 'chubes4/wp-site-generator';
	}

	const explicit = text(packet.candidate_repo);
	if (isCandidateRepo(explicit)) {
		return explicit;
	}

	return 'chubes4/static-site-importer';
}

function routeRepairMode(packet, candidateRepo) {
	const configured = text(packet.repair_mode);
	if (configured) {
		return configured;
	}
	const hasPatchEvidence = Boolean(text(packet.source_html_preview) || text(packet.selector) || text(packet.source_path));
	if (!hasPatchEvidence || candidateRepo === 'chubes4/wp-site-generator') {
		return 'issue_only';
	}
	return 'pr_or_issue';
}

function routeReason(packet, candidateRepo, repairMode) {
	if (repairMode === 'issue_only') {
		return 'insufficient evidence for a safe automated PR path; group remains issue-only';
	}
	if (candidateRepo === 'chubes4/html-to-blocks-converter') {
		return 'converter diagnostic routes to html-to-blocks-converter';
	}
	if (candidateRepo === 'chubes4/block-format-bridge') {
		return 'BFB adapter/report/scope diagnostic routes to block-format-bridge';
	}
	if (candidateRepo === 'chubes4/static-site-importer') {
		return 'SSI import/source-selection/asset-map diagnostic routes to static-site-importer';
	}
	return 'visual parity or generator policy diagnostic routes to wp-site-generator';
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
