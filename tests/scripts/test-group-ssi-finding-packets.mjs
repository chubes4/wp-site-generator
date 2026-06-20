#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { routeCandidateRepo, routeReason, routeRepairMode } from '../../.github/scripts/lib/finding-routing.mjs';
import { groupFindingPackets, normalizeFindingInput } from '../../.github/scripts/lib/ssi-finding-packets.mjs';

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
const fixturePackets = JSON.parse(await readFile(path.join(repoRoot, 'tests/fixtures/ssi-finding-packets.json'), 'utf8'));
const helperGrouped = groupFindingPackets(normalizeFindingInput({ packets: fixturePackets }), { routeCandidateRepo, routeRepairMode, routeReason });
assert.deepEqual(grouped, JSON.parse(JSON.stringify(helperGrouped)), 'CLI grouping uses the shared SSI finding packet contract helpers');

assert.equal(grouped.schema_version, 3);
assert.equal(grouped.packet_count, 8);
assert.equal(grouped.actionable_packet_count, 8);
assert.equal(grouped.deduped_packet_count, 8);
assert.equal(grouped.group_count, 8);
assert.deepEqual(grouped.candidate_repos.sort(), [
	'Automattic/blocks-engine',
	'chubes4/static-site-importer',
	'chubes4/wp-site-generator',
]);

const h2bcGroup = grouped.groups.find((group) => group.candidate_repo === 'Automattic/blocks-engine' && group.kind === 'unsupported_html_fallback');
assert.equal(h2bcGroup.kind, 'unsupported_html_fallback');
assert.equal(h2bcGroup.reason_code, 'unsupported_custom_element');
assert.equal(h2bcGroup.repair_mode, 'pr_or_issue');

const coreHtmlGroup = grouped.groups.find((group) => group.candidate_repo === 'Automattic/blocks-engine' && group.kind === 'core_html_block');
assert.equal(coreHtmlGroup.count, 1);

const freeformH2bcGroup = grouped.groups.find((group) => group.candidate_repo === 'Automattic/blocks-engine' && group.kind === 'freeform_block');
assert.ok(freeformH2bcGroup, 'Concrete freeform diagnostics route to Blocks Engine');
assert.equal(freeformH2bcGroup.repair_mode, 'pr_or_issue');
assert.equal(freeformH2bcGroup.packets[0].block_path, '1');
assert.match(freeformH2bcGroup.packets[0].emitted_block_preview, /wp:freeform/);

const ssiGroup = grouped.groups.find((group) => group.candidate_repo === 'chubes4/static-site-importer' && group.kind === 'asset_map');
assert.equal(ssiGroup.count, 1);
assert.deepEqual(ssiGroup.packets[0].asset_map_refs, ['key:assets/missing.jpg', 'url:assets/missing.jpg']);

const bfbGroup = grouped.groups.find((group) => group.candidate_repo === 'Automattic/blocks-engine' && group.kind === 'bfb_scope_diagnostic');
assert.equal(bfbGroup.kind, 'bfb_scope_diagnostic');
assert.match(bfbGroup.route_reason, /Blocks Engine/);

const artifactCompilerGroup = grouped.groups.find((group) => group.candidate_repo === 'Automattic/blocks-engine' && group.kind === 'artifact_schema_violation');
assert.equal(artifactCompilerGroup.kind, 'artifact_schema_violation');
assert.equal(artifactCompilerGroup.repair_mode, 'pr_or_issue');
assert.match(artifactCompilerGroup.route_reason, /Blocks Engine/);

const ambiguousGroup = grouped.groups.find((group) => group.kind === 'ambiguous_import_quality');
assert.equal(ambiguousGroup.repair_mode, 'issue_only');
assert.match(ambiguousGroup.route_reason, /insufficient evidence/);

const visualGroup = grouped.groups.find((group) => group.kind === 'visual_parity_mismatch');
assert.equal(visualGroup.candidate_repo, 'chubes4/wp-site-generator');
assert.equal(visualGroup.repair_mode, 'issue_only');
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

for (const packet of grouped.groups.flatMap((group) => group.packets)) {
	assert.equal(packet.schema_version, 3);
	assert.ok(packet.diagnostic_id !== undefined, 'schema v3 packets carry diagnostic IDs');
	assert.ok(packet.source_path !== undefined, 'schema v3 packets carry source paths');
	assert.ok(packet.severity !== undefined, 'schema v3 packets carry severity');
	assert.ok(packet.category !== undefined, 'schema v3 packets carry category');
	assert.ok(packet.reason_code !== undefined, 'schema v3 packets carry reason codes');
	assert.ok(packet.suggested_repair_class !== undefined, 'schema v3 packets carry repair class');
	assert.ok(Array.isArray(packet.diagnostic_refs), 'schema v3 packets carry diagnostic refs');
	assert.ok(Array.isArray(packet.asset_map_refs), 'schema v3 packets carry asset map refs');
}

for (const group of grouped.groups) {
	assert.equal(group.owner_repo, group.candidate_repo, 'FindingGroup owner_repo agrees with routed candidate_repo');
	assert.ok(group.root_cause, `FindingGroup ${group.candidate_repo}/${group.kind} exposes root_cause`);
	assert.ok(group.group_id, `FindingGroup ${group.candidate_repo}/${group.kind} exposes group_id`);
}

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
	.filter((packet) => packet.kind === 'ambiguous_import_quality');
