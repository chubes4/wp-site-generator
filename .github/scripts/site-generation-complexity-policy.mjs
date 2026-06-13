import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function evaluateComplexityPolicy({ policy, qualitySignals = {}, runId = '', overrides = {} }) {
	const tiers = [...policy.tiers].sort((a, b) => a.rank - b.rank);
	const tierIds = tiers.map((tier) => tier.id);
	const defaultTier = tierById(tiers, policy.default_tier) || tiers[0];
	const currentTier = tierById(tiers, overrides.currentTier || qualitySignals.current_tier || qualitySignals.currentTier || defaultTier.id) || defaultTier;
	const results = recentResults(qualitySignals).slice(-Number(policy.quality_window || 6));
	const summary = summarizeResults(results);
	const criteria = policy.ramp || {};
	const stable = isStable(summary, criteria.stable || {});
	const regressing = isRegressing(summary, criteria.regression || {});
	const explicitTier = overrides.tier ? tierById(tiers, overrides.tier) : null;

	let selectedTier = currentTier;
	let decision = 'hold';
	let reason = summary.count === 0 ? 'no recent quality signals; using current/default tier' : 'recent quality does not meet ramp or regression criteria';

	if (explicitTier) {
		selectedTier = explicitTier;
		decision = 'override';
		reason = `tier overridden to ${explicitTier.id}`;
	} else if (regressing) {
		selectedTier = tierAtRank(tiers, Math.max(0, currentTier.rank - 1));
		decision = selectedTier.id === currentTier.id ? 'hold_floor' : 'lower';
		reason = 'recent quality regressed beyond configured thresholds';
	} else if (stable) {
		selectedTier = tierAtRank(tiers, Math.min(tiers.length - 1, currentTier.rank + 1));
		decision = selectedTier.id === currentTier.id ? 'hold_ceiling' : 'raise';
		reason = 'recent quality is stable at the current tier';
	}

	const randomnessProfileId = overrides.randomnessProfile || randomnessProfileForTier(policy, selectedTier);
	const randomnessProfile = policy.randomness_profiles?.[randomnessProfileId] || policy.randomness_profiles?.[policy.default_randomness_profile] || {};
	const seed = String(overrides.seed || qualitySignals.randomness_seed || deterministicSeed({ runId, tier: selectedTier.id, profile: randomnessProfileId }));
	const siteKindMix = overrides.siteKindMix?.length ? overrides.siteKindMix : selectedTier.site_kind_mix;
	const targetParallelCandidates = Math.max(1, Number(overrides.targetParallelCandidates || selectedTier.target_parallel_candidates || 1));

	return {
		schema: policy.schema,
		policy_path: overrides.policyPath,
		quality_signals_path: overrides.qualitySignalsPath || '',
		current_tier: currentTier.id,
		selected_tier: selectedTier.id,
		decision,
		reason,
		randomness_seed: seed,
		randomness_profile: {
			id: randomnessProfileId,
			...randomnessProfile,
		},
		site_kind_mix: siteKindMix,
		target_parallel_candidates: targetParallelCandidates,
		criteria,
		quality_summary: summary,
		tier: selectedTier,
		tier_order: tierIds,
		overrides: compactObject({
			tier: overrides.tier,
			randomness_profile: overrides.randomnessProfile,
			randomness_seed: overrides.seed,
			site_kind_mix: overrides.siteKindMix,
			target_parallel_candidates: overrides.targetParallelCandidates,
		}),
	};
}

export function policyPrompt(policyDecision, lane) {
	const tier = policyDecision.tier || {};
	return [
		'Generation complexity policy:',
		`- tier: ${policyDecision.selected_tier} (${policyDecision.decision}; ${policyDecision.reason})`,
		`- lane: ${lane}`,
		`- randomness profile: ${policyDecision.randomness_profile.id} seed ${policyDecision.randomness_seed}`,
		`- site-kind mix: ${(policyDecision.site_kind_mix || []).join(', ')}`,
		`- allowed layout families: ${(tier.allowed_layout_families || []).join(', ')}`,
		`- component families: ${(tier.component_families || []).join(', ')}`,
		`- guidance: ${tier.prompt_guidance || tier.description || 'Keep the candidate importable and record policy metadata.'}`,
		'Record the tier, randomness profile, randomness seed, chosen site kind, layout family, component families, and policy decision in emitted artifact metadata.',
	].join('\n');
}

export function loadQualitySignals(filePath) {
	if (!filePath) {
		return {};
	}
	if (!fs.existsSync(filePath)) {
		throw new Error(`Quality signals file does not exist: ${filePath}`);
	}
	return readJsonFile(filePath);
}

export function loadPolicy(filePath) {
	return readJsonFile(filePath);
}

