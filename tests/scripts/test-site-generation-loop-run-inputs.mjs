#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSiteGenerationLoopRunContext, validateRefPolicy } from '../../.github/scripts/lib/site-generation-loop-run.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-loop-run-inputs-'));
const outputPath = path.join(tempDir, 'controller-run-inputs.json');
const policyResultPath = path.join(tempDir, 'complexity-policy-result.json');

assert.throws(
	() => buildSiteGenerationLoopRunContext({ env: {}, root: repoRoot }),
	/WPSG_RANDOMNESS_SEED is required/,
	'local replay plans require an explicit seed'
);

const context = buildSiteGenerationLoopRunContext({
	env: {
		WPSG_REPLAY_ID: 'local-replay-123',
		WPSG_RANDOMNESS_SEED: 'seed-123',
		GITHUB_REPOSITORY: 'chubes4/wp-site-generator',
		HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: outputPath,
		HOMEBOY_POLICY_RESULT_PATH: policyResultPath,
	},
	root: repoRoot,
});
assert.equal(context.runId, 'local-replay-123');
assert.equal(context.loopId, 'wp-site-generator/static-site-generation-loop/local-replay-123');
assert.equal(context.outputPath, outputPath);
assert.equal(context.policyResultPath, policyResultPath);
assert.equal(context.source.sha.length, 40, 'loop context records an immutable source commit');
assert.doesNotThrow(() => validateRefPolicy({
	policy: 'branch-defaults',
	dependencyRefs: {
		homeboy: { id: 'homeboy', input_ref: 'main', ref_type: 'mutable-ref-unresolved' },
	},
}), 'branch-defaults mode allows staging refs');
assert.throws(() => validateRefPolicy({
	policy: 'production',
	dependencyRefs: {
		homeboy: { id: 'homeboy', input_ref: 'main', sha: 'a'.repeat(40), ref_type: 'commit' },
	},
}), /production ref policy requires immutable dependency refs/, 'production mode rejects mutable dependency inputs');
assert.doesNotThrow(() => validateRefPolicy({
	policy: 'production',
	dependencyRefs: {
		homeboy: { id: 'homeboy', input_ref: 'a'.repeat(40), sha: 'a'.repeat(40), ref_type: 'commit' },
	},
}), 'production mode accepts immutable dependency inputs');

const result = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-homeboy-controller-run-inputs.mjs')], {
	cwd: repoRoot,
	encoding: 'utf8',
	env: {
		...process.env,
		GITHUB_WORKSPACE: repoRoot,
		GITHUB_REPOSITORY: 'chubes4/wp-site-generator',
		WPSG_REPLAY_ID: 'local-replay-123',
		WPSG_RANDOMNESS_SEED: 'seed-123',
		HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: outputPath,
		HOMEBOY_POLICY_RESULT_PATH: policyResultPath,
	},
});
assert.equal(result.status, 0, result.stderr || result.stdout);

const runInputs = JSON.parse(await readFile(outputPath, 'utf8'));
const policyResult = JSON.parse(await readFile(policyResultPath, 'utf8'));
assert.equal(runInputs.inputs.run_id, 'local-replay-123');
assert.equal(runInputs.inputs.loop_id, 'wp-site-generator/static-site-generation-loop/local-replay-123');
assert.equal(runInputs.inputs.randomness_seed, 'seed-123');
assert.equal(runInputs.inputs.randomness_profile, 'steady');
assert.equal(runInputs.inputs.source.ref_type, 'commit');
assert.equal(runInputs.inputs.source.sha.length, 40);
assert.equal(runInputs.metadata.run.loop_id, 'wp-site-generator/static-site-generation-loop/local-replay-123');
assert.equal(runInputs.metadata.run.randomness_seed, 'seed-123');
assert.equal(runInputs.metadata.run.source.sha, runInputs.inputs.source.sha);
assert.equal(runInputs.metadata.run.generated_by, '.github/scripts/build-homeboy-controller-run-inputs.mjs');
assert.equal(policyResult.provenance.run_id, 'local-replay-123');

console.log('site generation loop run input tests passed');
