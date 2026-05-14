import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-dm-workflow-'));
const outputPath = path.join(tempDir, 'workflow.json');
const groupedPath = path.join(tempDir, 'groups.json');
const visualArtifactDir = path.join(tempDir, 'visual-parity');

await mkdir(visualArtifactDir, { recursive: true });
await Promise.all([
	writeFile(path.join(visualArtifactDir, 'source.png'), ''),
	writeFile(path.join(visualArtifactDir, 'imported.png'), ''),
	writeFile(path.join(visualArtifactDir, 'diff.png'), ''),
	writeFile(path.join(visualArtifactDir, 'summary.json'), '{}\n'),
	writeFile(path.join(visualArtifactDir, 'comparison.html'), '<!doctype html>\n'),
	writeFile(
		path.join(visualArtifactDir, 'visual-diff.json'),
		`${JSON.stringify(
			{
				pass: false,
				threshold: 0.015,
				mismatchPixels: 7200,
				totalPixels: 400000,
				mismatchRatio: 0.018,
				dimensionMismatch: true,
				source: { path: 'source.png', width: 1280, height: 5076 },
				imported: { path: 'imported.png', width: 1280, height: 7450 },
				diff: { path: 'diff.png', width: 1280, height: 7450 },
				regions: [
					{
						rank: 1,
						x: 0,
						y: 640,
						width: 1280,
						height: 320,
						mismatchPixels: 1200,
						totalPixels: 409600,
						mismatchRatio: 0.0029296875,
						source_matches: [{ selector: 'section.hero', text: 'Crown Alley Little Stage', rect: { x: 0, y: 600, width: 1280, height: 360 } }],
						imported_matches: [{ selector: 'main.wp-block-group', text: 'Crown Alley Little Stage', rect: { x: 0, y: 620, width: 1280, height: 380 } }],
					},
				],
			},
			null,
			2
		)}\n`
	),
]);

const groupResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/group-ssi-finding-packets.mjs'),
		path.join(repoRoot, 'tests/fixtures/ssi-finding-packets.json'),
	],
	{
		cwd: repoRoot,
		env: { ...process.env, FINDING_GROUPS_PATH: groupedPath },
		encoding: 'utf8',
	},
);

assert.equal(groupResult.status, 0, groupResult.stderr || groupResult.stdout);

const result = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/build-datamachine-iterator-workflow.mjs'),
		groupedPath,
		outputPath,
	],
	{ cwd: repoRoot, env: { ...process.env, VISUAL_ARTIFACT_DIR: visualArtifactDir }, encoding: 'utf8' },
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const payload = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(payload.workflow.steps.length, 2, 'workflow has emit + iterator AI steps');

const [emitStep, aiStep] = payload.workflow.steps;
assert.equal(emitStep.type, 'system_task', 'first step is system_task');
assert.equal(emitStep.flow_step_settings.task, 'emit_data_packets', 'first step uses emit_data_packets');
assert.equal(emitStep.flow_step_settings.params.replace_data_packets, true, 'emit step replaces stale upstream packets');
assert.equal(emitStep.flow_step_settings.params.suppress_result_packet, true, 'emit step suppresses synthetic task result');
assert.equal(emitStep.flow_step_settings.params.complete_no_items, true, 'empty findings stop as completed_no_items');
assert.equal(emitStep.flow_step_settings.params.packets.length, 6, 'fixture emits grouped findings for fanout');
assert.equal(emitStep.flow_step_settings.params.packets[0].type, 'ssi_finding_group', 'grouped packets use ssi_finding_group type');
assert.ok(emitStep.flow_step_settings.params.packets[0].metadata._engine_data.finding_packet, 'group seeds representative finding_packet into child engine data');
assert.ok(emitStep.flow_step_settings.params.packets[0].metadata._engine_data.finding_group, 'group seeds full finding_group into child engine data');
assert.ok(
	emitStep.flow_step_settings.params.packets.every((packet) => !['ignored_region', 'import_clean'].includes(packet.metadata.kind)),
	'non-actionable packets are filtered before Data Machine fanout',
);

const visualPacket = emitStep.flow_step_settings.params.packets.find((packet) => packet.metadata.kind === 'visual_parity_mismatch');
assert.ok(visualPacket, 'fixture emits a visual parity mismatch packet');
assert.ok(visualPacket.data.visual_artifact, 'visual packet includes downloaded visual artifact context');
assert.equal(visualPacket.data.visual_artifact.files.length, 6, 'visual packet lists downloaded visual artifact files');
assert.equal(visualPacket.data.visual_artifact.visual_diff.dimension_mismatch, true, 'visual packet includes visual-diff summary');
assert.equal(visualPacket.data.visual_artifact.visual_diff.regions[0].source_matches[0].selector, 'section.hero', 'visual packet includes source selector probe evidence');
assert.match(visualPacket.data.body, /Visual parity artifact context:/, 'visual packet body names visual artifact context');
assert.match(visualPacket.data.body, /source screenshot:/, 'visual packet body includes screenshot paths');
assert.match(visualPacket.data.body, /region 1: x=0, y=640, w=1280, h=320/, 'visual packet body includes top visual region');
assert.deepEqual(visualPacket.metadata._engine_data.visual_artifact, visualPacket.data.visual_artifact, 'visual artifact context is mirrored into engine data');

const issueOnlyPacket = emitStep.flow_step_settings.params.packets.find((packet) => packet.metadata.kind === 'freeform_block' && packet.data.finding_packet.repair_mode === 'issue_only');
assert.ok(issueOnlyPacket, 'aggregate freeform packet remains available for issue fallback');
assert.match(issueOnlyPacket.data.body, /Repair mode: issue_only/, 'issue-only packet body blocks speculative PRs');

assert.equal(aiStep.type, 'ai', 'second step is iterator AI');
assert.ok(aiStep.system_prompt.includes('PHP Transformer Iterator Agent'), 'iterator system prompt is preserved');
assert.ok(aiStep.user_message.includes('Run the PR-first iterator'), 'iterator flow prompt is preserved');
assert.ok(aiStep.completion_assertions.required_tool_names.includes('comment_github_pull_request'), 'completion assertions are preserved');
assert.ok(aiStep.tool_runtime_rules.some((rule) => rule.id === 'iterator-inspection-budget'), 'tool runtime rules are preserved');

console.log('build-datamachine-iterator-workflow smoke passed');
