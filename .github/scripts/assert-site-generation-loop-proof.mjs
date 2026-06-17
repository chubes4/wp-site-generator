#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { githubJson as fetchGithubJson, githubToken } from './lib/github-api.mjs';
import { buildSsiImportWorkload } from './lib/ssi-stack-profile.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const aggregatePath = args.get('--aggregate') || path.join(repoRoot, '.ci', 'homeboy-agent-task-aggregate.json');
const planPath = args.get('--plan') || path.join(repoRoot, '.ci', 'site-generation-loop.agent-task-plan.json');
const controllerPath = args.get('--controller') || path.join(repoRoot, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
const fixturePath = args.get('--fixture-state') || '';
const repo = args.get('--repo') || process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const token = githubToken(process.env, ['GITHUB_TOKEN', 'GH_TOKEN']);
const validationWaitMs = Number(process.env.STATIC_VALIDATION_WAIT_MS || 15 * 60 * 1000);
const validationPollMs = Number(process.env.STATIC_VALIDATION_POLL_MS || 15 * 1000);

const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8'));
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const controller = JSON.parse(await readFile(controllerPath, 'utf8'));
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
const outcomes = aggregate.outcomes || [];
const outcomesByTaskId = new Map(outcomes.map((item) => [item.task_id, item]));
const planTasks = plan.tasks || [];
const planTaskIds = planTasks.map((item) => item.task_id);

function fail(message) {
  throw new Error(`Site generation proof failed: ${message}`);
}

function outcome(taskId) {
  const found = outcomesByTaskId.get(taskId);
  if (!found) {
    fail(`missing outcome for ${taskId}`);
  }
  return found;
}

function labelsOf(value) {
  return (value.labels || []).map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean);
}

