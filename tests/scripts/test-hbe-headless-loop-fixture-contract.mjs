#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const homeboyExtensionsRoot = process.env.HOMEBOY_EXTENSIONS_PATH || path.join(repoRoot, '.ci/homeboy-extensions');
const fixturePath = path.join(homeboyExtensionsRoot, 'runtime-agent-ci/tests/fixtures/headless-deterministic-loop-fixture.cjs');

if (!existsSync(fixturePath)) {
	console.log('HBE headless deterministic loop fixture contract skipped; set HOMEBOY_EXTENSIONS_PATH or checkout .ci/homeboy-extensions.');
	process.exit(0);
}

const {
	assertHeadlessDeterministicLoopFixture,
	runHeadlessDeterministicLoopFixture,
} = require(fixturePath);

const run = runHeadlessDeterministicLoopFixture();
assertHeadlessDeterministicLoopFixture(run);

const task = run.result.tasks[0];
assert.equal(task.request.executor.config.runtime_profile, 'headless-fixture-profile');
assert.equal(task.request.executor.config.runtime_profiles['headless-fixture-profile'].runtime_task_ability, 'fixture/run-task');
assert.equal(task.request.executor.config.runtime_task.ability, 'fixture/run-task');
assert.equal(task.state.artifacts[0].metadata.evidence_schema, 'homeboy/headless-deterministic-loop-evidence/v1');

console.log('HBE headless deterministic loop fixture contract passed');
