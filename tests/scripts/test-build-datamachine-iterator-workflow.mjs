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
						source_matches: [{ selector: 'section.hero', path: 'body > main > section.hero', text: 'Crown Alley Little Stage', child_summary: 'h1', rect: { x: 0, y: 600, width: 1280, height: 360 } }],
						imported_matches: [{ selector: 'main.wp-block-group', path: 'body > main.wp-block-group', text: 'Crown Alley Little Stage', child_summary: 'h1', rect: { x: 0, y: 620, width: 1280, height: 380 } }],
						layout_deltas: [
							{
								pair: 1,
								source_selector: 'section.hero',
								imported_selector: 'main.wp-block-group',
								source_path: 'body > main > section.hero',
								imported_path: 'body > main.wp-block-group',
								source_child_summary: 'h1',
								imported_child_summary: 'h1',
								rect_delta: { x: 0, y: 20, width: 0, height: 20 },
								style_diffs: [{ property: 'display', source: 'grid', imported: 'block' }],
							},
						],
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
assert.equal(payload.workflow.steps.length, 1, 'workflow embeds grouped findings in a single iterator AI step');

const [aiStep] = payload.workflow.steps;
assert.equal(aiStep.step_type, 'ai', 'only step is iterator AI');
assert.ok(aiStep.system_prompt.includes('PHP Transformer Iterator Agent'), 'iterator system prompt is preserved');
assert.ok(aiStep.user_message.includes('Run the PR-first iterator'), 'iterator flow prompt is preserved');
assert.match(aiStep.user_message, /DataPacket child-job hydration/, 'iterator prompt documents embedded finding context');
assert.match(aiStep.user_message, /"kind": "visual_parity_mismatch"/, 'visual finding is embedded in the AI prompt');
assert.match(aiStep.user_message, /"candidate_repo": "chubes4\/block-artifact-compiler"/, 'artifact compiler route is embedded in the AI prompt');
assert.match(aiStep.user_message, /"repair_mode": "issue_only"/, 'issue-only routing is embedded in the AI prompt');
assert.match(aiStep.user_message, /"source_screenshot_path": "/, 'visual artifact paths are embedded in the AI prompt');
assert.match(aiStep.user_message, /"selector": "section\.hero"/, 'visual source selector evidence is embedded in the AI prompt');
const outcomeAssertions = aiStep.completion_assertions.complete_when_any;
assert.ok(outcomeAssertions.some((outcome) => outcome.name === 'pull_request_path'), 'PR completion outcome is preserved');
assert.deepEqual(aiStep.completion_assertions.required_tool_names, ['comment_github_pull_request'], 'source callback remains a direct required tool');
assert.match(aiStep.system_prompt, /immediately comment back on the source generated-site PR/, 'prompt requires callback immediately after upstream action');
for (const outcome of outcomeAssertions) {
	assert.ok(
		outcome.tools.some((tool) => tool.name === 'comment_github_pull_request'),
		`${outcome.name} requires a source callback comment`,
	);
}
assert.ok(aiStep.tool_runtime_rules.some((rule) => rule.id === 'iterator-inspection-budget'), 'tool runtime rules are preserved');

console.log('build-datamachine-iterator-workflow smoke passed');
