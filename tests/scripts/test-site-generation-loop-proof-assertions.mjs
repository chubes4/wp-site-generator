import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHomeboyControllerContractFixture } from '../helpers/homeboy-fixtures.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-proof-'));
const controllerRunSpecPath = path.join(tempDir, 'site-generation-loop.controller-run-spec.json');
const controllerResultPath = path.join(tempDir, 'site-generation-loop.controller-run-from-spec.json');
const controllerRunInputsPath = path.join(tempDir, 'site-generation-loop.controller-run-inputs.json');
const controllerPolicyResultPath = path.join(tempDir, 'site-generation-loop.complexity-policy-result.json');
const controllerMaterializationPath = path.join(tempDir, 'site-generation-loop.controller-materialization.json');
const controllerMaterializationProofPath = path.join(tempDir, 'site-generation-loop.controller-materialization.proof.json');
const artifactRoot = path.join(tempDir, 'homeboy-agent-task-artifacts');
const homeboyFixturePath = await createHomeboyControllerContractFixture(tempDir);

async function writeArtifact(name, artifact) {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, `${name}.json`), JSON.stringify({ artifact_id: name, ...artifact }, null, 2) + '\n');
}

try {
  const inputsResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-controller-run-inputs.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOMEBOY_BIN: homeboyFixturePath,
      HOMEBOY_CONTROLLER_RUN_INPUTS_PATH: controllerRunInputsPath,
      HOMEBOY_POLICY_RESULT_PATH: controllerPolicyResultPath,
      WPSG_REPLAY_ID: 'proof-replay',
      WPSG_RANDOMNESS_SEED: 'proof-seed',
    },
    encoding: 'utf8',
  });
  assert.equal(inputsResult.status, 0, inputsResult.stderr || inputsResult.stdout);

  const materializeResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'materialize', '@.github/homeboy/controllers/static-site-generation-loop.controller.json', '--inputs', `@${controllerRunInputsPath}`, '--policy-result', `@${controllerPolicyResultPath}`, '--output', controllerMaterializationPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(materializeResult.status, 0, materializeResult.stderr || materializeResult.stdout);
  const materialization = JSON.parse(await readFile(controllerMaterializationPath, 'utf8'));
  await writeFile(controllerMaterializationProofPath, JSON.stringify(materialization.data || materialization.value || materialization, null, 2) + '\n');

  const writeRunSpecResult = spawnSync(process.execPath, ['.github/scripts/write-materialized-controller-run-spec.mjs', controllerMaterializationPath, controllerRunSpecPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(writeRunSpecResult.status, 0, writeRunSpecResult.stderr || writeRunSpecResult.stdout);

  const validateProofResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'validate-proof', `@${controllerMaterializationProofPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(validateProofResult.status, 0, validateProofResult.stderr || validateProofResult.stdout);
  assert.equal(JSON.parse(validateProofResult.stdout).valid, true, 'Homeboy generic proof validation accepts unwrapped materialized controller output');

  const controllerRunSpec = JSON.parse(await readFile(controllerRunSpecPath, 'utf8'));
  assert.equal(controllerRunSpec.metadata.authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs');
  assert.equal(controllerRunSpec.metadata.run.generated_by, '.github/scripts/build-homeboy-controller-run-inputs.mjs');
  assert.equal(controllerRunSpec.metadata.run.materialized_by, 'homeboy agent-task controller from-spec');
  assert.ok(controllerRunSpec.workflows.every((workflow) => workflow.inputs?.policy_results?.['wpsg-complexity-policy']), 'materialized workflows include WPSG complexity policy results');

  const fromSpecResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'from-spec', '@.github/homeboy/controllers/static-site-generation-loop.controller.json', '--resume', '--inputs', `@${controllerRunInputsPath}`, '--policy-result', `@${controllerPolicyResultPath}`, '--max-actions', '100'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(fromSpecResult.status, 0, fromSpecResult.stderr || fromSpecResult.stdout);
  await writeFile(controllerResultPath, fromSpecResult.stdout);
  const controllerResult = JSON.parse(await readFile(controllerResultPath, 'utf8'));
  assert.equal(controllerResult.schema, 'homeboy/agent-task-loop-controller-run-from-spec-result/v1');
  assert.equal(controllerResult.loop_id, 'wp-site-generator_static-site-generation-loop_proof-replay');

  const missingArtifactProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.notEqual(missingArtifactProof.status, 0, 'controller proof fails without real artifacts');
  assert.match(missingArtifactProof.stderr || missingArtifactProof.stdout, /artifact root is missing Homeboy-emitted static_site_candidate/);
  assert.match(missingArtifactProof.stderr || missingArtifactProof.stdout, /dependency: https:\/\/github.com\/Extra-Chill\/homeboy-extensions\/pull\/1645/);

  const placeholderControllerResultPath = path.join(tempDir, 'site-generation-loop.controller-placeholder-result.json');
  await writeFile(placeholderControllerResultPath, JSON.stringify({
    success: true,
    data: {
      loop_id: controllerResult.loop_id,
      results: [
        {
          action_id: 'action-1',
          status: 'completed',
          execution: {
            result: {
              aggregate: {
                outcomes: [
                  {
                    outputs: {
                      typed_artifacts: {
                        concept_packet: {
                          schema: 'homeboy/agent-task-typed-artifact/v1',
                          artifact_id: 'concept_packet',
                          payload: {
                            content: `<workspace_ls path="${repoRoot}" />`,
                            format: 'markdown',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  }, null, 2) + '\n');
  const placeholderProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      placeholderControllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.notEqual(placeholderProof.status, 0, 'controller proof fails when typed artifacts contain tool-call placeholders');
  assert.match(placeholderProof.stderr || placeholderProof.stdout, /concept_packet contains an unexecuted workspace tool-call placeholder/);

  await writeArtifact('tiny_fixture_site_run', {
    schema: 'homeboy/Run/v1',
    fixture: 'tiny',
    artifact_url: 'https://artifacts.example.test/tiny-fixture-site-run.json',
  });
  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    runtime_access: {
      schema: 'homeboy/runtime-preview-access/v1',
      url: 'https://preview.example.test/proof-site',
      access: { kind: 'preview' },
    },
    artifact_url: 'https://artifacts.example.test/static-site-candidate.json',
  });
  await writeArtifact('import_validation_result', {
    schema: 'wp-site-generator/ImportValidationResult/v1',
    artifact_url: 'https://artifacts.example.test/import-validation.json',
    metrics: { fallback_blocks: 0, conversion_findings: 0 },
    import_report: { pages_imported: 1 },
  });
  await writeArtifact('static_validation_run', {
    schema: 'homeboy/Run/v1',
    artifact_url: 'https://artifacts.example.test/static-validation-run.json',
  });
  await writeArtifact('visual_parity_artifact', {
    schema: 'wp-site-generator/VisualParityArtifact/v1',
    artifact_url: 'https://artifacts.example.test/visual-parity.json',
    summary: { status: 'pass', mismatch_count: 0, max_delta_ratio: 0 },
  });
  await writeArtifact('finding_packet_set', {
    schema: 'wp-site-generator/FindingPacketSet/v1',
    artifact_url: 'https://artifacts.example.test/finding-packets.json',
    packets: [],
    actionable_conversion_count: 0,
  });
  await writeArtifact('finding_group', {
    schema: 'wp-site-generator/FindingGroup/v1',
    artifact_url: 'https://artifacts.example.test/finding-group.json',
  });
  await writeArtifact('iterator_upstream_issue', {
    schema: 'github/Issue/v1',
    url: 'https://github.com/chubes4/wp-site-generator/issues/123',
  });
  await writeArtifact('revalidation_attempt', {
    schema: 'wp-site-generator/RevalidationAttempt/v1',
    artifact_url: 'https://artifacts.example.test/revalidation.json',
    status: 'passed',
  });
  await writeArtifact('reviewer_gate_outcome', {
    schema: 'wp-site-generator/SsiStackReviewerGate/v1',
    artifact_url: 'https://artifacts.example.test/reviewer-gate.json',
    decision: 'PASS',
  });
  await writeArtifact('static_site_publish_gate', {
    schema: 'wp-site-generator/StaticSitePublishGate/v1',
    artifact_url: 'https://artifacts.example.test/publish-gate.json',
    publish_allowed: true,
    gates: {
      fallback_blocks: { passed: true },
      conversion_findings: { passed: true },
      visual_parity: { passed: true },
    },
  });
  await writeArtifact('static_site_pull_request', {
    schema: 'github/PullRequest/v1',
    url: 'https://github.com/chubes4/wp-site-generator/pull/123',
  });

  const fixtureControllerProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--proof-mode',
      'fixture',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.equal(fixtureControllerProof.status, 0, fixtureControllerProof.stderr || fixtureControllerProof.stdout);

  const fixtureAsProductionProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.notEqual(fixtureAsProductionProof.status, 0, 'production controller proof rejects fixture artifacts');
  assert.match(fixtureAsProductionProof.stderr || fixtureAsProductionProof.stdout, /fixture-only tiny_fixture_site_run/);

  await rm(artifactRoot, { recursive: true, force: true });

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    runtime_preview: {
      schema: 'wp-codebox/private-runtime-result/v1',
      url: 'https://preview.dev.chubes.net/runs/123/sites/proof-site',
      codebox_result: { id: 'private-adapter-result' },
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
  const privateRuntimePreviewProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.equal(privateRuntimePreviewProof.status, 0, privateRuntimePreviewProof.stderr || privateRuntimePreviewProof.stdout);
  assert.match(privateRuntimePreviewProof.stdout, /semantic proof passed/);

  await rm(artifactRoot, { recursive: true, force: true });

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    runtime_access: {
      schema: 'homeboy/runtime-preview-access/v1',
      url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/runtime-preview',
      access: { kind: 'preview' },
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
  const githubArtifactPreviewProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.notEqual(githubArtifactPreviewProof.status, 0, 'production controller proof rejects GitHub artifact URLs as preview evidence');
  assert.match(githubArtifactPreviewProof.stderr || githubArtifactPreviewProof.stdout, /runtime preview URL is not a GitHub Actions artifact URL/);

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    runtime_access: {
      schema: 'homeboy/runtime-preview-access/v1',
      url: 'https://preview.dev.chubes.net/runs/123/sites/proof-site',
      access: { kind: 'preview' },
    },
    artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/static-site-candidate',
  });
  await writeArtifact('finding_packet_set', {
    schema: 'wp-site-generator/FindingPacketSet/v1',
    artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/finding-packets',
    packets: [{ kind: 'visual_parity_mismatch' }],
    actionable_conversion_count: 1,
  });
  await writeArtifact('finding_group', {
    schema: 'wp-site-generator/FindingGroup/v1',
    artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/finding-group',
  });
  const missingUpstreamActionProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.notEqual(missingUpstreamActionProof.status, 0, 'production proof requires one accepted upstream action for actionable findings');
  assert.match(missingUpstreamActionProof.stderr || missingUpstreamActionProof.stdout, /missing one accepted iterator upstream action/);

  await writeArtifact('iterator_upstream_issue', {
    schema: 'github/Issue/v1',
    url: 'https://github.com/chubes4/wp-site-generator/issues/123',
  });

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    runtime_access: {
      schema: 'homeboy/runtime-preview-access/v1',
      url: 'https://preview.dev.chubes.net/runs/123/sites/proof-site',
      access: { kind: 'preview' },
    },
    artifact_url: 'https://github.com/chubes4/wp-site-generator/actions/runs/123/artifacts/static-site-candidate',
  });
  const controllerProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.equal(controllerProof.status, 0, controllerProof.stderr || controllerProof.stdout);
  assert.match(controllerProof.stdout, /semantic proof passed/);

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
  });
  const missingUrlProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
      '--artifact-root',
      artifactRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  assert.equal(missingUrlProof.status, 0, missingUrlProof.stderr || missingUrlProof.stdout);
  assert.match(missingUrlProof.stdout, /semantic proof passed/);

  const workflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');
  assert.match(workflow, /node \.github\/scripts\/build-homeboy-ssi-loop-controller\.mjs/, 'site generation workflow generates the repo-owned controller spec before materialization');
  assert.match(workflow, /homeboy agent-task controller from-spec/, 'site generation workflow runs specs through Homeboy');
  assert.match(workflow, /from-spec[\s\S]*--output "\$HOMEBOY_CONTROLLER_RUN_FROM_SPEC_RESULT_PATH"/, 'site generation workflow asks Homeboy to write structured from-spec output');
  assert.ok(
    workflow.indexOf('node .github/scripts/build-homeboy-ssi-loop-controller.mjs') < workflow.indexOf('homeboy agent-task controller from-spec'),
    'site generation workflow generates the controller spec before Homeboy from-spec'
  );
  assert.match(workflow, /jq '\.data \/\/ \.value \/\/ \.'/, 'site generation workflow unwraps the materialization envelope before proof validation');
  assert.match(workflow, /validate-proof "@\$materialization_proof_path"/, 'site generation workflow validates the unwrapped materialized controller output through Homeboy');
  assert.doesNotMatch(workflow, /homeboy agent-task controller init/, 'site generation workflow does not manually initialize controllers');
  assert.doesNotMatch(workflow, /homeboy agent-task controller resume/, 'site generation workflow does not manually resume controllers');
  assert.doesNotMatch(workflow, /homeboy agent-task controller events/, 'site generation workflow does not manually record controller events');
  console.log('site generation loop proof assertion tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
