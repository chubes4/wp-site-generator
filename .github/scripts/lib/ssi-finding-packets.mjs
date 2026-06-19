import {
	normalizeVisualRegions,
	probeSummary,
	visualCodeEvidenceFromPacket,
} from './visual-artifacts.mjs';

export const ssiFindingPacketSchemaVersion = 3;

export function normalizeFindingInput(input) {
	if (Array.isArray(input)) {
		return input;
	}
	if (Array.isArray(input?.groups)) {
		return input.groups;
	}
	if (Array.isArray(input?.packets)) {
		return input.packets;
	}

	throw new Error('Finding input must be an array, grouped finding object, or object with packets.');
}

export function normalizeFindingPacket(packet = {}) {
	return {
		schema_version: numberOrString(packet.schema_version),
		site: text(packet.site),
		source_repo: text(packet.source_repo),
		source_pr: numberOrString(packet.source_pr),
		source_head_sha: text(packet.source_head_sha),
		source_branch: text(packet.source_branch),
		validation_run_id: numberOrString(packet.validation_run_id),
		owner_repo: text(packet.owner_repo),
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
		route_reason: text(packet.route_reason),
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

export function isActionableFindingPacket(packet) {
	const actionable = text(packet.actionable).toLowerCase();
	if (actionable === 'false') {
		return false;
	}
	if (actionable !== 'true' && ['debug', 'info', 'notice'].includes(text(packet.severity).toLowerCase())) {
		return false;
	}

	return !['import_clean', 'ignored_region'].includes(text(packet.kind).toLowerCase());
}

export function dedupeFindingPackets(packets, options = {}) {
	const seen = new Set();
	const deduped = [];

	for (const packet of packets) {
		const key = JSON.stringify(dedupeKey(packet, options.scope));

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(packet);
	}

	return deduped;
}

function dedupeKey(packet, scope) {
	if (scope === 'packet_emission') {
		return [
			packet.kind,
			packet.path,
			packet.preview,
			packet.selector,
			packet.excerpt,
			packet.diagnostic_id,
			packet.source_path,
			packet.category,
			packet.reason_code,
			packet.source_html_preview,
			packet.emitted_block_preview,
			packet.block_name,
			packet.converter,
			packet.stage,
			packet.reason,
			packet.repair_mode,
		];
	}

	return [
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
	];
}

export function groupFindingPackets(rawPackets, routing) {
	const normalized = rawPackets.map(normalizeFindingPacket).filter((packet) => packet.kind || packet.reason || packet.preview);
	const actionable = normalized.filter(isActionableFindingPacket);
	const deduped = dedupeFindingPackets(actionable);
	const groupMap = new Map();

	for (const packet of deduped) {
		const routeContext = routeContextForPacket(packet, routing);
		const key = JSON.stringify([
			routeContext.candidateRepo,
			routeContext.rootCause,
			routeContext.groupId,
			packet.converter,
			packet.block_name,
			packet.category,
			packet.reason_code,
		]);

		if (!groupMap.has(key)) {
			groupMap.set(key, {
				owner_repo: routeContext.candidateRepo,
				root_cause: routeContext.rootCause,
				group_id: routeContext.groupId,
				candidate_repo: routeContext.candidateRepo,
				kind: packet.kind,
				converter: packet.converter,
				block_name: packet.block_name,
				category: packet.category,
				reason_code: packet.reason_code,
				suggested_repair_class: packet.suggested_repair_class,
				repair_mode: routeContext.repairMode,
				route_reason: routeContext.routeReason,
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
		schema_version: ssiFindingPacketSchemaVersion,
		packet_count: normalized.length,
		actionable_packet_count: actionable.length,
		deduped_packet_count: deduped.length,
		group_count: groupMap.size,
		candidate_repos: [...new Set([...groupMap.values()].map((group) => group.candidate_repo))],
		groups: [...groupMap.values()].sort((a, b) => b.count - a.count || a.candidate_repo.localeCompare(b.candidate_repo)),
	};
}

export function routeContextForPacket(packet, routing) {
	const candidateRepo = routing.routeCandidateRepo(packet);
	const repairMode = routing.routeRepairMode(packet, candidateRepo);
	const rootCause = rootCauseForPacket(packet);
	return {
		candidateRepo,
		repairMode,
		rootCause,
		groupId: groupIdForPacket(candidateRepo, rootCause, packet),
		routeReason: routing.routeReason(packet, candidateRepo, repairMode),
	};
}

export function kindFromDiagnostic(type, category, blockName) {
	const normalizedType = text(type).toLowerCase();
	const normalizedCategory = text(category).toLowerCase();
	const normalizedBlock = text(blockName).toLowerCase();
	if (normalizedType === 'unsupported_html_fallback') {
		return 'unsupported_html_fallback';
	}
	if (normalizedType === 'core_html_block' || normalizedBlock === 'core/html') {
		return 'core_html_block';
	}
	if (normalizedType === 'freeform_block' || normalizedBlock === 'core/freeform') {
		return 'freeform_block';
	}
	if (normalizedCategory === 'unresolved_asset' || normalizedType.includes('asset_map')) {
		return 'asset_map';
	}
	if (normalizedCategory === 'source_region') {
		return 'source_region';
	}
	return normalizedType || normalizedCategory || 'import_diagnostic';
}

export function categoryFromDiagnostic(type, diagnostic) {
	const normalizedType = text(type).toLowerCase();
	const blockName = text(diagnostic?.block_name).toLowerCase();
	if (['unsupported_html_fallback', 'core_html_block', 'freeform_block'].includes(normalizedType) || ['core/html', 'core/freeform'].includes(blockName)) {
		return 'fallback_block';
	}
	if (normalizedType.includes('asset')) {
		return 'unresolved_asset';
	}
	if (normalizedType.includes('source_region')) {
		return 'source_region';
	}
	if (normalizedType.includes('bridge') || normalizedType.includes('serialization')) {
		return 'bfb_report';
	}
	return 'import_quality';
}

export function repairClassFromDiagnostic(type) {
	const normalizedType = text(type).toLowerCase();
	if (normalizedType.includes('asset')) {
		return 'materialize_or_rewrite_asset';
	}
	if (['unsupported_html_fallback'].includes(normalizedType)) {
		return 'replace_unsupported_html';
	}
	if (['core_html_block', 'freeform_block'].includes(normalizedType)) {
		return 'replace_fallback_block';
	}
	if (normalizedType.includes('source_region')) {
		return 'assign_or_ignore_source_region';
	}
	return '';
}

export function converterFromDiagnostic(type, category) {
	const haystack = `${type} ${category}`.toLowerCase();
	if (haystack.includes('bridge') || haystack.includes('bfb')) {
		return 'block-format-bridge';
	}
	return 'static-site-importer';
}

export function stageFromDiagnostic(type, category) {
	const haystack = `${type} ${category}`.toLowerCase();
	if (haystack.includes('asset')) {
		return 'asset_map';
	}
	if (haystack.includes('source_region')) {
		return 'source_selection';
	}
	return 'import_report';
}

export function repairModeFromDiagnostic(diagnostic, category, suggestedRepairClass) {
	if (text(diagnostic?.repair_mode)) {
		return text(diagnostic.repair_mode);
	}
	if (text(diagnostic?.actionable).toLowerCase() === 'false') {
		return 'issue_only';
	}
	if (!text(diagnostic?.source_html_preview) && !text(suggestedRepairClass) && text(category) === 'import_quality') {
		return 'issue_only';
	}
	return 'pr_or_issue';
}

export function summarizeFindingForPrompt(item, index, options = {}) {
	const maxPromptTextLength = options.maxPromptTextLength || 600;
	const visualArtifactForPacket = options.visualArtifactForPacket || (() => null);
	const packet = Array.isArray(item?.packets) ? item.packets[0] || {} : item;
	const visualArtifact = visualArtifactForPacket(packet);
	const summary = {
		index: index + 1,
		title: compactText(Array.isArray(item?.packets)
			? `${text(item.kind) || text(packet.kind) || 'finding'}: ${text(item.reason) || text(packet.reason) || text(packet.preview)}`
			: `${text(packet.kind) || 'finding'}: ${text(packet.reason) || text(packet.preview) || text(packet.path)}`, maxPromptTextLength),
		candidate_repo: text(item.candidate_repo) || text(packet.candidate_repo),
		repair_mode: text(item.repair_mode) || text(packet.repair_mode),
		route_reason: compactText(item.route_reason, 300),
		source_repo: text(packet.source_repo) || 'chubes4/wp-site-generator',
		source_pr: text(packet.source_pr),
		source_head_sha: text(packet.source_head_sha),
		source_branch: text(packet.source_branch),
		validation_run_id: text(packet.validation_run_id),
		site: text(packet.site),
		artifact_names: packet.artifact_names && typeof packet.artifact_names === 'object' ? packet.artifact_names : {},
		diagnostic_id: text(packet.diagnostic_id),
		kind: text(packet.kind),
		category: text(packet.category),
		reason_code: text(packet.reason_code),
		suggested_repair_class: text(packet.suggested_repair_class),
		converter: text(packet.converter),
		stage: text(packet.stage),
		source_path: text(packet.source_path) || text(packet.path),
		selector: text(packet.selector),
		block_name: text(packet.block_name),
		block_path: text(packet.block_path),
		reason: compactText(packet.reason, maxPromptTextLength),
		preview: compactText(packet.preview, maxPromptTextLength),
		excerpt: compactText(packet.excerpt, maxPromptTextLength),
		source_html_preview: compactText(packet.source_html_preview, maxPromptTextLength),
		emitted_block_preview: compactText(packet.emitted_block_preview, maxPromptTextLength),
		diagnostic_refs: summarizeRefs(packet.diagnostic_refs, 6),
		asset_map_refs: summarizeRefs(packet.asset_map_refs, 6),
		group_count: Number(item?.count) || (Array.isArray(item?.packets) ? item.packets.length : 1),
	};

	if (visualArtifact) {
		summary.visual_artifact = {
			artifact_name: visualArtifact.artifact_name,
			directory: visualArtifact.directory,
			files: visualArtifact.files,
			source_screenshot_path: visualArtifact.source_screenshot_path,
			imported_screenshot_path: visualArtifact.imported_screenshot_path,
			diff_screenshot_path: visualArtifact.diff_screenshot_path,
			visual_diff_path: visualArtifact.visual_diff_path,
			summary_path: visualArtifact.summary_path,
			comparison_html_path: visualArtifact.comparison_html_path,
			visual_diff: visualArtifact.visual_diff,
		};
	}

	return summary;
}

export function groupSignature(packet) {
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

export function rootCauseForPacket(packet) {
	return text(packet.reason_code) || text(packet.kind) || 'unknown';
}

export function groupIdForPacket(candidateRepo, rootCause, packet) {
	return slugify([candidateRepo, text(packet.kind), rootCause, groupSignature(packet)].filter(Boolean).join('-')) || 'finding-group';
}

export function normalizeGroupVisualRegions(value) {
	return normalizeVisualRegions(value, groupVisualOptions());
}

export function groupVisualOptions() {
	return { numberMode: 'numberOrString' };
}

export function text(value) {
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

export function numberOrString(value) {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
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

function designText(value) {
	const stringValue = text(value);
	return stringValue === '' ? 'unknown' : stringValue;
}

function slugify(value) {
	return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function normalizeReason(reason) {
	return text(reason).toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactText(value, maxLength = 600) {
	const compacted = text(value).replace(/\s+/g, ' ').trim();
	return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function summarizeRefs(value, maxItems) {
	return Array.isArray(value) ? value.slice(0, maxItems).map((item) => compactText(item, 240)) : [];
}
