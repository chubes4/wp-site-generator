import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createHomeboyControllerFixture } from '../helpers/homeboy-fixtures.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-headless-loop-test-'));
const homeboyFixturePath = await createHomeboyControllerFixture(tempDir);
const evidencePath = path.join(tempDir, 'headless-evidence.json');
const artifactRoot = path.join(tempDir, 'homeboy-agent-task-artifacts');

async function writeArtifact(name, artifact) {
	await mkdir(artifactRoot, { recursive: true });
	await writeFile(path.join(artifactRoot, `${name}.json`), JSON.stringify({ artifact_id: name, ...artifact }, null, 2) + '\n');
}

async function writeRealEvidenceArtifacts() {
	await writeArtifact('static_site_candidate', {
		schema: 'wp-site-generator/StaticSiteCandidate/v1',
		runtime_preview: {
			url: 'https://playground.wordpress.net/?blueprint-url=https%3A%2F%2Fraw.githubusercontent.com%2Fchubes4%2Fwp-site-generator%2Fproof%2Fblueprint.json',
			provider: 'wp-codebox',
			runtime: 'wordpress-playground',
		},
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/static-site-candidate',
	});
	await writeArtifact('import_validation_result', {
		schema: 'wp-site-generator/ImportValidationResult/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/import-validation',
		metrics: { fallback_blocks: 0, conversion_findings: 0 },
		import_report: { pages_imported: 1 },
	});
	await writeArtifact('static_validation_run', {
		schema: 'homeboy/Run/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/static-validation-run',
	});
	await writeArtifact('visual_parity_artifact', {
		schema: 'wp-site-generator/VisualParityArtifact/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/visual-parity',
		summary: { status: 'pass', mismatch_count: 0, max_delta_ratio: 0 },
	});
	await writeArtifact('finding_packet_set', {
		schema: 'wp-site-generator/FindingPacketSet/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/finding-packets',
		packets: [],
		actionable_conversion_count: 0,
	});
	await writeArtifact('finding_group', {
		schema: 'wp-site-generator/FindingGroup/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/finding-group',
	});
	await writeArtifact('iterator_upstream_issue', {
		schema: 'github/Issue/v1',
		url: 'https://github.com/chubes4/wp-site-generator/issues/123',
	});
	await writeArtifact('iterator_upstream_pull_request', {
		schema: 'github/PullRequest/v1',
		url: 'https://github.com/chubes4/wp-site-generator/pull/124',
	});
	await writeArtifact('revalidation_attempt', {
		schema: 'wp-site-generator/RevalidationAttempt/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/revalidation',
		status: 'passed',
	});
	await writeArtifact('reviewer_gate_outcome', {
		schema: 'wp-site-generator/SsiStackReviewerGate/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/reviewer-gate',
		decision: 'PASS',
	});
	await writeArtifact('static_site_publish_gate', {
		schema: 'wp-site-generator/StaticSitePublishGate/v1',
		artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/publish-gate',
		publish_allowed: true,
		gates: {
			fallback_blocks: { passed: true },
			conversion_findings: { passed: true },
			visual_parity: { passed: true },
		},
	});
	await writeArtifact('static_site_pull_request', {
		schema: 'github/PullRequest/v1',
		url: 'https://github.com/chubes4/wp-site-generator/pull/125',
	});
}

try {
	const fixtureResult = spawnSync(process.execPath, [
		'.github/scripts/validate-headless-site-generation-loop.mjs',
		'--homeboy-bin',
		homeboyFixturePath,
		'--work-dir',
		tempDir,
		'--fixture-artifacts',
	], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.notEqual(fixtureResult.status, 0, 'headless validation refuses generated fixture artifacts by default');
	assert.match(fixtureResult.stderr || fixtureResult.stdout, /--fixture-artifacts is disabled/);

	await writeRealEvidenceArtifacts();
	const result = spawnSync(process.execPath, [
		'.github/scripts/validate-headless-site-generation-loop.mjs',
		'--homeboy-bin',
		homeboyFixturePath,
		'--work-dir',
		tempDir,
		'--evidence',
		evidencePath,
		'--run-id',
		'headless-test',
		'--randomness-seed',
		'headless-seed',
		'--runtime-id',
		'contract-runtime',
		'--artifact-root',
		artifactRoot,
	], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /Headless site generation loop contract passed/);

	const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	assert.equal(evidence.schema, 'wp-site-generator/headless-site-generation-loop-validation/v1');
	assert.equal(evidence.valid, true);
	assert.equal(evidence.runtime_input_contract, 'homeboy-agent-runtime-env');
	assert.equal(evidence.runtime_id, 'contract-runtime');
	assert.equal(evidence.fixture_artifacts, false);
	assert.equal(evidence.artifact_source, 'homeboy-emitted');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller materialize')), 'evidence records Homeboy materialize command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller from-spec')), 'evidence records Homeboy from-spec command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller resume')), 'evidence records Homeboy resume command');
	assert.ok(evidence.commands.some((item) => item.command.includes('agent-task controller events')), 'evidence records Homeboy event command');
	assert.ok(evidence.commands.every((item) => !item.command.includes('gh workflow run')), 'headless path does not rely on GitHub workflow dispatch');
	assert.ok(evidence.upstream_dependencies.includes('https://github.com/Extra-Chill/homeboy-extensions/pull/1645'), 'evidence records the headless runner upstream dependency');

	const controllerRunSpec = JSON.parse(await readFile(evidence.paths.controller_run_spec, 'utf8'));
	assert.equal(controllerRunSpec.runtime, undefined, 'materialized controller spec does not embed a runtime backend');
	assert.equal(controllerRunSpec.backend, undefined, 'materialized controller spec does not embed a backend selector');
	assert.equal(controllerRunSpec.provider, undefined, 'materialized controller spec does not embed a provider selector');
	assert.ok(controllerRunSpec.workflows.every((workflow) => workflow.inputs?.runtime_input_contract === 'homeboy-agent-runtime-env'), 'all workflows carry the generic runtime env contract');

	console.log('headless site generation loop validation tests passed');
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
