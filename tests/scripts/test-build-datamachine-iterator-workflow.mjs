import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-dm-workflow-'));
const outputPath = path.join(tempDir, 'workflow.json');
const groupedPath = path.join(tempDir, 'groups.json');

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
	{ cwd: repoRoot, encoding: 'utf8' },
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
assert.equal(emitStep.flow_step_settings.params.packets.length, 4, 'fixture emits grouped findings for fanout');
assert.equal(emitStep.flow_step_settings.params.packets[0].type, 'ssi_finding_group', 'grouped packets use ssi_finding_group type');
assert.ok(emitStep.flow_step_settings.params.packets[0].metadata._engine_data.finding_packet, 'group seeds representative finding_packet into child engine data');
assert.ok(emitStep.flow_step_settings.params.packets[0].metadata._engine_data.finding_group, 'group seeds full finding_group into child engine data');
assert.ok(
	emitStep.flow_step_settings.params.packets.every((packet) => !['ignored_region', 'import_clean'].includes(packet.metadata.kind)),
	'non-actionable packets are filtered before Data Machine fanout',
);

assert.equal(aiStep.type, 'ai', 'second step is iterator AI');
assert.ok(aiStep.system_prompt.includes('PHP Transformer Iterator Agent'), 'iterator system prompt is preserved');
assert.ok(aiStep.user_message.includes('Run the PR-first iterator'), 'iterator flow prompt is preserved');
assert.ok(aiStep.completion_assertions.required_tool_names.includes('comment_github_pull_request'), 'completion assertions are preserved');
assert.ok(aiStep.tool_runtime_rules.some((rule) => rule.id === 'iterator-inspection-budget'), 'tool runtime rules are preserved');

console.log('build-datamachine-iterator-workflow smoke passed');
