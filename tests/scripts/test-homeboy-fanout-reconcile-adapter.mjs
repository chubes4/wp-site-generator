import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-fanout-adapter-'));
const hbeScript = path.join(tempDir, 'hbe/wordpress/scripts/agent/homeboy-generic-fanout-reconcile.cjs');
const configPath = path.join(tempDir, 'fanout-config.json');
const outputPath = path.join(tempDir, 'fanout-plan.json');

await mkdir(path.dirname(hbeScript), { recursive: true });
await writeFile(configPath, `${JSON.stringify({ schema: 'homeboy/generic-fanout-reconcile-config/v1' })}\n`);
await writeFile(hbeScript, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.argv[3], JSON.stringify({ schema: 'homeboy/fanout-reconcile-plan/v1', source: process.argv[2] }) + '\\n');
`);

const adapterResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/run-homeboy-fanout-reconcile.mjs'),
		'--config',
		configPath,
		'--output',
		outputPath,
	],
	{
		cwd: repoRoot,
		env: { ...process.env, HOMEBOY_EXTENSIONS_PATH: path.join(tempDir, 'hbe') },
		encoding: 'utf8',
	},
);

assert.equal(adapterResult.status, 0, adapterResult.stderr || adapterResult.stdout);
assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), {
	schema: 'homeboy/fanout-reconcile-plan/v1',
	source: configPath,
});

const missingResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/run-homeboy-fanout-reconcile.mjs'),
		'--config',
		configPath,
		'--output',
		path.join(tempDir, 'missing-plan.json'),
	],
	{
		cwd: repoRoot,
		env: { ...process.env, HOMEBOY_EXTENSIONS_PATH: path.join(tempDir, 'missing') },
		encoding: 'utf8',
	},
);

assert.notEqual(missingResult.status, 0, 'adapter fails instead of silently reimplementing HBE fanout planning');
assert.match(missingResult.stderr, /HOMEBOY_FANOUT_RECONCILE_COMMAND|HOMEBOY_EXTENSIONS_PATH/, 'adapter reports the upstream dependency seam');

console.log('homeboy fanout reconcile adapter tests passed');
