#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { appendGithubOutput, parseArgs, writeJsonFile } from './lib/ci-runtime-utils.mjs';
import { buildSsiStackManifest, loadSsiStackConfig } from './lib/ssi-stack-manifest.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const outputPath = args.get('--output') || process.env.SSI_STACK_MANIFEST_PATH || 'homeboy-ci-results/ssi-stack-manifest.json';
const githubOutput = args.get('--github-output') || process.env.GITHUB_OUTPUT || '';
const harnessSha = args.get('--harness-sha') || process.env.VALIDATION_HARNESS_SHA || '';
const configPath = args.get('--config') || process.env.SSI_STACK_CONFIG_PATH || '';
const stackConfig = loadSsiStackConfig({ configPath });

const resolved = {};
for (const repository of [stackConfig.harness, ...Object.values(stackConfig.repositories)]) {
	resolved[repository.id] = await resolveRemoteRef(repository.git_url, repository.ref, repository.ref_type);
}

const manifest = buildSsiStackManifest({ harnessSha, resolved, config: stackConfig });
await writeJsonFile(outputPath, manifest);

if (githubOutput) {
	await appendGithubOutput(githubOutput, {
		manifest_path: outputPath,
		manifest: JSON.stringify(manifest),
		homeboy_extensions_sha: manifest.repositories.homeboy_extensions.sha,
	});
} else {
	console.log(JSON.stringify(manifest, null, 2));
}

async function resolveRemoteRef(url, ref, refType) {
	const remoteRef = refType === 'branch' ? `refs/heads/${ref}` : ref;
	const { stdout } = await execFileAsync('git', ['ls-remote', url, remoteRef], { encoding: 'utf8' });
	const [sha] = stdout.trim().split(/\s+/);
	if (!sha) {
		throw new Error(`Unable to resolve ${url} ${remoteRef}`);
	}

	return sha;
}