assert.equal(unknownPackets.length, 1);
for (const field of designFields) {
	assert.equal(unknownPackets[0][field], 'unknown');
}

// Routing must stay stable: groups are keyed by diagnostic signals, not design metadata.
const transformerGroups = grouped.groups.filter((group) => group.candidate_repo === 'Automattic/blocks-engine');
assert.equal(transformerGroups.length, 5, 'Design fields must not split transformer routing groups');

const explicitOutputPath = path.join(tmp, 'explicit-owner-groups.json');
const explicitFixturePath = path.join(tmp, 'explicit-owner-packets.json');
await writeFile(explicitFixturePath, `${JSON.stringify([
	{
		schema_version: 3,
		diagnostic_id: 'diag-explicit-visual-artifact-owner',
		kind: 'visual_parity_mismatch',
		category: 'artifact_schema',
		reason_code: 'schema_validation_failed',
		suggested_repair_class: 'repair_artifact_schema_contract',
		candidate_repo: 'chubes4/block-artifact-compiler',
		converter: 'block-artifact-compiler',
		stage: 'artifact_contract_validation',
		source_path: 'artifacts/site.json',
		selector: '$.blocks[0]',
		source_html_preview: '<section class="hero"><h1>Shop</h1></section>',
		reason: 'Visual evidence points at an explicitly owned artifact contract failure.',
	},
], null, 2)}\n`);

const explicitResult = spawnSync(process.execPath, [
	path.join(repoRoot, '.github/scripts/group-ssi-finding-packets.mjs'),
	explicitFixturePath,
], {
	cwd: repoRoot,
	env: { ...process.env, FINDING_GROUPS_PATH: explicitOutputPath },
	encoding: 'utf8',
});

assert.equal(explicitResult.status, 0, explicitResult.stderr || explicitResult.stdout);
const explicitGrouped = JSON.parse(await readFile(explicitOutputPath, 'utf8'));
assert.equal(explicitGrouped.groups.length, 1);
assert.equal(explicitGrouped.groups[0].owner_repo, 'Automattic/blocks-engine', 'Legacy explicit transformer repo normalizes before broad visual routing');
assert.equal(explicitGrouped.groups[0].candidate_repo, 'Automattic/blocks-engine');

const structuredOutputPath = path.join(tmp, 'structured-owner-groups.json');
const structuredFixturePath = path.join(tmp, 'structured-owner-packets.json');
await writeFile(structuredFixturePath, `${JSON.stringify([
	{
		schema_version: 3,
		diagnostic_id: 'diag-structured-owner-precedence',
		kind: 'visual_parity_mismatch',
		category: 'visual_parity',
		reason_code: 'visual_mismatch',
		suggested_repair_class: 'inspect_visual_parity_policy',
		owner_repo: 'chubes4/block-format-bridge',
		candidate_repo: 'chubes4/wp-site-generator',
		converter: 'visual-parity',
		stage: 'screenshots',
		source_path: 'visual-diff.json',
		selector: '.hero',
		reason: 'Legacy haystack looks visual, but structured owner_repo identifies the serializer boundary.',
		repair_mode: 'issue_only',
		route_reason: 'structured owner_repo from diagnostic packet',
	},
	{
		schema_version: 3,
		diagnostic_id: 'diag-invalid-structured-owner-fallback',
		kind: 'asset_map',
		category: 'unresolved_asset',
		reason_code: 'asset_missing',
		suggested_repair_class: 'materialize_or_rewrite_asset',
		owner_repo: 'not-a-known-owner',
		candidate_repo: '',
		converter: 'static-site-importer',
		stage: 'asset_map',
		source_path: 'static-sites/demo/index.html',
		selector: 'img.logo',
		reason: 'Invalid structured owner should fall back to policy routing for asset_map.',
	},
], null, 2)}\n`);

const structuredResult = spawnSync(process.execPath, [
	path.join(repoRoot, '.github/scripts/group-ssi-finding-packets.mjs'),
	structuredFixturePath,
], {
	cwd: repoRoot,
	env: { ...process.env, FINDING_GROUPS_PATH: structuredOutputPath },
	encoding: 'utf8',
});

assert.equal(structuredResult.status, 0, structuredResult.stderr || structuredResult.stdout);
const structuredGrouped = JSON.parse(await readFile(structuredOutputPath, 'utf8'));
const structuredOwnerGroup = structuredGrouped.groups.find((group) => group.diagnostic_id === 'diag-structured-owner-precedence' || group.route_reason === 'structured owner_repo from diagnostic packet');
assert.equal(structuredOwnerGroup.owner_repo, 'Automattic/blocks-engine', 'Legacy structured transformer owner normalizes before candidate_repo and broad visual routing');
assert.equal(structuredOwnerGroup.candidate_repo, 'Automattic/blocks-engine');
assert.equal(structuredOwnerGroup.repair_mode, 'issue_only', 'Structured repair_mode remains authoritative');
assert.equal(structuredOwnerGroup.route_reason, 'structured owner_repo from diagnostic packet', 'Structured route_reason is preserved');

const fallbackGroup = structuredGrouped.groups.find((group) => group.kind === 'asset_map');
assert.equal(fallbackGroup.owner_repo, 'chubes4/static-site-importer', 'Invalid structured owner_repo falls back to existing policy routing');
assert.match(fallbackGroup.route_reason, /SSI import/);
