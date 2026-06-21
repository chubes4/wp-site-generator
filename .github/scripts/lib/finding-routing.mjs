import { readFileSync } from 'node:fs';
import { text } from './ssi-finding-packets.mjs';

const policy = JSON.parse(readFileSync(new URL('./finding-routing-policy.json', import.meta.url), 'utf8'));
export function candidateRepoFromDiagnostic(diagnostic, type, category, suggestedRepairClass) {
	const ownerRepo = text(diagnostic?.owner_repo);
	if (isCandidateRepo(ownerRepo)) {
		return ownerRepo;
	}

	const explicit = text(diagnostic?.candidate_repo);
	if (isCandidateRepo(explicit)) {
		return explicit;
	}

	const converter = text(diagnostic?.converter).toLowerCase();
	const haystack = `${type} ${category} ${suggestedRepairClass}`.toLowerCase();
	if (
		converter === 'blocks-engine-php-transformer'
		|| ['unsupported_html_fallback', 'core_html_block', 'freeform_block'].includes(text(type).toLowerCase())
		|| haystack.includes('fallback_block')
		|| haystack.includes('replace_unsupported_html')
		|| haystack.includes('replace_fallback_block')
	) {
		return 'Automattic/blocks-engine';
	}
	if (haystack.includes('bridge') || haystack.includes('serialization')) {
		return 'Automattic/blocks-engine';
	}

	return '';
}

export function routeCandidateRepo(packet) {
	const ownerRepo = text(packet.owner_repo);
	if (isCandidateRepo(ownerRepo)) {
		return ownerRepo;
	}

	const explicit = text(packet.candidate_repo);
	if (isCandidateRepo(explicit)) {
		return explicit;
	}

	const fields = routingFields(packet, explicit);

	for (const rule of policy.rules) {
		if (matchesRule(rule, fields)) {
			return rule.repo;
		}
	}

	return policy.default_repo;
}

export function routeRepairMode(packet, candidateRepo) {
	const configured = text(packet.repair_mode);
	if (configured) {
		return configured;
	}
	const kind = text(packet.kind).toLowerCase();
	if (kind === 'bench_failure' || kind === 'report_missing') {
		return 'issue_only';
	}
	if (kind === 'visual_parity_mismatch' && !hasSourceSitePatchEvidence(packet)) {
		return 'issue_only';
	}
	const hasPatchEvidence = Boolean(text(packet.source_html_preview) || text(packet.selector) || text(packet.source_path));
	if (!hasPatchEvidence) {
		return 'issue_only';
	}
	if (candidateRepo === 'chubes4/wp-site-generator' && !hasSourceSitePatchEvidence(packet)) {
		return 'issue_only';
	}
	return 'pr_or_issue';
}

export function routeReason(packet, candidateRepo, repairMode) {
	const configured = text(packet.route_reason);
	if (configured) {
		return configured;
	}

	if (repairMode === 'issue_only') {
		return 'insufficient evidence for a safe automated PR path; group remains issue-only';
	}
	return policy.route_reasons[candidateRepo] || policy.route_reasons['chubes4/wp-site-generator'];
}

export function isCandidateRepo(value) {
	return policy.candidate_repos.includes(value);
}

function routingFields(packet, explicit) {
	const kind = text(packet.kind).toLowerCase();
	const converter = text(packet.converter).toLowerCase();
	const repairClass = text(packet.suggested_repair_class).toLowerCase();
	const category = text(packet.category).toLowerCase();
	const reasonCode = text(packet.reason_code).toLowerCase();
	const stage = text(packet.stage).toLowerCase();
	const haystack = [packet.kind, converter, packet.block_name, stage, packet.reason, packet.path, category, reasonCode, repairClass].join(' ').toLowerCase();
	return { kind, explicit, converter, repairClass, category, reasonCode, stage, haystack };
}

function matchesRule(rule, fields) {
	return matchesList(rule.kind, fields.kind)
		|| matchesList(rule.explicit_repo, fields.explicit)
		|| (matchesIncludes(rule.converter_includes, fields.converter) && matchesAnyIncludes(rule.any_includes, fields))
		|| matchesIncludes(rule.haystack_includes, fields.haystack)
		|| matchesIncludes(rule.category_includes, fields.category)
		|| matchesIncludes(rule.stage_includes, fields.stage);
}

function matchesList(values, value) {
	return Array.isArray(values) && values.includes(value);
}

function matchesIncludes(needles, haystack) {
	return Array.isArray(needles) && needles.some((needle) => haystack.includes(needle));
}

function matchesAnyIncludes(needles, fields) {
	if (!Array.isArray(needles)) {
		return true;
	}
	return needles.some((needle) => fields.repairClass.includes(needle) || fields.category.includes(needle) || fields.kind.includes(needle));
}

function hasSourceSitePatchEvidence(packet) {
	if (text(packet.kind).toLowerCase() !== 'visual_parity_mismatch') {
		return false;
	}

	const repairClass = text(packet.suggested_repair_class).toLowerCase();
	const category = text(packet.category).toLowerCase();
	const reasonCode = text(packet.reason_code).toLowerCase();
	const stage = text(packet.stage).toLowerCase();
	const routeFields = [repairClass, category, reasonCode, stage, text(packet.reason).toLowerCase()].join(' ');
	return routeFields.includes('generated_source') || routeFields.includes('source_site') || routeFields.includes('source_css') || routeFields.includes('source_html');
}
