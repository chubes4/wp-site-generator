import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeJson(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeVisualParityArtifact(dir, overrides = {}) {
	await mkdir(dir, { recursive: true });
	await Promise.all([
		writeFile(path.join(dir, 'source.png'), ''),
		writeFile(path.join(dir, 'imported.png'), ''),
		writeFile(path.join(dir, 'diff.png'), ''),
		writeJson(path.join(dir, 'summary.json'), overrides.summary || {}),
		writeFile(path.join(dir, 'comparison.html'), '<!doctype html>\n'),
		writeJson(path.join(dir, 'visual-diff.json'), visualDiffFixture(overrides.visualDiff || {})),
	]);
}

export function visualDiffFixture(overrides = {}) {
	return {
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
		...overrides,
	};
}

export function assertVisualArtifactContract(artifact, expectedDir) {
	if ('present' in artifact) {
		assert.equal(artifact.present, true, 'visual artifact directory is present');
	}
	assert.equal(artifact.directory, expectedDir, 'visual artifact records repo-relative directory');
	assert.deepEqual(artifact.files, ['source.png', 'imported.png', 'diff.png', 'visual-diff.json', 'summary.json', 'comparison.html'], 'visual artifact records stable file set');
	assert.equal(artifact.source_screenshot_path, `${expectedDir}/source.png`, 'visual artifact records source screenshot');
	assert.equal(artifact.imported_screenshot_path, `${expectedDir}/imported.png`, 'visual artifact records imported screenshot');
	assert.equal(artifact.diff_screenshot_path, `${expectedDir}/diff.png`, 'visual artifact records diff screenshot');
	assert.equal(artifact.visual_diff_path, `${expectedDir}/visual-diff.json`, 'visual artifact records visual diff JSON');
	assert.equal(artifact.summary_path, `${expectedDir}/summary.json`, 'visual artifact records summary JSON');
	assert.equal(artifact.comparison_html_path, `${expectedDir}/comparison.html`, 'visual artifact records comparison HTML');
	assert.equal(artifact.visual_diff.pass, false, 'visual artifact records failing visual diff status');
	assert.equal(artifact.visual_diff.dimension_mismatch, true, 'visual artifact records dimension mismatch');
	assert.equal(artifact.visual_diff.regions[0].source_matches[0].selector, 'section.hero', 'visual artifact records selector evidence');
}

export function assertIteratorPlanUsesReusableWorkflowRunner(plan, workflowPath) {
	const input = plan.tasks?.[0]?.executor?.config?.runtime_task?.input || {};
	assert.equal(input.execute_workflow_path, workflowPath, 'iterator consumes the prebuilt Data Machine workflow path');
	assert.equal(input.source, '/workspace/wp-site-generator/bundles/php-transformer-iterator-agent', 'iterator runs the sandbox-local agent bundle');
	assert.deepEqual(input.success_completion_outcomes, ['pull_request_path', 'issue_path'], 'iterator accepts PR or issue completion outcomes');
	assert.deepEqual(input.tool_recorders, [{ tool: 'create_github_issue' }, { tool: 'create_github_pull_request' }], 'iterator records durable upstream actions');
	assert.deepEqual(input.extra_required_abilities, [
		'datamachine-code/create-github-issue',
		'datamachine-code/create-github-pull-request',
		'datamachine-code/upsert-github-pull-review-comment',
	], 'iterator declares the required GitHub callback abilities');
}