export function resolvePolicyInputs({ root, env = process.env }) {
	const policyPath = path.resolve(root, env.WPSG_COMPLEXITY_POLICY_PATH || '.github/site-generation-complexity-policy.json');
	const qualitySignalsPath = env.WPSG_QUALITY_SIGNALS_PATH || env.HOMEBOY_QUALITY_SIGNALS_PATH || '';
	return {
		policyPath,
		qualitySignalsPath: qualitySignalsPath ? path.resolve(root, qualitySignalsPath) : '',
		overrides: {
			policyPath: path.relative(root, policyPath),
			qualitySignalsPath: qualitySignalsPath ? path.relative(root, path.resolve(root, qualitySignalsPath)) : '',
			currentTier: env.WPSG_CURRENT_COMPLEXITY_TIER || '',
			tier: env.WPSG_COMPLEXITY_TIER || '',
			randomnessProfile: env.WPSG_RANDOMNESS_PROFILE || '',
			seed: env.WPSG_RANDOMNESS_SEED || '',
			siteKindMix: listEnv(env.WPSG_SITE_KIND_MIX),
			targetParallelCandidates: env.WPSG_TARGET_PARALLEL_CANDIDATES || '',
		},
	};
}

function recentResults(qualitySignals) {
	if (Array.isArray(qualitySignals)) {
		return qualitySignals;
	}
	return qualitySignals.recent_results || qualitySignals.results || qualitySignals.validations || [];
}

function summarizeResults(results) {
	const normalized = results.map(normalizeResult);
	const count = normalized.length;
	const passed = normalized.filter((result) => result.passed).length;
	return {
		count,
		passed,
		failed: count - passed,
		pass_rate: count ? round(passed / count) : 0,
		average_fallback_blocks: average(normalized.map((result) => result.fallbackBlocks)),
		average_visual_mismatch_ratio: average(normalized.map((result) => result.visualMismatchRatio)),
		average_actionable_findings: average(normalized.map((result) => result.actionableFindings)),
		site_kinds: [...new Set(normalized.map((result) => result.siteKind).filter(Boolean))],
		pattern_families: [...new Set(normalized.map((result) => result.patternFamily).filter(Boolean))],
	};
}

function normalizeResult(result) {
	const status = String(result.status || result.outcome || '').toLowerCase();
	const passed = result.passed === true || result.pass === true || status === 'pass' || status === 'passed' || status === 'success';
	return {
		passed,
		fallbackBlocks: numberValue(result.fallback_block_count ?? result.fallback_blocks ?? result.ssi_fallback_count),
		visualMismatchRatio: numberValue(result.visual_mismatch_ratio ?? result.visual_parity?.mismatch_ratio ?? result.visualDiff?.mismatchRatio),
		actionableFindings: numberValue(result.actionable_findings ?? result.finding_counts?.actionable ?? result.findings?.actionable),
		siteKind: result.site_kind || result.siteKind || '',
		patternFamily: result.pattern_family || result.patternFamily || '',
	};
}

function isStable(summary, criteria) {
	return summary.count >= Number(criteria.minimum_results || 0)
		&& summary.pass_rate >= Number(criteria.minimum_pass_rate || 1)
		&& summary.average_fallback_blocks <= Number(criteria.maximum_average_fallback_blocks ?? 0)
		&& summary.average_visual_mismatch_ratio <= Number(criteria.maximum_average_visual_mismatch_ratio ?? 0)
		&& summary.average_actionable_findings <= Number(criteria.maximum_average_actionable_findings ?? 0);
}

function isRegressing(summary, criteria) {
	if (summary.count === 0) {
		return false;
	}
	return summary.pass_rate <= Number(criteria.maximum_pass_rate ?? -1)
		|| summary.average_fallback_blocks >= Number(criteria.minimum_average_fallback_blocks ?? Number.POSITIVE_INFINITY)
		|| summary.average_visual_mismatch_ratio >= Number(criteria.minimum_average_visual_mismatch_ratio ?? Number.POSITIVE_INFINITY)
		|| summary.average_actionable_findings >= Number(criteria.minimum_average_actionable_findings ?? Number.POSITIVE_INFINITY);
}

function randomnessProfileForTier(policy, tier) {
	if (tier.rank >= 2 && policy.randomness_profiles?.exploratory) {
		return 'exploratory';
	}
	if (tier.rank >= 1 && policy.randomness_profiles?.varied) {
		return 'varied';
	}
	return policy.default_randomness_profile;
}

function deterministicSeed({ runId, tier, profile }) {
	return crypto.createHash('sha256').update(`${runId}:${tier}:${profile}`).digest('hex').slice(0, 12);
}

function tierById(tiers, id) {
	return tiers.find((tier) => tier.id === id);
}

function tierAtRank(tiers, rank) {
	return tiers.find((tier) => tier.rank === rank) || tiers[0];
}

function average(values) {
	const finite = values.filter((value) => Number.isFinite(value));
	if (!finite.length) {
		return 0;
	}
	return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function numberValue(value) {
	const number = Number(value || 0);
	return Number.isFinite(number) ? number : 0;
}

function round(value) {
	return Number(value.toFixed(4));
}

function listEnv(value) {
	return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function compactObject(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => {
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		return value !== undefined && value !== null && value !== '';
	}));
}
