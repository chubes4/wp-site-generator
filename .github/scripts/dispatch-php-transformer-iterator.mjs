#!/usr/bin/env node

import { envOrArg, parseArgs, requiredValue } from './lib/ci-runtime-utils.mjs';
import { dispatchWorkflow, githubToken } from './lib/github-api.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = requiredValue('SOURCE_REPO', envOrArg(args, '--repo', process.env, 'SOURCE_REPO', process.env.GITHUB_REPOSITORY));
const sourcePr = requiredValue('SOURCE_PR', envOrArg(args, '--source-pr', process.env, 'SOURCE_PR'));
const sourceHeadSha = envOrArg(args, '--source-head-sha', process.env, 'SOURCE_HEAD_SHA');
const validationRunId = requiredValue('VALIDATION_RUN_ID', envOrArg(args, '--validation-run-id', process.env, 'VALIDATION_RUN_ID', process.env.GITHUB_RUN_ID));
const artifactName = requiredValue('ARTIFACT_NAME', envOrArg(args, '--artifact-name', process.env, 'ARTIFACT_NAME'));
const visualArtifactName = requiredValue('VISUAL_ARTIFACT_NAME', envOrArg(args, '--visual-artifact-name', process.env, 'VISUAL_ARTIFACT_NAME'));
const ref = envOrArg(args, '--ref', process.env, 'ITERATOR_REF', 'main');
const openaiModel = envOrArg(args, '--openai-model', process.env, 'OPENAI_MODEL', 'gpt-5.5');
const dryRun = args.has('--dry-run') || process.env.DRY_RUN === '1';
const token = githubToken();

const payload = {
	ref,
	inputs: {
		source_repo: repo,
		source_pr: String(sourcePr),
		source_head_sha: sourceHeadSha,
		validation_run_id: String(validationRunId),
		artifact_name: artifactName,
		visual_artifact_name: visualArtifactName,
		openai_model: openaiModel,
	},
};

if (dryRun) {
	console.log(JSON.stringify({ repo, workflow: 'php-transformer-iterator.yml', payload }, null, 2));
} else {
	if (!token) {
		throw new Error('GH_TOKEN or GITHUB_TOKEN is required to dispatch php-transformer-iterator.yml.');
	}
	await dispatchWorkflow({
		repo,
		workflow: 'php-transformer-iterator.yml',
		ref,
		inputs: payload.inputs,
		token,
	});
	console.log(`dispatched php-transformer-iterator for ${repo} PR #${sourcePr}`);
}
