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
assert.equal(grouped.schema_version, 2);
assert.equal(grouped.packet_count, 10);
assert.equal(grouped.actionable_packet_count, 8);
assert.equal(grouped.deduped_packet_count, 7);
assert.equal(grouped.group_count, 6);
assert.deepEqual(grouped.candidate_repos.sort(), [
	'chubes4/html-to-blocks-converter',
	'chubes4/static-site-importer',
]);

const h2bcGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/html-to-blocks-converter');
assert.equal(h2bcGroup.kind, 'core_html');
assert.equal(h2bcGroup.count, 2);

const freeformH2bcGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/html-to-blocks-converter' && group.kind === 'freeform_block');
assert.ok(freeformH2bcGroup, 'Concrete freeform diagnostics route to h2bc');
assert.equal(freeformH2bcGroup.repair_mode, 'pr_or_issue');
assert.equal(freeformH2bcGroup.packets[0].block_path, '1');
assert.match(freeformH2bcGroup.packets[0].emitted_block_preview, /wp:freeform/);

const ssiGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/static-site-importer' && group.kind === 'fallback');
assert.equal(ssiGroup.count, 1);

const aggregateFreeformGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/static-site-importer' && group.kind === 'freeform_block');
assert.ok(aggregateFreeformGroup, 'Aggregate freeform packets remain grouped for issue fallback');
assert.equal(aggregateFreeformGroup.repair_mode, 'issue_only');

const sourceRegionGroup = grouped.groups.find((group) => group.kind === 'source_region');
assert.equal(sourceRegionGroup.candidate_repo, 'chubes4/static-site-importer');

const visualGroup = grouped.groups.find((group) => group.kind === 'visual_parity_mismatch');
assert.equal(visualGroup.candidate_repo, 'chubes4/static-site-importer');
assert.equal(visualGroup.count, 1);
assert.equal(visualGroup.packets[0].visual_regions.length, 1);
assert.equal(visualGroup.packets[0].visual_regions[0].source_matches[0].selector, 'section.hero');
assert.match(visualGroup.visual_summary, /section\.hero/);
assert.equal(visualGroup.visual_code_evidence.source[0].computed_style.display, 'grid');
assert.match(visualGroup.visual_code_evidence.source[0].html, /<section/);
assert.equal(visualGroup.visual_code_evidence.source[0].matched_css_rules[0].selector, '.hero');
assert.equal(visualGroup.packets[0].visual_regions[0].imported_matches[0].computed_style['font-size'], '40px');
assert.equal(visualGroup.packets[0].visual_regions[0].layout_deltas[0].rect_delta.y, 20);
assert.equal(visualGroup.packets[0].visual_regions[0].layout_deltas[0].style_diffs[0].property, 'display');

const nonActionableKinds = grouped.groups.flatMap((group) => group.packets).map((packet) => packet.kind);
assert.ok(!nonActionableKinds.includes('ignored_region'), 'Ignored regions must not reach the iterator groups');
assert.ok(!nonActionableKinds.includes('import_clean'), 'Clean-import baseline packets must not reach the iterator groups');

// Design metadata must flow through grouping without changing routing keys.
const designFields = [
	'design_system',
	'palette_kind',
	'typography_kind',
	'layout_kind',
	'density',
	'commerce_pattern',
];

for (const group of grouped.groups) {
	assert.ok(Array.isArray(group.packets) && group.packets.length > 0, `Group ${group.candidate_repo}/${group.kind} should retain packets`);
	for (const packet of group.packets) {
		for (const field of designFields) {
			assert.ok(
				typeof packet[field] === 'string' && packet[field] !== '',
				`Packet in ${group.candidate_repo}/${group.kind} missing design field ${field}: ${JSON.stringify(packet)}`,
			);
		}
	}
}

// Editorial-magazine design metadata must persist on packets that originally carried it.
const editorialPackets = grouped.groups
	.flatMap((group) => group.packets)
	.filter((packet) => packet.design_system === 'editorial-magazine');
assert.ok(editorialPackets.length >= 2, 'Expected design fields preserved on multiple packets');
for (const packet of editorialPackets) {
	assert.equal(packet.palette_kind, 'warm-neutral');
	assert.equal(packet.typography_kind, 'mixed-serif-sans');
	assert.equal(packet.layout_kind, 'magazine');
	assert.equal(packet.density, 'comfortable');
	assert.equal(packet.commerce_pattern, 'editorial-pdp');
}

// Packets missing design.json metadata default to "unknown" rather than empty strings or failing.
const unknownPackets = grouped.groups
	.flatMap((group) => group.packets)
	.filter((packet) => packet.kind === 'source_region');
assert.equal(unknownPackets.length, 1);
for (const field of designFields) {
	assert.equal(unknownPackets[0][field], 'unknown');
}

// Routing must stay stable: groups are still keyed by candidate_repo + kind + converter + block_name + reason,
// not by design metadata. The two editorial-magazine fallback packets dedupe to a single group rather than
// splitting on design fields.
const fallbackGroups = grouped.groups.filter((group) => group.kind === 'fallback');
assert.equal(fallbackGroups.length, 1, 'Design fields must not split routing groups');
