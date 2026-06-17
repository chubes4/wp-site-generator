import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertVisualArtifactContract, writeVisualParityArtifact } from '../helpers/artifact-contracts.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-dm-workflow-'));
const outputPath = path.join(tempDir, 'workflow.json');
const groupedPath = path.join(tempDir, 'groups.json');
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

console.log('build-datamachine-iterator-workflow smoke passed');
