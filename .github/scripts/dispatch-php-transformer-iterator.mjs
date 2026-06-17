#!/usr/bin/env node

import { parseArgs, requiredValue } from './lib/ci-runtime-utils.mjs';
import { githubApi, githubToken } from './lib/github-api.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = requiredValue('SOURCE_REPO', args.get('--repo') || process.env.SOURCE_REPO || process.env.GITHUB_REPOSITORY);
const sourcePr = requiredValue('SOURCE_PR', args.get('--source-pr') || process.env.SOURCE_PR);
const sourceHeadSha = args.get('--source-head-sha') || process.env.SOURCE_HEAD_SHA || '';
const validationRunId = requiredValue('VALIDATION_RUN_ID', args.get('--validation-run-id') || process.env.VALIDATION_RUN_ID || process.env.GITHUB_RUN_ID);
const artifactName = requiredValue('ARTIFACT_NAME', args.get('--artifact-name') || process.env.ARTIFACT_NAME);
const visualArtifactName = requiredValue('VISUAL_ARTIFACT_NAME', args.get('--visual-artifact-name') || process.env.VISUAL_ARTIFACT_NAME);
const ref = args.get('--ref') || process.env.ITERATOR_REF || 'main';
const openaiModel = args.get('--openai-model') || process.env.OPENAI_MODEL || 'gpt-5.5';
const dataMachineRef = args.get('--data-machine-ref') || process.env.DATA_MACHINE_REF || 'main';
const dataMachineCodeRef = args.get('--data-machine-code-ref') || process.env.DATA_MACHINE_CODE_REF || 'main';
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
		data_machine_ref: dataMachineRef,
		data_machine_code_ref: dataMachineCodeRef,
	},
};

if (dryRun) {
	console.log(JSON.stringify({ repo, workflow: 'php-transformer-iterator.yml', payload }, null, 2));
} else {
	if (!token) {
		throw new Error('GH_TOKEN or GITHUB_TOKEN is required to dispatch php-transformer-iterator.yml.');
	}
	await githubApi({
		repo,
		endpoint: 'actions/workflows/php-transformer-iterator.yml/dispatches',
		token,
		init: {
		method: 'POST',
		body: JSON.stringify(payload),
		},
	});
	console.log(`dispatched php-transformer-iterator for ${repo} PR #${sourcePr}`);
}