function prNumberFromUrl(url) {
  const match = String(url || '').match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function githubJson(kind, number) {
  if (fixture) {
    const collection = kind === 'pull_request' ? fixture.pull_requests : fixture.issues;
    const value = collection?.[String(number)];
    if (!value) {
      fail(`fixture missing ${kind} #${number}`);
    }
    return value;
  }

  return githubApi(kind === 'issue' ? `issues/${number}` : `pulls/${number}`);
}

async function githubApi(endpoint) {
  if (!token) {
    fail('GITHUB_TOKEN or GH_TOKEN is required for live proof assertions');
  }

  return fetchGithubJson({
    repo,
    endpoint,
    token,
    failMessage: (message) => `Site generation proof failed: ${message.replace(' failed:', ' fetch failed:')}`,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function outputValue(outcomeValue, key) {
  return outcomeValue.outputs?.[key] ?? outcomeValue.artifacts?.[key] ?? outcomeValue.typed_artifacts?.[key];
}

function assertGeneratedContracts() {
  assert.equal(plan.schema, 'homeboy/agent-task-plan/v1', 'plan uses the Homeboy agent-task plan schema');
  assert.equal(controller.schema, 'homeboy/agent-task-loop-spec/v1', 'controller uses the Homeboy loop spec schema');
  assert.equal(plan.metadata?.controller_contract, controller.loop_id, 'plan metadata points at the controller loop contract');
  assert.equal(plan.metadata?.controller_spec, '.github/homeboy/controllers/static-site-generation-loop.controller.json', 'plan metadata points at the checked-in controller spec');
  assert.equal(plan.metadata?.controller_authority?.builder, controller.metadata?.authority?.builder, 'plan records the controller builder as authority');

  const controllerArtifacts = new Set((controller.artifacts || []).map((artifact) => artifact.artifact_id));
  const controllerWorkflows = new Set((controller.workflows || []).map((workflow) => workflow.workflow_id));
  assert.ok(controllerArtifacts.size > 0, 'controller declares artifact contracts');
  assert.ok(controllerWorkflows.size > 0, 'controller declares workflow contracts');

  for (const taskItem of planTasks) {
    assert.ok(taskItem.task_id, 'each plan task has a task_id');
    for (const key of artifactOutputKeys(taskItem)) {
      assert.ok(controllerArtifacts.has(key), `${taskItem.task_id} artifact output ${key} is declared by the controller`);
    }
  }

  for (const [taskId, dependency] of Object.entries(plan.output_dependencies || {})) {
    assert.ok(planTaskIds.includes(taskId), `${taskId} output dependency points at a plan task`);
    for (const [bindingName, binding] of Object.entries(dependency.bindings || {})) {
      assert.ok(planTaskIds.includes(binding.task_id), `${taskId} binding ${bindingName} points at a plan task`);
      if (binding.required !== false) {
        const bindingOutcome = outcome(binding.task_id);
        const field = String(binding.path || '').replace(/^\/outputs\//, '');
        assert.ok(outputValue(bindingOutcome, field), `${binding.task_id} emitted required bound output ${field}`);
      }
    }
  }
}

function assertNoRuntimeFailures() {
  assert.equal(aggregate.status, 'succeeded', 'aggregate status is succeeded');
  assert.equal(aggregate.totals?.queued ?? planTasks.length, planTasks.length, 'site generation loop queues the generated plan tasks');
  assert.equal(aggregate.totals?.succeeded ?? outcomes.length, planTasks.length, 'site generation loop succeeds the generated plan tasks');
  assert.equal(aggregate.totals?.failed, 0, 'site generation loop has zero failed tasks');

  for (const taskId of planTaskIds) {
    outcome(taskId);
  }

  for (const item of outcomes) {
    assert.equal(item.status, 'succeeded', `${item.task_id} outcome succeeded`);
    const failedDiagnostics = (item.diagnostics || []).filter((diagnostic) => /agent_task_run_failed|runtime.*fail/i.test(diagnostic.class || diagnostic.message || ''));
    assert.deepEqual(failedDiagnostics, [], `${item.task_id} has no embedded runtime failure diagnostics`);
  }
}

function assertTaskArtifacts() {
  for (const taskItem of planTasks) {
    const taskOutcome = outcome(taskItem.task_id);
    for (const key of expectedOutputKeys(taskItem)) {
      assert.ok(outputValue(taskOutcome, key), `${taskItem.task_id} emitted ${key}`);
    }
  }
}

async function assertStaticPr(taskItem) {
  const taskOutcome = outcome(taskItem.task_id);
  const staticPrNumber = prNumberFromUrl(outputValue(taskOutcome, 'static_site_pr_url') || outputValue(taskOutcome, 'pr_url'));
  if (!staticPrNumber) {
    fail(`${taskItem.task_id} missing static PR output`);
  }

  const pr = await githubJson('pull_request', staticPrNumber);
  const prLabels = labelsOf(pr);

  assert.match(pr.title || '', /static site/i, `${taskItem.task_id} static PR title identifies a static site`);
  assert.match(pr.head?.ref || pr.headRefName || '', /^static\//, `${taskItem.task_id} static PR branch uses the static namespace`);
  assert.match(pr.body || '', /Import validation|fallback block|conversion finding|artifact/i, `${taskItem.task_id} static PR body includes validation artifact context`);
  assert.equal(prLabels.some((label) => label === 'target:wordpress' || label === 'target:woocommerce'), true, `${taskItem.task_id} static PR has target validation label`);

  return { taskId: taskItem.task_id, staticPrNumber };
}

async function assertImportAndIteratorWorkflow() {
  const workflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
  const validationWorkload = buildSsiImportWorkload('proof-site');
  const validationWorkloadJson = JSON.stringify(validationWorkload);
  assert.match(workflow, /build-static-validation-settings\.mjs/, 'static validation delegates SSI settings to the shared builder');
  assert.match(validationWorkloadJson, /static-site-importer import-theme/, 'static validation settings import generated static sites');
  assert.match(validationWorkloadJson, /static-sites\/proof-site\/index\.html/, 'static validation imports the requested generated site');
  assert.match(workflow, /Build SSI finding packets/, 'static validation builds SSI finding packets');
  assert.match(workflow, /dispatch-php-transformer-iterator\.mjs/, 'static validation delegates transformer iterator dispatch to the shared builder');
}

async function assertStaticValidationComments(staticPrs) {
  if (fixture) {
    return;
  }

  const pending = new Map(staticPrs.map((item) => [item.staticPrNumber, item.taskId]));
  const deadline = Date.now() + validationWaitMs;

  while (pending.size > 0 && Date.now() <= deadline) {
    for (const [prNumber, taskId] of [...pending.entries()]) {
      const comments = await githubApi(`issues/${prNumber}/comments?per_page=100`);
      const validationComment = comments.find((comment) => {
        const body = String(comment.body || '');
        return body.includes('## Static site validation:') && body.includes('### SSI Signals');
      });

      if (!validationComment) {
        continue;
      }

      const body = String(validationComment.body || '');
      assert.equal(body.includes('_No bench artifact found._'), false, `${taskId} static PR validation has bench artifact`);
      assert.equal(body.includes('_SSI workload did not run._'), false, `${taskId} static PR validation ran SSI workload`);
      assert.equal(body.includes('_No SSI metrics emitted yet._'), false, `${taskId} static PR validation emitted SSI metrics`);
      assert.match(body, /\*\*Playground preview:\*\*/, `${taskId} static PR validation includes Playground preview`);
      pending.delete(prNumber);
    }

    if (pending.size > 0) {
      await sleep(validationPollMs);
    }
  }

  if (pending.size > 0) {
    fail(`static validation metrics comments missing for PR(s): ${[...pending.keys()].map((number) => `#${number}`).join(', ')}`);
  }
}

assertGeneratedContracts();
assertNoRuntimeFailures();
assertTaskArtifacts();

const staticPrs = [];
for (const taskItem of planTasks.filter((item) => item.executor?.config?.runtime_task?.input?.success_completion_outcomes?.includes('static_site_pr'))) {
  staticPrs.push(await assertStaticPr(taskItem));
}
await assertImportAndIteratorWorkflow();
await assertStaticValidationComments(staticPrs);

console.log('site generation loop semantic proof passed');
