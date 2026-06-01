import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wp-site-generator-static-iterator-replay-'));
const site = 'issue-355-hearthline-board-cafe';
const benchPath = path.join(tempDir, 'homeboy-ci-results/bench.json');
const packetsPath = path.join(tempDir, 'homeboy-ci-results/finding-packets.json');
const groupsPath = path.join(tempDir, 'homeboy-ci-results/grouped-finding-packets.json');
const workflowPath = path.join(tempDir, 'datamachine-iterator-workflow.json');
const visualDir = path.join(tempDir, 'visual-parity-artifacts', site);

await mkdir(path.dirname(benchPath), { recursive: true });
await mkdir(visualDir, { recursive: true });

await writeJson(benchPath, {
	success: false,
	data: {
		payload: {
			component: 'wp-site-generator',
			exit_code: 1,
			failure: { exit_code: 1, stderr_tail: 'WordPress Playground CLI failed after import readiness was captured.' },
			status: 'failed',
		},
	},
});

await writeJson(path.join(visualDir, 'summary.json'), {
	site,
	importReadiness: {
		import_result: {
			report_path: `/wordpress/wp-content/themes/${site}/import-report.json`,
			import_report_summary: {
				status: 'completed',
				entry_file: `/wordpress/wp-content/plugins/wp-site-generator/static-sites/${site}/index.html`,
				quality_pass: false,
				fail_import: false,
				failure_reasons: ['unsupported_html_fallback', 'core_html_block'],
				fallback_count: 2,
				core_html_block_count: 1,
				freeform_block_count: 0,
				invalid_block_count: 0,
				content_loss_count: 0,
				diagnostic_count: 4,
			},
			quality: {
				fallback_count: 2,
				core_html_block_count: 1,
				freeform_block_count: 0,
				invalid_block_count: 0,
				diagnostic_refs: {
					fallback_count: [
						'diag-002-unsupported_html_fallback-no_transform-indexhtml',
						'diag-003-unsupported_html_fallback-no_transform-indexhtml',
					],
					core_html_block_count: ['diag-004-core_html_block-generated_document_contains_core_html-patternspage-homephp'],
				},
			},
		},
	},
});

await writeJson(path.join(visualDir, 'visual-diff.json'), {
	pass: false,
	threshold: 0.015,
	mismatchPixels: 2050795,
	totalPixels: 8392960,
	mismatchRatio: 0.24434704800213514,
	dimensionMismatch: true,
	source: { path: 'source.png', width: 1280, height: 6557 },
	imported: { path: 'imported.png', width: 1280, height: 6092 },
	regions: [
		{
			rank: 1,
			x: 0,
			y: 2016,
			width: 1280,
			height: 4541,
			mismatchPixels: 2474494,
			totalPixels: 5812480,
			mismatchRatio: 0.4257208626954415,
			source_matches: [{ selector: 'main#main', text: 'Hearthline Board Cafe', html: '<main id="main"><section class="hero"></section></main>' }],
			imported_matches: [{ selector: 'main#wp--skip-link--target', text: 'Hearthline Board Cafe', html: '<main class="wp-block-post-content"></main>' }],
		},
	],
});

const packetResult = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-ssi-finding-packets.mjs')], {
	cwd: repoRoot,
	env: {
		...process.env,
		SITE: site,
		SOURCE_REPO: 'chubes4/wp-site-generator',
		SOURCE_PR: '357',
		SOURCE_HEAD_SHA: '45b0f6c',
		SOURCE_BRANCH: `static/${site}`,
		VALIDATION_RUN_ID: '26727866077',
		BENCH_PATH: benchPath,
		FINDING_PACKETS_PATH: packetsPath,
		DESIGN_DISTRIBUTION_PATH: path.join(tempDir, 'homeboy-ci-results/design-distribution.json'),
		VISUAL_DIFF_PATH: path.join(visualDir, 'visual-diff.json'),
		VISUAL_SUMMARY_PATH: path.join(visualDir, 'summary.json'),
		IMPORT_READY_PATH: path.join(visualDir, 'import-ready.json'),
	},
	encoding: 'utf8',
});
assert.equal(packetResult.status, 0, packetResult.stderr || packetResult.stdout);

const packets = JSON.parse(await readFile(packetsPath, 'utf8'));
assert.ok(packets.some((packet) => packet.kind === 'bench_failure'), 'bench harness failure is retained for routing');
assert.ok(!packets.some((packet) => packet.kind === 'report_missing'), 'recovered import readiness suppresses false report_missing noise');
assert.ok(packets.some((packet) => packet.kind === 'unsupported_html_fallback'), 'fallback count becomes an H2BC-routed quality packet');
assert.ok(packets.some((packet) => packet.kind === 'core_html_block'), 'core/html count becomes an H2BC-routed quality packet');
assert.ok(packets.some((packet) => packet.kind === 'visual_parity_mismatch'), 'visual mismatch remains available for WPSG routing');
assert.ok(
	packets.filter((packet) => ['unsupported_html_fallback', 'core_html_block'].includes(packet.kind)).every((packet) => packet.candidate_repo === 'chubes4/html-to-blocks-converter' && packet.repair_mode === 'issue_only'),
	'aggregate quality packets route to H2BC as issue-only follow-up evidence',
);

const groupResult = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/group-ssi-finding-packets.mjs'), packetsPath], {
	cwd: repoRoot,
	env: { ...process.env, FINDING_GROUPS_PATH: groupsPath },
	encoding: 'utf8',
});
assert.equal(groupResult.status, 0, groupResult.stderr || groupResult.stdout);

const workflowResult = spawnSync(process.execPath, [path.join(repoRoot, '.github/scripts/build-datamachine-iterator-workflow.mjs'), groupsPath, workflowPath], {
	cwd: repoRoot,
	env: { ...process.env, VISUAL_ARTIFACT_DIR: visualDir },
	encoding: 'utf8',
});
assert.equal(workflowResult.status, 0, workflowResult.stderr || workflowResult.stdout);

const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
const iteratorPrompt = workflow.workflow.steps[0].prompt_queue[0].prompt;
assert.match(iteratorPrompt, /"candidate_repo": "chubes4\/html-to-blocks-converter"/, 'workflow embeds H2BC follow-up route');
assert.match(iteratorPrompt, /"candidate_repo": "chubes4\/wp-site-generator"/, 'workflow embeds WPSG harness/visual route');
assert.doesNotMatch(iteratorPrompt, /"kind": "report_missing"/, 'workflow no longer asks iterator to chase missing-report noise');

console.log('static validation iterator replay passed');

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
