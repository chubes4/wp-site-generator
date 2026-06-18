#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseArgs, readJsonFile, repoPathResolver } from './lib/ci-runtime-utils.mjs';
import { buildSsiImportWorkload } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const repoPath = repoPathResolver(repoRoot);
const aggregatePath = args.get('--aggregate') || repoPath('.ci', 'homeboy-agent-task-aggregate.json');
const planPath = args.get('--plan') || repoPath('.ci', 'site-generation-loop.agent-task-plan.json');
const controllerPath = args.get('--controller') || repoPath('.github/homeboy/controllers/static-site-generation-loop.controller.json');
const controllerResultPath = args.get('--controller-result') || '';
const controllerRunSpecPath = args.get('--controller-run-spec') || '';

if (controllerResultPath || controllerRunSpecPath) {
	const controllerRunSpec = await readJsonFile(controllerRunSpecPath || controllerPath);
	const controllerResult = await readJsonFile(controllerResultPath);
	assert.equal(controllerRunSpec.schema, 'homeboy/agent-task-loop-spec/v1', 'controller run spec uses the Homeboy loop spec schema');
	assert.equal(controllerRunSpec.loop_id, 'wp-site-generator/static-site-generation-loop', 'controller run spec keeps the WPSG loop id');
	assert.equal(controllerRunSpec.metadata?.authority?.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs', 'controller run spec records its repo-owned builder');
	assert.ok(controllerRunSpec.inputs?.complexity_policy, 'controller run spec carries WPSG complexity inputs');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'fallback_blocks'), 'controller run spec keeps fallback block metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'conversion_findings'), 'controller run spec keeps conversion finding metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'visual_parity'), 'controller run spec keeps visual parity metrics');
	assert.match(controllerResult.schema || controllerResult.data?.schema || '', /controller-from-spec-result/, 'Homeboy result comes from controller from-spec');
	assert.ok(controllerResult.loop_id || controllerResult.data?.loop_id || controllerResult.value?.loop_id, 'controller result returns a durable loop id');
	console.log('site generation loop semantic proof passed');
	process.exit(0);
}

const aggregate = await readJsonFile(aggregatePath);
const plan = await readJsonFile(planPath);
const controller = await readJsonFile(controllerPath);
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

function assertPublishGates() {
  for (const taskItem of planTasks.filter((item) => item.executor?.config?.artifact_outputs?.static_site_publish_gate)) {
    const gate = outputValue(outcome(taskItem.task_id), 'static_site_publish_gate');
    assert.equal(gate?.publish_allowed, true, `${taskItem.task_id} emitted publish_allowed=true`);
    for (const gateId of ['fallback_blocks', 'conversion_findings', 'visual_parity']) {
      assert.equal(gate?.gates?.[gateId]?.passed, true, `${taskItem.task_id} ${gateId} gate passed`);
    }
  }

  for (const taskItem of planTasks.filter((item) => item.executor?.config?.runtime_task?.input?.success_completion_outcomes?.includes('static_site_pr'))) {
    const publishDependency = plan.output_dependencies?.[taskItem.task_id];
    const gateTaskId = publishDependency?.bindings?.static_site_publish_gate?.task_id;
    assert.ok(gateTaskId, `${taskItem.task_id} binds a StaticSitePublishGate before publishing`);
    const gate = outputValue(outcome(gateTaskId), 'static_site_publish_gate');
    assert.equal(gate?.publish_allowed, true, `${taskItem.task_id} cannot publish unless ${gateTaskId} publish_allowed=true`);
  }
}

function assertPublicationEvidence(taskItem) {
	const taskOutcome = outcome(taskItem.task_id);
	const prUrl = outputValue(taskOutcome, 'static_site_pr_url') || outputValue(taskOutcome, 'pr_url') || outputValue(taskOutcome, 'static_site_pr')?.url;
	if (prUrl) {
		assert.match(String(prUrl), /^https:\/\/github\.com\//, `${taskItem.task_id} publication PR evidence is a durable GitHub URL`);
	}
}

async function assertImportAndIteratorWorkflow() {
  const workflow = await readFile(repoPath('.github/workflows/static-site-validation.yml'), 'utf8');
  const validationWorkload = buildSsiImportWorkload('proof-site', {
    websiteArtifact: {
      schema: 'block-artifact-compiler/website-artifact/v1',
      files: [
        {
          path: 'website/index.html',
          content: '<!doctype html><html><body>Proof site</body></html>',
        },
      ],
    },
  });
  const validationWorkloadJson = JSON.stringify(validationWorkload);
  assert.match(workflow, /build-static-validation-settings\.mjs/, 'static validation delegates SSI settings to the shared builder');
  assert.match(validationWorkloadJson, /wp_get_ability\( 'static-site-importer\/import-website-artifact' \)/, 'static validation settings import generated static sites through the SSI website artifact ability');
  assert.doesNotMatch(validationWorkloadJson, /static-site-importer import-theme/, 'static validation settings do not depend on the SSI WP-CLI command');
  assert.match(validationWorkloadJson, /base64_decode/, 'static validation embeds a BAC website artifact payload for the ability bridge');
  assert.match(workflow, /Build SSI finding packets/, 'static validation builds SSI finding packets');
  assert.match(workflow, /dispatch-php-transformer-iterator\.mjs/, 'static validation delegates transformer iterator dispatch to the shared builder');
}

assertGeneratedContracts();
assertNoRuntimeFailures();
assertTaskArtifacts();
assertPublishGates();

for (const taskItem of planTasks.filter((item) => item.executor?.config?.runtime_task?.input?.success_completion_outcomes?.includes('static_site_pr'))) {
	assertPublicationEvidence(taskItem);
}
await assertImportAndIteratorWorkflow();

console.log('site generation loop semantic proof passed');
