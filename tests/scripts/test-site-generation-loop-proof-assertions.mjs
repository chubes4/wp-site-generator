import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHomeboyControllerFixture } from '../helpers/homeboy-fixtures.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-proof-'));
const controllerRunSpecPath = path.join(tempDir, 'site-generation-loop.controller-run-spec.json');
const controllerResultPath = path.join(tempDir, 'site-generation-loop.controller-from-spec.json');
const controllerResumePath = path.join(tempDir, 'site-generation-loop.controller-resume.json');
const controllerEventPath = path.join(tempDir, 'site-generation-loop.controller-event.json');
const controllerRunInputsPath = path.join(tempDir, 'site-generation-loop.controller-run-inputs.json');
const controllerPolicyResultPath = path.join(tempDir, 'site-generation-loop.complexity-policy-result.json');
const controllerMaterializationPath = path.join(tempDir, 'site-generation-loop.controller-materialization.json');
const controllerMaterializationProofPath = path.join(tempDir, 'site-generation-loop.controller-materialization.proof.json');
const artifactRoot = path.join(tempDir, 'homeboy-agent-task-artifacts');
const homeboyFixturePath = await createHomeboyControllerFixture(tempDir);

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
  assert.equal(controllerRunSpec.metadata.run.materialized_by, 'homeboy agent-task controller materialize');
  assert.ok(controllerRunSpec.workflows.every((workflow) => workflow.inputs?.policy_results?.['wpsg-complexity-policy']), 'materialized workflows include WPSG complexity policy results');

  const fromSpecResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'from-spec', `@${controllerRunSpecPath}`, '--output', controllerResultPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(fromSpecResult.status, 0, fromSpecResult.stderr || fromSpecResult.stdout);
  const controllerResult = JSON.parse(await readFile(controllerResultPath, 'utf8'));
  assert.equal(controllerResult.schema, 'homeboy/agent-task-loop-controller-from-spec-result/v1');
  assert.equal(controllerResult.loop_id, 'wp-site-generator_static-site-generation-loop_proof-replay');

  const eventResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'events', controllerResult.loop_id, '--event-type', 'github.workflow.completed', '--event-key', 'proof-replay', '--payload', '{"run_id":"proof-replay"}', '--output', controllerEventPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(eventResult.status, 0, eventResult.stderr || eventResult.stdout);

  const resumeResult = spawnSync(homeboyFixturePath, ['agent-task', 'controller', 'resume', controllerResult.loop_id, '--output', controllerResumePath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(resumeResult.status, 0, resumeResult.stderr || resumeResult.stdout);

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
  assert.match(missingArtifactProof.stderr || missingArtifactProof.stdout, /artifact root contains static_site_candidate/);

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

  await writeArtifact('static_site_candidate', {
    schema: 'wp-site-generator/StaticSiteCandidate/v1',
    preview_url: 'https://preview.example.test/proof-site',
    artifact_url: 'https://artifacts.example.test/static-site-candidate.json',
  });
  await writeArtifact('import_validation_result', {
    schema: 'wp-site-generator/ImportValidationResult/v1',
    artifact_url: 'https://artifacts.example.test/import-validation.json',
    metrics: { fallback_blocks: 0, conversion_findings: 0 },
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

  const workflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');
  assert.match(workflow, /homeboy agent-task controller materialize/, 'site generation workflow materializes specs through Homeboy');
  assert.match(workflow, /jq '\.data \/\/ \.value \/\/ \.'/, 'site generation workflow unwraps the materialization envelope before proof validation');
  assert.match(workflow, /validate-proof "@\$materialization_proof_path"/, 'site generation workflow validates the unwrapped materialized controller output through Homeboy');
  assert.match(workflow, /homeboy agent-task controller from-spec/, 'site generation workflow initializes Homeboy controller from spec');
  assert.match(workflow, /homeboy agent-task controller resume/, 'site generation workflow resumes the Homeboy controller');
  assert.match(workflow, /homeboy agent-task controller events/, 'site generation workflow records controller events');
  assert.doesNotMatch(workflow, /agent-task run-plan/, 'site generation workflow no longer runs repo-local generated plans');
  assert.doesNotMatch(workflow, /dispatch-static-validation\.mjs/, 'site generation workflow no longer dispatches validation with repo-local state');

  console.log('site generation loop proof assertion tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
