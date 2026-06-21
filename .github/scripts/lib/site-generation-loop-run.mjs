import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
	readHomeboyAgentRuntimeOverrides,
	requireLocalReplaySeed,
	resolveReplayRunId,
} from './ci-runtime-utils.mjs';

export function buildSiteGenerationLoopRunContext({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd() } = {}) {
	requireLocalReplaySeed(env);

	const runId = resolveReplayRunId(env);
	const loopId = buildSiteGenerationLoopId(runId);
	const repository = env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
	const source = resolveImmutableSourceRef({ env, root, repository });
	const dependencyRefs = resolveDependencyRefs({ env, root });
	const controllerSpecPath = env.HOMEBOY_CONTROLLER_SPEC_PATH || '.github/homeboy/controllers/static-site-generation-loop.controller.json';
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

export function resolveImmutableSourceRef({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd(), repository = env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator' } = {}) {
	const sha = env.GITHUB_SHA || gitRev(root) || '';
	if (!sha) {
		throw new Error('GITHUB_SHA or a git HEAD commit is required for deterministic site generation loop inputs.');
	}
	return {
		repository,
		sha,
		ref: env.GITHUB_REF_NAME || env.GITHUB_REF || '',
		ref_type: 'commit',
		provenance: env.GITHUB_SHA ? 'github-sha' : 'git-head',
	};
}

export function resolveDependencyRefs({ env = process.env, root = env.GITHUB_WORKSPACE || process.cwd() } = {}) {
	return compactObject({
		homeboy: dependencyRef({ id: 'homeboy', repository: 'Extra-Chill/homeboy', inputRef: env.HOMEBOY_REF || '', checkoutPath: path.join(root, '.ci/homeboy') }),
		homeboy_extensions: dependencyRef({ id: 'homeboy_extensions', repository: 'Extra-Chill/homeboy-extensions', inputRef: env.HOMEBOY_EXTENSIONS_REF || '', checkoutPath: path.join(root, '.ci/homeboy-extensions') }),
		agents_api: dependencyRef({ id: 'agents_api', repository: 'Automattic/agents-api', inputRef: env.AGENTS_API_REF || '', checkoutPath: path.join(root, '.ci/agents-api') }),
		ai_provider_for_openai: dependencyRef({ id: 'ai_provider_for_openai', repository: 'WordPress/ai-provider-for-openai', inputRef: env.AI_PROVIDER_OPENAI_REF || '', checkoutPath: path.join(root, '.ci/ai-provider-for-openai') }),
	});
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
		ref_type: sha ? 'commit' : 'mutable-ref-unresolved',
		provenance: sha ? 'checkout-head' : 'workflow-input-ref',
	});
}

function gitRev(cwd) {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
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
	return `wp-site-generator/static-site-generation-loop/${requiredLoopIdSegment(runId)}`;
}

function requiredLoopIdSegment(value) {
	const segment = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	if (!segment) {
		throw new Error('Site generation loop run id is required.');
	}
	return segment;
}
