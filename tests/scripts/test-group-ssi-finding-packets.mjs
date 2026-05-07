#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tmp = await mkdtemp(path.join(tmpdir(), 'ssi-finding-groups-'));
const outputPath = path.join(tmp, 'groups.json');
const result = spawnSync(process.execPath, [
	path.join(repoRoot, '.github/scripts/group-ssi-finding-packets.mjs'),
	path.join(repoRoot, 'tests/fixtures/ssi-finding-packets.json'),
], {
	cwd: repoRoot,
	env: { ...process.env, FINDING_GROUPS_PATH: outputPath },
	encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const grouped = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(grouped.packet_count, 3);
assert.equal(grouped.deduped_packet_count, 2);
assert.equal(grouped.group_count, 2);
assert.deepEqual(grouped.candidate_repos.sort(), [
	'chubes4/html-to-blocks-converter',
	'chubes4/static-site-importer',
]);

const h2bcGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/html-to-blocks-converter');
assert.equal(h2bcGroup.kind, 'core_html');
assert.equal(h2bcGroup.count, 1);

const ssiGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/static-site-importer');
assert.equal(ssiGroup.count, 1);
