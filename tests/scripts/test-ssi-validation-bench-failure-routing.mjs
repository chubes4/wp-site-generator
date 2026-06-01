#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wsg-bench-failure-routing-'));
const benchPath = path.join(tempDir, 'bench.json');
const packetsPath = path.join(tempDir, 'finding-packets.json');
const stderrTail = 'RuntimeException in /internal/eval.php:118';

await writeJson(benchPath, {
	success: false,
	data: {
		variant: 'single',
		payload: {
			component: 'wp-site-generator',
			exit_code: 1,
			status: 'failed',
			failure: {
				component_id: 'wp-site-generator',
				stderr_tail: stderrTail,
			},
		},
	},
});

const commonEnv = {
	...process.env,
	SITE: 'issue-366-nightjar-table-tennis-club',
	SOURCE_REPO: 'chubes4/wp-site-generator',
	BENCH_PATH: benchPath,
	FINDING_PACKETS_PATH: packetsPath,
	DESIGN_DISTRIBUTION_PATH: path.join(tempDir, 'design-distribution.json'),
	VISUAL_DIFF_PATH: path.join(tempDir, 'missing-visual-diff.json'),
	VISUAL_SUMMARY_PATH: path.join(tempDir, 'missing-summary.json'),
	IMPORT_READY_PATH: path.join(tempDir, 'missing-import-ready.json'),
};

const packetResult = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-ssi-finding-packets.mjs')], {
	cwd: repoRoot,
	env: commonEnv,
	encoding: 'utf8',
});

assert.equal(packetResult.status, 0, packetResult.stderr || packetResult.stdout);

const packets = JSON.parse(await readFile(packetsPath, 'utf8'));
assert.equal(packets.filter((packet) => packet.kind === 'bench_failure').length, 1);
assert.equal(packets.some((packet) => packet.kind === 'report_missing'), false, 'bench failures should not route synthetic missing-report packets to SSI');
assert.equal(packets[0].candidate_repo, 'chubes4/wp-site-generator');
assert.equal(packets[0].reason_code, 'bench_runner');
assert.match(packets[0].reason, /status=failed/);
assert.match(packets[0].reason, /exit_code=1/);
assert.match(packets[0].preview, /RuntimeException/);

const renderResult = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs')], {
	cwd: repoRoot,
	env: commonEnv,
	encoding: 'utf8',
});

assert.equal(renderResult.status, 0, renderResult.stderr || renderResult.stdout);
assert.doesNotMatch(renderResult.stdout, /SSI workload did not run/);
assert.match(renderResult.stdout, /Homeboy Bench Failure/);
assert.match(renderResult.stdout, /Exit code.*1/);
assert.match(renderResult.stdout, /RuntimeException/);

console.log('SSI validation bench failure routing smoke passed');

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
