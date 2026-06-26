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
assert.ok(spec.runtime_profiles['wpsg-agent-runtime-package'], 'default runtime profile is declared');
assert.equal(spec.runtime_id, undefined, 'WPSG spec does not select a runtime backend');
assert.equal(spec.provider, undefined, 'WPSG spec does not select an AI provider');
assert.doesNotMatch(JSON.stringify(spec), /wp-codebox|codebox|codex|AI_PROVIDER_OPENAI/i, 'WPSG workload spec stays runtime/provider neutral');
assert.equal(spec.controller_execution?.spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json', 'headless spec runs the existing WPSG controller spec');
assert.equal(spec.controller_execution?.inputs, '.ci/headless-production-validation/site-generation-loop.controller-run-inputs.json', 'headless spec declares generated controller inputs');
assert.equal(spec.controller_execution?.policy_result, '.ci/headless-production-validation/site-generation-loop.complexity-policy-result.json', 'headless spec declares generated policy evidence');
assert.equal(spec.controller_execution?.prepare?.[0]?.argv?.join(' '), 'node .github/scripts/build-homeboy-controller-run-inputs.mjs', 'headless spec builds controller inputs before execution');
assert.equal(spec.runtime_profiles['wpsg-agent-runtime-package'].runtime_bundle_ability, 'homeboy/run-runtime-package', 'runtime profile remains a neutral runtime ability profile, not a bundle source');
assert.equal(spec.controller_execution?.spec.includes('wpsg-agent-runtime-package'), false, 'runtime profile id is not used as a controller or bundle source');

const artifactNames = new Set(spec.artifact_declarations.map((artifact) => artifact.name));
for (const required of ['concept_packet', 'design_packet', 'static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'reviewer_gate_outcome']) {
	assert.ok(artifactNames.has(required), `${required} is required evidence`);
}
assert.ok(spec.required_evidence_refs.some((ref) => ref.kind === 'runtime_access'), 'runtime access evidence is required');

const workflow = await readFile(path.join(repoRoot, '.github/workflows/headless-production-validation.yml'), 'utf8');
assert.match(workflow, /default: wp-codebox/, 'workflow selects Codebox through dispatch defaults');
assert.match(workflow, /default: codex/, 'workflow selects Codex provider through dispatch defaults');
assert.match(workflow, /HOMEBOY_HEADLESS_LOOP_REVOLUTIONS/, 'workflow forwards N revolutions through the generic HBE contract');
assert.match(workflow, /HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGIN_PATHS/, 'workflow forwards provider plugin mounts through the generic runtime contract');
assert.match(workflow, /AI_PROVIDER_OPENAI_CODEX_REFRESH_TOKEN/, 'workflow declares Codex subscription secret env names without values');
assert.match(workflow, /HOMEBOY_AGENT_RUNTIME_SECRET_ENV: \$\{\{ inputs\.secret_env \}\}/, 'workflow forwards secret env names through dispatch input');
assert.doesNotMatch(workflow, /secret_env_values|credentials:/, 'workflow does not inline provider credential values');

console.log('Headless production validation contract tests passed');
