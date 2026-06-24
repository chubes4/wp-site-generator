import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertVisualArtifactContract, writeVisualParityArtifact } from '../helpers/artifact-contracts.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-agent-workflow-'));
const outputPath = path.join(tempDir, 'workflow.json');
const multiGroupOutputPath = path.join(tempDir, 'workflow-multi-group.json');
const groupedPath = path.join(tempDir, 'groups.json');
const fanoutConfigPath = path.join(tempDir, 'fanout-config.json');
const fanoutPlanPath = path.join(tempDir, 'fanout-plan.json');
const visualArtifactDir = path.join(tempDir, 'visual-parity');

await writeVisualParityArtifact(visualArtifactDir);

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

const configResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/build-php-transformer-iterator-fanout-config.mjs'),
		groupedPath,
		fanoutConfigPath,
	],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			SOURCE_REPO: 'chubes4/wp-site-generator',
			SOURCE_PR: '77',
			VALIDATION_RUN_ID: '12345',
			ARTIFACT_NAME: 'ssi-validation-demo-store',
			VISUAL_ARTIFACT_NAME: 'visual-parity-demo-store',
		},
		encoding: 'utf8',
	},
);

assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);
const fanoutConfig = JSON.parse(await readFile(fanoutConfigPath, 'utf8'));
assert.equal(fanoutConfig.schema, 'wp-site-generator/php-transformer-iterator-fanout-input/v1', 'iterator emits Homeboy-compatible fanout packet input');
assert.deepEqual(fanoutConfig.primitive, {
	provider: 'homeboy',
	command: 'agent-task fanout submit-batch',
	input_contract: 'homeboy/agent-task-fanout-input/v1',
	status_command: 'agent-task fanout status',
	artifacts_command: 'agent-task fanout artifacts',
	controller_workflow: 'iterator',
}, 'iterator fanout config declares the Homeboy batch primitive contract');
assert.equal(fanoutConfig.packets.length, 8, 'iterator passes WPSG-owned grouped findings as caller-provided Homeboy packets');
assert.ok(fanoutConfig.packets.every((packet) => packet.schema === 'wp-site-generator/finding-group-loop-request/v1'), 'each fanout packet uses the generated WPSG finding-group loop request contract');
assert.equal(fanoutConfig.packets[0].inputs.finding_group.count, 1, 'each Homeboy packet preserves one WPSG finding group');
assert.equal(fanoutConfig.packets[0].metadata.finding_group.group_id, fanoutConfig.packets[0].inputs.finding_group.group_id, 'packet metadata preserves the typed WPSG finding group');
assert.ok(fanoutConfig.packets.every((packet) => Array.isArray(packet.metadata.accepted_outcomes)), 'each fanout packet carries accepted outcomes');
const visualRequest = fanoutConfig.packets.find((packet) => packet.inputs.finding_group.kind === 'visual_parity_mismatch');
assert.ok(visualRequest, 'fixture contains a visual issue-only request');
assert.equal(visualRequest.metadata.repair_mode, 'issue_only');
assert.deepEqual(visualRequest.metadata.accepted_outcomes, ['issue_path'], 'issue-only requests accept the issue outcome only');

await writeFile(fanoutPlanPath, `${JSON.stringify({
	schema: 'homeboy/agent-task-plan/v1',
	tasks: [visualRequest].map((packet) => ({
		task_id: packet.task_id,
		group_key: packet.group_key,
		inputs: packet.inputs,
		metadata: packet.metadata,
	})),
}, null, 2)}\n`);

const result = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, 'bundles/php-transformer-iterator-agent/scripts/build-agent-iterator-workflow.mjs'),
		fanoutPlanPath,
		outputPath,
	],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			VISUAL_ARTIFACT_DIR: visualArtifactDir,
		},
		encoding: 'utf8',
	},
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const payload = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(payload.workflow.steps.length, 1, 'workflow embeds grouped findings in a single iterator AI step');
assert.equal(payload.initial_data.finding_group.kind, 'visual_parity_mismatch', 'workflow initial_data carries exactly one finding_group');
assert.equal(payload.initial_data.repair_mode, 'issue_only', 'workflow initial_data carries structured repair_mode');
assert.deepEqual(payload.initial_data.accepted_outcomes, ['issue_path'], 'workflow initial_data constrains accepted outcomes');

