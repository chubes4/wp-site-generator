import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertVisualArtifactContract, writeVisualParityArtifact } from '../helpers/artifact-contracts.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-agent-workflow-'));
const outputPath = path.join(tempDir, 'workflow.json');
const continuationPath = path.join(tempDir, 'continuation.json');
const truncatedOutputPath = path.join(tempDir, 'workflow-truncated.json');
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
assert.equal(fanoutConfig.schema, 'homeboy/generic-fanout-reconcile-config/v1', 'iterator emits HBE generic fanout config');
assert.equal(fanoutConfig.groups.length, 8, 'iterator passes WPSG-owned grouped findings as caller-provided HBE groups');
assert.equal(fanoutConfig.groups[0].items.length, 1, 'each HBE fanout group wraps one WPSG finding group');
assert.equal(fanoutConfig.task_request_template.finding_group, '{{group.items.0}}', 'task template preserves the typed WPSG finding group');

await writeFile(fanoutPlanPath, `${JSON.stringify({
	schema: 'homeboy/fanout-reconcile-plan/v1',
	task_requests: fanoutConfig.groups.map((group) => ({
		id: `php-transformer-iterator-${group.key}`,
		group_key: group.key,
		finding_group: group.items[0],
		inputs: { finding_group: group.items[0] },
	})),
}, null, 2)}\n`);

const result = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/build-agent-iterator-workflow.mjs'),
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
assert.match(iteratorPrompt, /"candidate_repo": "chubes4\/block-artifact-compiler"/, 'artifact compiler route is embedded in the AI prompt');
assert.match(iteratorPrompt, /"repair_mode": "issue_only"/, 'issue-only routing is embedded in the AI prompt');
assert.match(iteratorPrompt, /Use issue_path for repair_mode=issue_only/, 'issue-only groups use issue completion unless patch evidence exists');
assert.match(iteratorPrompt, /"source_screenshot_path": "/, 'visual artifact paths are embedded in the AI prompt');
assert.match(iteratorPrompt, /"selector": "section\.hero"/, 'visual source selector evidence is embedded in the AI prompt');
const promptGroups = JSON.parse(iteratorPrompt.slice(iteratorPrompt.indexOf('[\n')));
const visualGroup = promptGroups.find((group) => group.visual_artifact);
assert.ok(visualGroup, 'iterator prompt includes visual artifact evidence for visual findings');
assertVisualArtifactContract(visualGroup.visual_artifact, path.relative(repoRoot, visualArtifactDir));
const outcomeAssertions = aiStep.completion_assertions.complete_when_any;
assert.ok(outcomeAssertions.some((outcome) => outcome.name === 'pull_request_path'), 'PR completion outcome is preserved');
assert.ok(outcomeAssertions.some((outcome) => outcome.name === 'issue_path'), 'issue completion outcome is available for weak-evidence groups');
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

const truncatedResult = spawnSync(
	process.execPath,
	[
		path.join(repoRoot, '.github/scripts/build-agent-iterator-workflow.mjs'),
		groupedPath,
		truncatedOutputPath,
	],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			ITERATOR_CONTINUATION_PATH: continuationPath,
			ITERATOR_MAX_PROMPT_GROUPS: '1',
			VISUAL_ARTIFACT_DIR: visualArtifactDir,
		},
		encoding: 'utf8',
	},
);
assert.equal(truncatedResult.status, 0, truncatedResult.stderr || truncatedResult.stdout);
const truncatedPayload = JSON.parse(await readFile(truncatedOutputPath, 'utf8'));
assert.equal(truncatedPayload.initial_data.finding_group_continuation.status, 'truncated', 'workflow records prompt truncation explicitly');
assert.equal(truncatedPayload.initial_data.finding_group_continuation.embedded_group_count, 1, 'workflow records embedded group count');
assert.ok(truncatedPayload.initial_data.finding_group_continuation.omitted_group_count > 0, 'workflow records omitted group count');
assert.equal(
	truncatedPayload.initial_data.finding_group_continuation.artifact_path,
	path.relative(repoRoot, continuationPath),
	'workflow points to continuation artifact',
);
const truncatedPrompt = truncatedPayload.workflow.steps[0].prompt_queue[0].prompt;
assert.ok(
	truncatedPrompt.includes(truncatedPayload.initial_data.finding_group_continuation.artifact_path),
	'iterator prompt names the continuation artifact for omitted groups',
);
const continuation = JSON.parse(await readFile(continuationPath, 'utf8'));
assert.equal(continuation.status, 'truncated', 'continuation artifact records truncation');
assert.equal(continuation.embedded_group_count, 1, 'continuation artifact records prompt-visible groups');
assert.equal(continuation.groups.length, continuation.omitted_group_count, 'continuation artifact contains omitted groups');
assert.equal(continuation.runtime_packets.length, continuation.omitted_group_count, 'continuation artifact contains hydratable runtime packets');
assert.ok(
	continuation.runtime_packets.every((packet) => packet.type === 'ssi_finding_group'),
	'continuation artifact preserves grouped finding packet type',
);

console.log('build-agent-iterator-workflow smoke passed');
