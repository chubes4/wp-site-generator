import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
	readHomeboyAgentRuntimeOverrides,
	requireLocalReplaySeed,
	resolveReplayRunId,
} from './ci-runtime-utils.mjs';
import { siteGenerationLoopId, wpsgLoopConfig } from './wpsg-domain-config.mjs';

export function buildSiteGenerationLoopRunContext({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd() } = {}) {
	requireLocalReplaySeed(env);

	const runId = resolveReplayRunId(env);
	const loopId = buildSiteGenerationLoopId(runId);
	const repository = env.GITHUB_REPOSITORY || wpsgLoopConfig.repository;
	const source = resolveImmutableSourceRef({ env, root, repository });
	const dependencyRefs = resolveDependencyRefs({ env, root });
	validateRefPolicy({ policy: env.WPSG_REF_POLICY || wpsgLoopConfig.defaultRefPolicy, dependencyRefs, source });
	const controllerSpecPath = env.HOMEBOY_CONTROLLER_SPEC_PATH || wpsgLoopConfig.controllerSpecPath;
	const outputPath = env.HOMEBOY_CONTROLLER_RUN_INPUTS_PATH || path.join(root, '.ci', 'site-generation-loop.controller-run-inputs.json');
	const policyResultPath = env.HOMEBOY_POLICY_RESULT_PATH || outputPath.replace(/\.json$/, '.complexity-policy-result.json');
	const runtimeOverrides = readHomeboyAgentRuntimeOverrides(env);

	return {
		runId,
		loopId,
		repository,
		controllerSpecPath,
		outputPath,
		policyResultPath,
		runtimeOverrides,
		source,
		dependencyRefs,
	};
}

export function resolveImmutableSourceRef({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd(), repository = env.GITHUB_REPOSITORY || wpsgLoopConfig.repository } = {}) {
	const artifactSource = env.SOURCE_ARTIFACT_SOURCE || env.STATIC_SITE_CANDIDATE || env.CONCEPT_PACKET || '';
	if (artifactSource) {
		return {
			repository,
			artifact_source: artifactSource,
			ref_type: 'artifact',
			provenance: 'source-artifact',
		};
	}

	const tag = env.SOURCE_TAG || '';
	if (tag) {
		return {
			repository,
			ref: tag,
			ref_type: 'tag',
			provenance: 'source-tag',
		};
	}

	const sha = env.SOURCE_HEAD_SHA || env.GITHUB_SHA || gitRev(root) || '';
	if (!sha) {
		throw new Error('SOURCE_HEAD_SHA, SOURCE_TAG, SOURCE_ARTIFACT_SOURCE, GITHUB_SHA, or a git HEAD commit is required for deterministic site generation loop inputs.');
	}
	return {
		repository,
		sha,
		ref: env.GITHUB_REF_NAME || env.GITHUB_REF || '',
		ref_type: 'commit',
		provenance: env.SOURCE_HEAD_SHA ? 'source-head-sha' : (env.GITHUB_SHA ? 'github-sha' : 'git-head'),
	};
}

export function resolveDependencyRefs({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd() } = {}) {
	return compactObject({
		homeboy: dependencyRef({ id: 'homeboy', repository: 'Extra-Chill/homeboy', inputRef: env.HOMEBOY_REF || '', checkoutPath: path.join(root, '.ci/homeboy') }),
		homeboy_extensions: dependencyRef({ id: 'homeboy_extensions', repository: 'Extra-Chill/homeboy-extensions', inputRef: env.HOMEBOY_EXTENSIONS_REF || '', checkoutPath: path.join(root, '.ci/homeboy-extensions') }),
	});
}

export function validateRefPolicy({ policy = wpsgLoopConfig.defaultRefPolicy, dependencyRefs = {}, source = null } = {}) {
	if (policy === wpsgLoopConfig.defaultRefPolicy) {
		return;
	}
	if (policy !== wpsgLoopConfig.productionRefPolicy) {
		throw new Error(`Unknown WPSG ref policy: ${policy}`);
	}

	const mutableRefs = Object.values(dependencyRefs).filter((dependency) => !isImmutableDependencyRef(dependency));
	if (mutableRefs.length > 0) {
		const labels = mutableRefs.map((dependency) => `${dependency.id}:${dependency.input_ref || dependency.ref_type || 'unresolved'}`).join(', ');
		throw new Error(`WPSG production ref policy requires immutable dependency refs. Mutable or unresolved refs: ${labels}`);
	}

	if (source && !isImmutableSourceRef(source)) {
		throw new Error('WPSG production ref policy requires SOURCE_HEAD_SHA, SOURCE_TAG, or SOURCE_ARTIFACT_SOURCE for source provenance.');
	}
}

function dependencyRef({ id, repository, inputRef, checkoutPath }) {
	const sha = gitRev(checkoutPath);
	if (!sha && !inputRef) {
		return null;
	}
	return compactObject({
		id,
		repository,
		input_ref: inputRef,
		sha,
		ref_type: sha ? dependencyRefType(inputRef) : 'mutable-ref-unresolved',
		provenance: sha ? 'checkout-head' : 'workflow-input-ref',
	});
}

export function isImmutableDependencyRef(dependency = {}) {
	const inputRef = dependency.input_ref || '';
	if (inputRef) {
		return isFullSha(inputRef) || isPinnedTagRef(inputRef);
	}
	if (isFullSha(dependency.sha)) {
		return true;
	}
	return false;
}

export function isImmutableSourceRef(source = {}) {
	if (source.ref_type === 'artifact' && source.artifact_source) {
		return true;
	}
	if (source.ref_type === 'tag' && isPinnedTagRef(source.ref)) {
		return true;
	}
	return source.ref_type === 'commit' && source.provenance === 'source-head-sha' && isFullSha(source.sha);
}

function dependencyRefType(inputRef) {
	if (isFullSha(inputRef)) {
		return 'commit';
	}
	if (isPinnedTagRef(inputRef)) {
		return 'tag';
	}
	return 'branch';
}

function gitRev(cwd) {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

function isFullSha(value) {
	return /^[0-9a-f]{40}$/i.test(String(value || ''));
}

function isPinnedTagRef(value) {
	return /^refs\/tags\/.+/.test(String(value || '')) || /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || ''));
}

function compactObject(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => {
		if (!value) {
			return false;
		}
		if (typeof value === 'object' && !Array.isArray(value)) {
			return Object.keys(value).length > 0;
		}
		return true;
	}));
}

export function buildSiteGenerationLoopId(runId) {
	return siteGenerationLoopId(runId);
}