const [aiStep] = payload.workflow.steps;
assert.equal(aiStep.step_type, 'ai', 'only step is iterator AI');
assert.ok(aiStep.system_prompt.includes('PHP Transformer Iterator Agent'), 'iterator system prompt is preserved');
assert.equal(aiStep.queue_mode, 'static', 'iterator AI prompt queue is static');
assert.equal(aiStep.prompt_queue.length, 1, 'iterator AI prompt queue has one embedded finding prompt');
const iteratorPrompt = aiStep.prompt_queue[0].prompt;
assert.ok(iteratorPrompt.includes('Run the PR-first iterator'), 'iterator flow prompt is preserved');
assert.ok(iteratorPrompt.length < 30000, 'iterator prompt stays bounded for reliable agent runs');
assert.match(iteratorPrompt, /DataPacket child-job hydration/, 'iterator prompt documents embedded finding context');
assert.match(iteratorPrompt, /"kind": "visual_parity_mismatch"/, 'visual finding is embedded in the AI prompt');
assert.match(iteratorPrompt, /"candidate_repo": "chubes4\/wp-site-generator"/, 'WPSG visual route is embedded in the AI prompt');
assert.match(iteratorPrompt, /"repair_mode": "issue_only"/, 'issue-only routing is embedded in the AI prompt');
assert.match(iteratorPrompt, /accepted_outcomes contract/, 'iterator prompt delegates outcome choice to the structured contract');
assert.match(iteratorPrompt, /"source_screenshot_path": "/, 'visual artifact paths are embedded in the AI prompt');
assert.match(iteratorPrompt, /"selector": "section\.hero"/, 'visual source selector evidence is embedded in the AI prompt');
const visualGroup = JSON.parse(iteratorPrompt.slice(iteratorPrompt.indexOf('{\n')));
assert.ok(visualGroup, 'iterator prompt includes visual artifact evidence for visual findings');
assertVisualArtifactContract(visualGroup.visual_artifact, path.relative(repoRoot, visualArtifactDir));
const outcomeAssertions = aiStep.completion_assertions.complete_when_any;
assert.deepEqual(outcomeAssertions.map((outcome) => outcome.name), ['issue_path'], 'issue-only workflow exposes only the structured accepted outcome');
assert.deepEqual(aiStep.completion_assertions.required_tool_names, ['comment_github_pull_request'], 'source callback remains a direct required tool');
assert.match(aiStep.system_prompt, /immediately comment back on the source generated-site PR/, 'prompt requires callback immediately after upstream action');
for (const outcome of outcomeAssertions) {
	assert.ok(
		outcome.tools.some((tool) => tool.name === 'comment_github_pull_request'),
		`${outcome.name} requires a source callback comment`,
	);
}
assert.ok(aiStep.tool_runtime_rules.some((rule) => rule.id === 'iterator-inspection-budget'), 'tool runtime rules are preserved');
assert.ok(aiStep.enabled_tools.includes('create_github_issue'), 'issue-only groups can create focused upstream issues');
assert.ok(
	aiStep.tool_runtime_rules.some(
		(rule) =>
			rule.id === 'iterator-issue-before-source-callback' &&
			rule.type === 'block_until_tool' &&
			rule.after_tool === 'create_github_issue' &&
			rule.blocked_tools.includes('create_github_issue') &&
			rule.until_one_of.includes('comment_github_pull_request'),
	),
	'issue fallback blocks duplicate issue creation until source callback',
);
assert.ok(!aiStep.enabled_tools.includes('list_github_issues'), 'issue-list tool is disabled to avoid fallback search loops');

const multiGroupResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, 'bundles/php-transformer-iterator-agent/scripts/build-agent-iterator-workflow.mjs'),
		groupedPath,
		multiGroupOutputPath,
	],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			VISUAL_ARTIFACT_DIR: visualArtifactDir,
		},
		encoding: 'utf8',
	},
);
assert.notEqual(multiGroupResult.status, 0, 'iterator builder rejects multi-group task inputs');
assert.match(multiGroupResult.stderr || multiGroupResult.stdout, /expects exactly one finding_group per task; received 8/);

console.log('build-agent-iterator-workflow smoke passed');
