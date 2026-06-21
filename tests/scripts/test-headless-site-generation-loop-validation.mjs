import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createHomeboyControllerFixture } from '../helpers/homeboy-fixtures.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-headless-loop-test-'));
const homeboyFixturePath = await createHomeboyControllerFixture(tempDir);
const evidencePath = path.join(tempDir, 'headless-evidence.json');

try {
	const result = spawnSync(process.execPath, [
		'.github/scripts/validate-headless-site-generation-loop.mjs',
		'--homeboy-bin',
		homeboyFixturePath,
		'--work-dir',
		tempDir,
		'--evidence',
		evidencePath,
		'--run-id',
		'headless-test',
		'--randomness-seed',
		'headless-seed',
		'--runtime-id',
		'contract-runtime',
		'--fixture-artifacts',
	], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /Headless site generation loop contract passed/);

	const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	assert.equal(evidence.schema, 'wp-site-generator/headless-site-generation-loop-validation/v1');
	assert.equal(evidence.valid, true);
	assert.equal(evidence.runtime_input_contract, 'homeboy-agent-runtime-env');
	assert.equal(evidence.runtime_id, 'contract-runtime');
	assert.equal(evidence.fixture_artifacts, true);
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller materialize')), 'evidence records Homeboy materialize command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller from-spec')), 'evidence records Homeboy from-spec command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller resume')), 'evidence records Homeboy resume command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller events')), 'evidence records Homeboy event command');
	assert.ok(evidence.commands.every((item) => !item.command.includes('gh workflow run')), 'headless path does not rely on GitHub workflow dispatch');
	assert.ok(evidence.upstream_dependencies.includes('https://github.com/Extra-Chill/homeboy-extensions/pull/1645'), 'evidence records the headless runner upstream dependency');

	const controllerRunSpec = JSON.parse(await readFile(evidence.paths.controller_run_spec, 'utf8'));
	assert.equal(JSON.stringify(controllerRunSpec).toLowerCase().includes('codebox'), false, 'materialized controller spec stays backend-neutral');
	assert.ok(controllerRunSpec.workflows.every((workflow) => workflow.inputs?.runtime_input_contract === 'homeboy-agent-runtime-env'), 'all workflows carry the generic runtime env contract');

	console.log('headless site generation loop validation tests passed');
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
