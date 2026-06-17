import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-proof-'));
const planPath = path.join(tempDir, 'site-generation-loop.agent-task-plan.json');
const controllerPath = path.join(repoRoot, '.github/homeboy/controllers/static-site-generation-loop.controller.json');

function artifactOutputKeys(taskItem) {
  return Object.keys(taskItem.executor?.config?.artifact_outputs || taskItem.executor?.config?.runtime_task?.input?.artifact_outputs || {});
}

function engineOutputKeys(taskItem) {
  return Object.keys(taskItem.executor?.config?.engine_data_outputs || taskItem.executor?.config?.runtime_task?.input?.engine_data_outputs || {});
}

function successOutcomeKeys(taskItem) {
  return taskItem.executor?.config?.runtime_task?.input?.success_completion_outcomes || [];
}

function expectedOutputKeys(taskItem) {
  return [...new Set([...artifactOutputKeys(taskItem), ...engineOutputKeys(taskItem), ...successOutcomeKeys(taskItem)])];
}

function outputValueForKey(key, taskIndex) {
  if (key === 'static_site_pr_url' || key === 'pr_url') {
    return `https://github.com/chubes4/wp-site-generator/pull/${701 + taskIndex}`;
  }
  if (key === 'static_site_branch') {
    return `static/generated-${taskIndex}`;
  }
  if (key === 'static_site_slug') {
    return `generated-${taskIndex}`;
  }
  if (key === 'static_site_pr') {
    return { url: `https://github.com/chubes4/wp-site-generator/pull/${701 + taskIndex}` };
  }
  return { schema: `fixture/${key}/v1`, artifact_url: `https://example.com/artifacts/${taskIndex}/${key}.json` };
}

function aggregate(plan, overrides = {}) {
  const value = {
    schema: 'homeboy/agent-task-aggregate/v1',
    status: 'succeeded',
    totals: {
      queued: plan.tasks.length,
      succeeded: plan.tasks.length,
      failed: 0,
    },
    outcomes: plan.tasks.map((taskItem, index) => ({
      task_id: taskItem.task_id,
      status: 'succeeded',
      diagnostics: [],
      outputs: Object.fromEntries(expectedOutputKeys(taskItem).map((key) => [key, outputValueForKey(key, index)])),
    })),
  };
  return overrides.aggregate ? overrides.aggregate(value) : value;
}

function fixture(plan, overrides = {}) {
  const publishTasks = plan.tasks.filter((taskItem) => taskItem.executor?.config?.runtime_task?.input?.success_completion_outcomes?.includes('static_site_pr'));
  const value = {
    pull_requests: Object.fromEntries(
      publishTasks.map((taskItem, index) => [
        String(701 + plan.tasks.findIndex((item) => item.task_id === taskItem.task_id)),
        {
          number: 701 + index,
          title: `${taskItem.inputs.title} static site`,
          body: '## Import validation\n\nFallback block count: 0\n\nConversion finding count: 0\n\nArtifact: https://example.com/artifacts/import-validation.json',
          head: { ref: `static/generated-${index}` },
          labels: [{ name: index === 0 ? 'target:woocommerce' : 'target:wordpress' }],
        },
      ])
    ),
  };
  return overrides.fixture ? overrides.fixture(value) : value;
}

async function runCase(name, aggregateValue, fixtureValue) {
  const aggregatePath = path.join(tempDir, `${name}.aggregate.json`);
  const fixturePath = path.join(tempDir, `${name}.fixture.json`);
  await writeFile(aggregatePath, `${JSON.stringify(aggregateValue, null, 2)}\n`);
  await writeFile(fixturePath, `${JSON.stringify(fixtureValue, null, 2)}\n`);
  return spawnSync(
    process.execPath,
    [
      '.github/scripts/assert-site-generation-loop-proof.mjs',
      '--aggregate',
      aggregatePath,
      '--plan',
      planPath,
      '--controller',
      controllerPath,
      '--fixture-state',
      fixturePath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
}

try {
  const planResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOMEBOY_PLAN_PATH: planPath,
    },
    encoding: 'utf8',
  });
  assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);

  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.equal(plan.metadata.controller_authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs');

  const passing = await runCase('passing', aggregate(plan), fixture(plan));
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /semantic proof passed/);

  const missingTask = await runCase(
    'missing-task',
    aggregate(plan, {
      aggregate: (value) => {
        value.outcomes = value.outcomes.filter((item) => item.task_id !== plan.tasks[0].task_id);
        return value;
      },
    }),
    fixture(plan)
  );
  assert.notEqual(missingTask.status, 0, 'missing generated plan task fails proof');
  assert.match(missingTask.stderr, /missing outcome/);

  const missingArtifact = await runCase(
    'missing-artifact',
    aggregate(plan, {
      aggregate: (value) => {
        const taskWithOutput = plan.tasks.find((taskItem) => expectedOutputKeys(taskItem).length > 0);
        delete value.outcomes.find((item) => item.task_id === taskWithOutput.task_id).outputs[expectedOutputKeys(taskWithOutput)[0]];
        return value;
      },
    }),
    fixture(plan)
  );
  assert.notEqual(missingArtifact.status, 0, 'missing generated artifact output fails proof');
  assert.match(missingArtifact.stderr, /emitted required bound output|emitted/);

  const runtimeFailure = await runCase(
    'runtime-failure',
    aggregate(plan, {
      aggregate: (value) => {
        value.outcomes[0].diagnostics.push({ class: 'wp-codebox.agent_task_run_failed', message: 'runtime failed' });
        return value;
      },
    }),
    fixture(plan)
  );
  assert.notEqual(runtimeFailure.status, 0, 'embedded runtime failure fails proof');
  assert.match(runtimeFailure.stderr, /embedded runtime failure diagnostics/);

  const weakPr = await runCase(
    'weak-pr',
    aggregate(plan),
    fixture(plan, {
      fixture: (value) => {
        const firstPr = Object.keys(value.pull_requests)[0];
        value.pull_requests[firstPr].body = 'No durable validation context yet.';
        return value;
      },
    })
  );
  assert.notEqual(weakPr.status, 0, 'static PR without validation artifact context fails proof');
  assert.match(weakPr.stderr, /static PR body includes validation artifact context/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('site generation loop proof assertion tests passed');
