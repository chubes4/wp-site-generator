#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const repo = required('SOURCE_REPO', args.get('--repo') || process.env.SOURCE_REPO || process.env.GITHUB_REPOSITORY);
const sourcePr = required('SOURCE_PR', args.get('--source-pr') || process.env.SOURCE_PR);
const sourceHeadSha = args.get('--source-head-sha') || process.env.SOURCE_HEAD_SHA || '';
const validationRunId = required('VALIDATION_RUN_ID', args.get('--validation-run-id') || process.env.VALIDATION_RUN_ID || process.env.GITHUB_RUN_ID);
const artifactName = required('ARTIFACT_NAME', args.get('--artifact-name') || process.env.ARTIFACT_NAME);
const visualArtifactName = required('VISUAL_ARTIFACT_NAME', args.get('--visual-artifact-name') || process.env.VISUAL_ARTIFACT_NAME);
const ref = args.get('--ref') || process.env.ITERATOR_REF || 'main';
const openaiModel = args.get('--openai-model') || process.env.OPENAI_MODEL || 'gpt-5.5';
const dataMachineRef = args.get('--data-machine-ref') || process.env.DATA_MACHINE_REF || 'main';
const dataMachineCodeRef = args.get('--data-machine-code-ref') || process.env.DATA_MACHINE_CODE_REF || 'main';
const dryRun = args.has('--dry-run') || process.env.DRY_RUN === '1';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

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
	await githubApi(repo, 'actions/workflows/php-transformer-iterator.yml/dispatches', {
		method: 'POST',
		body: JSON.stringify(payload),
	});
	console.log(`dispatched php-transformer-iterator for ${repo} PR #${sourcePr}`);
}

async function githubApi(repository, endpoint, init = {}) {
	const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.headers || {}),
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${endpoint} failed: ${response.status} ${await response.text()}`);
	}
}

function required(name, value) {
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function parseArgs(argv) {
	const parsed = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}
		const next = argv[i + 1];
		parsed.set(arg, next && !next.startsWith('--') ? next : '1');
		if (next && !next.startsWith('--')) {
			i += 1;
		}
	}
	return parsed;
}
