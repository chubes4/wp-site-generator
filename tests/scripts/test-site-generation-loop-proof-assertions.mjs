import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const homeboyFixturePath = await createHomeboyControllerFixture(tempDir);

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
  await writeFile(controllerRunSpecPath, JSON.stringify(materialization.spec, null, 2) + '\n');

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
  assert.equal(controllerResult.loop_id, 'wp-site-generator_static-site-generation-loop');

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

  const controllerProof = spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--controller-result',
      controllerResultPath,
      '--controller-run-spec',
      controllerRunSpecPath,
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
  assert.match(workflow, /homeboy agent-task controller from-spec/, 'site generation workflow initializes Homeboy controller from spec');
  assert.match(workflow, /homeboy agent-task controller resume/, 'site generation workflow resumes the Homeboy controller');
  assert.match(workflow, /homeboy agent-task controller events/, 'site generation workflow records controller events');
  assert.doesNotMatch(workflow, /agent-task run-plan/, 'site generation workflow no longer runs repo-local generated plans');
  assert.doesNotMatch(workflow, /dispatch-static-validation\.mjs/, 'site generation workflow no longer dispatches validation with repo-local state');

  console.log('site generation loop proof assertion tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
