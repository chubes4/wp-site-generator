#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

async function readJson(relativePath) {
	return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

const spec = await readJson('.github/homeboy/headless-production-loop.json');
assert.equal(spec.schema, 'homeboy/headless-production-loop-spec/v1');
assert.equal(spec.runtime_profile, 'wpsg-agent-runtime-package');
assert.equal(spec.runtime_profiles, undefined, 'runtime profiles are rendered by the upstream Homeboy Extensions runtime boundary');
assert.equal(spec.runtime_id, undefined, 'WPSG spec does not select a runtime backend');
assert.equal(spec.provider, undefined, 'WPSG spec does not select an AI provider');
assert.doesNotMatch(JSON.stringify(spec), /wp-codebox|codebox|codex|AI_PROVIDER_OPENAI/i, 'WPSG workload spec stays runtime/provider neutral');
assert.equal(spec.loop_policy.max_iterations, 3, 'production loop spec supports the default N-revolution validation run');
assert.equal(spec.controller_loop_proof.max_iterations, 3, 'controller proof validates the N-revolution loop contract');
assert.equal(spec.controller_execution?.spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json', 'headless spec runs the existing WPSG controller spec');
assert.equal(spec.controller_execution?.inputs, '.ci/headless-production-validation/site-generation-loop.controller-run-inputs.json', 'headless spec declares generated controller inputs');
assert.equal(spec.controller_execution?.policy_result, '.ci/headless-production-validation/site-generation-loop.complexity-policy-result.json', 'headless spec declares generated policy evidence');
assert.equal(spec.controller_execution?.prepare?.[0]?.argv?.join(' '), 'node .github/scripts/build-homeboy-controller-run-inputs.mjs', 'headless spec builds controller inputs before execution');
assert.equal(spec.controller_execution?.spec.includes('wpsg-agent-runtime-package'), false, 'runtime profile id is not used as a controller or bundle source');

const artifactNames = new Set(spec.artifact_declarations.map((artifact) => artifact.name));
for (const required of ['concept_packet', 'design_packet', 'static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'static_site_publish_gate', 'reviewer_gate_outcome']) {
	assert.ok(artifactNames.has(required), `${required} is required evidence`);
}
assert.ok(spec.required_evidence_refs.some((ref) => ref.kind === 'runtime_access' && ref.name === 'runtime_access_url'), 'runtime access evidence is required with runtime-access terminology');
assert.doesNotMatch(JSON.stringify(spec), /playground_or_preview_url/, 'generic evidence names avoid Playground/preview terminology');

console.log('Headless production validation contract tests passed');
