#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
const artifactRoot = args.get('--artifact-root') || process.env.HOMEBOY_ARTIFACT_ROOT || repoPath('.ci', 'homeboy-agent-task-artifacts');

function fail(message) {
  throw new Error(`Site generation proof failed: ${message}`);
}

function firstValue(value, paths) {
	for (const keyPath of paths) {
		const found = keyPath.split('.').reduce((current, key) => current?.[key], value);
		if (found !== undefined && found !== null && found !== '') {
			return found;
		}
	}
	return undefined;
}

function numberEqualsZero(value, label) {
	assert.equal(Number(value), 0, `${label} is zero`);
}

function assertDurableUrl(value, label) {
	const url = String(value || '').trim();
	assert.match(url, /^https?:\/\//, `${label} is an HTTP URL`);
	assert.doesNotMatch(url, /localhost|127\.0\.0\.1|\/Users\//, `${label} is not local-only evidence`);
}

function unwrapArtifact(value) {
	return value?.artifact && typeof value.artifact === 'object'
		? value.artifact
		: value?.data && typeof value.data === 'object'
			? value.data
			: value?.value && typeof value.value === 'object'
				? value.value
				: value;
}

function artifactMatches(value, artifactId, schema) {
	const haystack = [
		value.artifact_id,
		value.artifactId,
		value.id,
		value.name,
		value.type,
		value.kind,
		value.schema,
		value.artifact_type,
	]
		.filter(Boolean)
		.map((item) => String(item));
	return haystack.some((item) => item === artifactId || item === schema || item.endsWith(`/${artifactId}`));
}

async function readArtifactJsonFiles(rootDir) {
	const values = [];
	async function visit(currentDir) {
		let entries;
		try {
			entries = await readdir(currentDir, { withFileTypes: true });
		} catch (error) {
			if (error?.code === 'ENOENT') {
				return;
			}
			throw error;
		}
		for (const entry of entries) {
			const entryPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await visit(entryPath);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith('.json')) {
				continue;
			}
			try {
				const parsed = JSON.parse(await readFile(entryPath, 'utf8'));
				values.push({ path: entryPath, value: unwrapArtifact(parsed) });
			} catch (error) {
				if (!(error instanceof SyntaxError)) {
					throw error;
				}
			}
		}
	}
	await visit(rootDir);
	return values;
}

async function assertControllerArtifactProof(controllerRunSpec) {
	const artifactSchemas = new Map((controllerRunSpec.artifacts || []).map((artifact) => [artifact.artifact_id, artifact.kind || artifact.schema]));
	const artifacts = await readArtifactJsonFiles(artifactRoot);
	const byId = new Map();
	for (const artifactId of artifactSchemas.keys()) {
		const found = artifacts.find((item) => artifactMatches(item.value, artifactId, artifactSchemas.get(artifactId)) || path.basename(item.path, '.json') === artifactId);
		if (found) {
			byId.set(artifactId, found.value);
		}
	}

	for (const artifactId of ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt', 'reviewer_gate_outcome', 'static_site_publish_gate']) {
		assert.ok(byId.has(artifactId), `artifact root contains ${artifactId}`);
	}

	const candidate = byId.get('static_site_candidate');
	assertDurableUrl(firstValue(candidate, ['preview_url', 'playground_url', 'urls.preview', 'urls.playground', 'preview.url', 'playground.url']), 'preview/playground URL');

	const importValidation = byId.get('import_validation_result');
	numberEqualsZero(firstValue(importValidation, ['metrics.fallback_blocks', 'metrics.fallback_block_count', 'metrics.ssi_fallback_count', 'fallback_blocks', 'fallback_block_count']), 'fallback block metric');
	numberEqualsZero(firstValue(importValidation, ['metrics.conversion_findings', 'conversion_findings']), 'conversion finding metric');
	assertDurableUrl(firstValue(importValidation, ['artifact_url', 'url', 'report_url']), 'import validation artifact URL');

	const validationRun = byId.get('static_validation_run');
	assertDurableUrl(firstValue(validationRun, ['artifact_url', 'url', 'report_url']), 'static validation run artifact URL');

	const visual = byId.get('visual_parity_artifact');
	const visualStatus = String(firstValue(visual, ['summary.status', 'status']) || '').toLowerCase();
	assert.ok(visualStatus === 'pass' || firstValue(visual, ['summary.pass', 'pass']) === true, 'visual parity artifact records pass status');
	numberEqualsZero(firstValue(visual, ['summary.mismatch_count', 'mismatch_count', 'metrics.mismatch_count']), 'visual mismatch count');
	numberEqualsZero(firstValue(visual, ['summary.max_delta_ratio', 'max_delta_ratio', 'metrics.max_delta_ratio']), 'visual max delta ratio');
	assertDurableUrl(firstValue(visual, ['artifact_url', 'url', 'summary_url']), 'visual parity artifact URL');

	const findings = byId.get('finding_packet_set');
	assert.ok(Array.isArray(findings.packets || findings.findings || findings.groups) || Number(findings.actionable_conversion_count ?? 0) === 0, 'finding packet evidence is present');
	assertDurableUrl(firstValue(findings, ['artifact_url', 'url']), 'finding packet artifact URL');

	const revalidation = byId.get('revalidation_attempt');
	assert.ok(['pass', 'passed', 'succeeded', 'success'].includes(String(firstValue(revalidation, ['status', 'decision', 'result']) || '').toLowerCase()) || firstValue(revalidation, ['passed', 'success']) === true, 'revalidation evidence records success');
	assertDurableUrl(firstValue(revalidation, ['artifact_url', 'url', 'report_url']), 'revalidation artifact URL');

	const reviewer = byId.get('reviewer_gate_outcome');
	assert.equal(String(firstValue(reviewer, ['decision', 'status']) || '').toUpperCase(), 'PASS', 'reviewer gate passes');
	assertDurableUrl(firstValue(reviewer, ['artifact_url', 'url', 'report_url']), 'reviewer gate artifact URL');

	const publishGate = byId.get('static_site_publish_gate');
	assertDurableUrl(firstValue(publishGate, ['artifact_url', 'url', 'report_url']), 'publication gate artifact URL');
	if (publishGate.publish_allowed === true) {
		for (const gateId of ['fallback_blocks', 'conversion_findings', 'visual_parity']) {
			assert.equal(publishGate.gates?.[gateId]?.passed, true, `publish gate ${gateId} passed`);
		}
		const pr = byId.get('static_site_pull_request');
		assert.ok(pr, 'publish_allowed=true requires static_site_pull_request artifact');
		assertDurableUrl(firstValue(pr, ['url', 'html_url', 'pr_url', 'pull_request.url']), 'publication PR URL');
	}
}

if (controllerResultPath || controllerRunSpecPath) {
	const controllerRunSpec = await readJsonFile(controllerRunSpecPath || controllerPath);
	const controllerResult = await readJsonFile(controllerResultPath);
	// Homeboy validate-proof covers generic materialization readiness; this script keeps WPSG-specific semantic assertions.
	assert.equal(controllerRunSpec.loop_id, 'wp-site-generator/static-site-generation-loop', 'controller run spec keeps the WPSG loop id');
	assert.equal(controllerRunSpec.metadata?.authority?.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs', 'controller run spec records its repo-owned builder');
	assert.ok(controllerRunSpec.workflows?.every((workflow) => workflow.inputs?.policy_results?.['wpsg-complexity-policy']), 'controller run spec carries WPSG complexity policy results on materialized workflows');
	assert.ok(controllerRunSpec.metadata?.policy_materialization?.['wpsg-complexity-policy'], 'controller run spec records Homeboy policy materialization metadata');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'fallback_blocks'), 'controller run spec keeps fallback block metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'conversion_findings'), 'controller run spec keeps conversion finding metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'visual_parity'), 'controller run spec keeps visual parity metrics');
	assert.ok(controllerResult.loop_id || controllerResult.data?.loop_id || controllerResult.value?.loop_id, 'controller result returns a durable loop id');
	await assertControllerArtifactProof(controllerRunSpec);
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

function runtimeOutputProjectionKeys(taskItem) {
	return Object.keys(taskItem.executor?.config?.runtime_output_projections || taskItem.executor?.config?.runtime_task?.input?.runtime_output_projections || {});
}

function successOutcomeKeys(taskItem) {
  return taskItem.executor?.config?.runtime_task?.input?.success_completion_outcomes || [];
}

function expectedOutputKeys(taskItem) {
	return [...new Set([...artifactOutputKeys(taskItem), ...runtimeOutputProjectionKeys(taskItem), ...successOutcomeKeys(taskItem)])];
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
  assert.match(workflow, /gh workflow run php-transformer-iterator\.yml/, 'static validation dispatches the transformer iterator through the Actions trigger boundary');
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
