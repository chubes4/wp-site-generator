#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseArgs, readJsonFile, repoPathResolver } from './lib/ci-runtime-utils.mjs';
import { buildSiteGenerationLoopId } from './lib/site-generation-loop-run.mjs';
import { buildSsiImportWorkload } from './lib/ssi-stack-profile.mjs';

const args = parseArgs(process.argv.slice(2));

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const repoPath = repoPathResolver(repoRoot);
const aggregatePath = args.get('--aggregate') || repoPath('.ci', 'homeboy-agent-task-aggregate.json');
const planPath = args.get('--plan') || repoPath('.ci', 'site-generation-loop.agent-task-plan.json');
const controllerPath = args.get('--controller') || repoPath('.github/homeboy/controllers/static-site-generation-loop.controller.json');
const controllerResultPath = args.get('--controller-result') || '';
const controllerRunSpecPath = args.get('--controller-run-spec') || '';
const controllerResumePath = args.get('--controller-resume') || '';
const controllerEventPath = args.get('--controller-event') || '';
const artifactRoot = args.get('--artifact-root') || process.env.HOMEBOY_ARTIFACT_ROOT || repoPath('.ci', 'homeboy-agent-task-artifacts');
const proofMode = args.get('--proof-mode') || process.env.WPSG_LOOP_PROOF_MODE || 'production';

const upstreamDependencies = {
	runtimeArtifacts: 'https://github.com/Extra-Chill/homeboy-extensions/pull/1645',
	controllerEvents: 'https://github.com/Extra-Chill/homeboy/pull/5152',
	fanout: 'https://github.com/Extra-Chill/homeboy/pull/5691',
};

function fail(message) {
  throw new Error(`Site generation proof failed: ${message}`);
}

function failDependency(message, dependency) {
	fail(`${message}; dependency: ${dependency}`);
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
	if (proofMode !== 'fixture') {
		assert.doesNotMatch(url, /^https?:\/\/(?:[^/]+\.)?example\.(?:com|net|org|test)(?:[/:?#]|$)/i, `${label} is not placeholder evidence`);
	}
}

function assertRealArtifactUrl(value, label) {
	assertDurableUrl(value, label);
}

function assertRealPreviewUrl(value, label) {
	assertDurableUrl(value, label);
	if (proofMode !== 'fixture') {
		assert.doesNotMatch(String(value || ''), /^https?:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[^/]+\/artifacts(?:[/:?#]|$)/i, `${label} is not a GitHub Actions artifact URL`);
	}
}

function assertProductionArtifact(artifact, artifactId) {
	if (proofMode === 'fixture') {
		return;
	}
	const evidenceText = JSON.stringify(artifact).toLowerCase();
	if (/\b(fixture|synthetic|placeholder|mock)\b/.test(evidenceText)) {
		fail(`${artifactId} is fixture or synthetic evidence; rerun with real Homeboy/WP Codebox artifacts or pass --proof-mode fixture for fixture-only tests`);
	}
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

function assertRunScopedLoopId(controllerRunSpec) {
	const runId = controllerRunSpec.metadata?.run?.run_id;
	assert.ok(runId, 'controller run spec records a run id');
	assert.equal(controllerRunSpec.loop_id, buildSiteGenerationLoopId(runId), 'controller run spec keeps the run-scoped WPSG loop id');
	assert.equal(controllerRunSpec.metadata?.run?.loop_id, controllerRunSpec.loop_id, 'controller run metadata records the run-scoped WPSG loop id');
}

function assertNoToolCallPlaceholderArtifacts(value, seen = new Set()) {
	if (!value || typeof value !== 'object' || seen.has(value)) {
		return;
	}
	seen.add(value);

	if (value.schema === 'homeboy/agent-task-typed-artifact/v1') {
		const content = String(value.payload?.content || '').trim();
		if (/^<workspace_[a-z0-9_:-]+(?:\s[^>]*)?\/>$/i.test(content)) {
			fail(`${value.artifact_id || value.name || value.type || 'typed artifact'} contains an unexecuted workspace tool-call placeholder`);
		}
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			assertNoToolCallPlaceholderArtifacts(item, seen);
		}
		return;
	}

	for (const item of Object.values(value)) {
		assertNoToolCallPlaceholderArtifacts(item, seen);
	}
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

function findArtifact(artifacts, artifactSchemas, artifactId) {
	const schema = artifactSchemas.get(artifactId);
	const found = artifacts.find((item) => artifactMatches(item.value, artifactId, schema) || path.basename(item.path, '.json') === artifactId);
	return found?.value;
}

function requireArtifact(artifacts, artifactSchemas, artifactId, dependency = upstreamDependencies.runtimeArtifacts) {
	const artifact = findArtifact(artifacts, artifactSchemas, artifactId);
	if (!artifact) {
		failDependency(`artifact root is missing Homeboy-emitted ${artifactId}`, dependency);
	}
	return artifact;
}

function optionalArtifact(artifacts, artifactSchemas, artifactId) {
	return findArtifact(artifacts, artifactSchemas, artifactId);
}

function runtimePreviewUrl(candidate) {
	if (proofMode === 'fixture') {
		return firstValue(candidate, ['runtime_preview.url', 'preview_evidence.preview_url', 'preview_evidence.url', 'preview_url', 'urls.preview', 'preview.url']);
	}
	return firstValue(candidate, ['runtime_preview.url', 'preview_evidence.preview_url', 'preview_evidence.url', 'evidence.preview_url', 'preview.url']);
}

function runtimePreviewEnvelope(candidate) {
	return firstValue(candidate, ['runtime_preview', 'preview_evidence', 'evidence.preview', 'preview']);
}

function assertProductionRuntimePreviewEnvelope(candidate) {
	const envelope = runtimePreviewEnvelope(candidate);
	if (proofMode === 'fixture') {
		return;
	}
	assert.ok(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'runtime preview evidence is a structured envelope');
	const serialized = JSON.stringify(envelope).toLowerCase();
	assert.ok(/wp[-_ ]?codebox|playground\.wordpress\.net|wordpress[-_ ]?playground|\bplayground\b/.test(serialized), 'runtime preview envelope records WP Codebox or WordPress Playground provenance');
}

async function assertControllerEventProof(controllerRunSpec, loopId) {
	if (!controllerResumePath) {
		failDependency('missing controller resume result evidence', upstreamDependencies.controllerEvents);
	}
	if (!controllerEventPath) {
		failDependency('missing controller event result evidence', upstreamDependencies.controllerEvents);
	}
	const resume = await readJsonFile(controllerResumePath);
	const event = await readJsonFile(controllerEventPath);
	assert.equal(resume.loop_id || resume.data?.loop_id || resume.value?.loop_id, loopId, 'controller resume evidence records the durable loop id');
	assert.equal(event.loop_id || event.data?.loop_id || event.value?.loop_id, loopId, 'controller event evidence records the durable loop id');
	assert.ok(event.applied === true || event.data?.applied === true || event.value?.applied === true, 'controller event evidence records an applied event');
	const eventType = event.event_type || event.data?.event_type || event.value?.event_type;
	assert.ok(eventType, 'controller event evidence records an event type');
	const runLoopId = controllerRunSpec.metadata?.run?.loop_id;
	assert.ok(runLoopId === loopId || runLoopId?.replaceAll('/', '_') === loopId, 'controller event evidence is tied to the run-scoped loop');
}

async function assertControllerArtifactProof(controllerRunSpec) {
	assert.ok(['production', 'fixture'].includes(proofMode), 'proof mode is production or fixture');
	const artifactSchemas = new Map((controllerRunSpec.artifacts || []).map((artifact) => [artifact.artifact_id, artifact.kind || artifact.schema]));
	const artifacts = await readArtifactJsonFiles(artifactRoot);
	if (proofMode !== 'fixture' && findArtifact(artifacts, artifactSchemas, 'tiny_fixture_site_run')) {
		fail('artifact root contains fixture-only tiny_fixture_site_run; production proof requires Homeboy-emitted real loop artifacts');
	}

	if (proofMode === 'fixture') {
		const fixtureRun = requireArtifact(artifacts, artifactSchemas, 'tiny_fixture_site_run');
		assert.equal(String(firstValue(fixtureRun, ['fixture', 'site_kind', 'site.kind']) || '').toLowerCase(), 'tiny', 'fixture site run records the tiny fixture site');
		assertDurableUrl(firstValue(fixtureRun, ['artifact_url', 'url', 'report_url']), 'tiny fixture site run artifact URL');
	}

	const candidate = requireArtifact(artifacts, artifactSchemas, 'static_site_candidate');
	assertProductionArtifact(candidate, 'static_site_candidate');
	assertProductionRuntimePreviewEnvelope(candidate);
	assertRealPreviewUrl(runtimePreviewUrl(candidate), 'runtime preview URL');
	assertRealArtifactUrl(firstValue(candidate, ['artifact_url', 'url', 'report_url']), 'static site candidate artifact URL');

	const importValidation = requireArtifact(artifacts, artifactSchemas, 'import_validation_result');
	assertProductionArtifact(importValidation, 'import_validation_result');
	numberEqualsZero(firstValue(importValidation, ['metrics.fallback_blocks', 'metrics.fallback_block_count', 'metrics.ssi_fallback_count', 'fallback_blocks', 'fallback_block_count']), 'fallback block metric');
	numberEqualsZero(firstValue(importValidation, ['metrics.conversion_findings', 'conversion_findings']), 'conversion finding metric');
	assertRealArtifactUrl(firstValue(importValidation, ['artifact_url', 'url', 'report_url']), 'import validation artifact URL');
	assert.ok(firstValue(importValidation, ['import_report', 'report', 'metrics']) !== undefined, 'import validation includes an import report payload or metrics');

	const validationRun = requireArtifact(artifacts, artifactSchemas, 'static_validation_run');
	assertProductionArtifact(validationRun, 'static_validation_run');
	assertRealArtifactUrl(firstValue(validationRun, ['artifact_url', 'url', 'report_url']), 'static validation run artifact URL');

	const visual = requireArtifact(artifacts, artifactSchemas, 'visual_parity_artifact');
	assertProductionArtifact(visual, 'visual_parity_artifact');
	const visualStatus = String(firstValue(visual, ['summary.status', 'status']) || '').toLowerCase();
	assert.ok(visualStatus === 'pass' || firstValue(visual, ['summary.pass', 'pass']) === true, 'visual parity artifact records pass status');
	numberEqualsZero(firstValue(visual, ['summary.mismatch_count', 'mismatch_count', 'metrics.mismatch_count']), 'visual mismatch count');
	numberEqualsZero(firstValue(visual, ['summary.max_delta_ratio', 'max_delta_ratio', 'metrics.max_delta_ratio']), 'visual max delta ratio');
	assertRealArtifactUrl(firstValue(visual, ['artifact_url', 'url', 'summary_url']), 'visual parity artifact URL');

	const findings = requireArtifact(artifacts, artifactSchemas, 'finding_packet_set');
	assertProductionArtifact(findings, 'finding_packet_set');
	assert.ok(Array.isArray(findings.packets || findings.findings || findings.groups) || Number(findings.actionable_conversion_count ?? 0) === 0, 'finding packet evidence is present');
	assertRealArtifactUrl(firstValue(findings, ['artifact_url', 'url']), 'finding packet artifact URL');
	const actionableFindingCount = Number(firstValue(findings, ['actionable_conversion_count', 'metrics.actionable_conversion_count']) ?? 0);
	const findingGroup = optionalArtifact(artifacts, artifactSchemas, 'finding_group');
	if (findingGroup) {
		assertProductionArtifact(findingGroup, 'finding_group');
		assertRealArtifactUrl(firstValue(findingGroup, ['artifact_url', 'url', 'report_url']), 'iterator finding group artifact URL');
	} else if (actionableFindingCount > 0) {
		failDependency('artifact root is missing Homeboy-emitted finding_group for actionable findings', upstreamDependencies.fanout);
	}
	const iteratorIssue = optionalArtifact(artifacts, artifactSchemas, 'iterator_upstream_issue');
	if (iteratorIssue) {
		assertProductionArtifact(iteratorIssue, 'iterator_upstream_issue');
		assertRealArtifactUrl(firstValue(iteratorIssue, ['url', 'html_url', 'issue_url']), 'iterator upstream issue URL');
	} else if (actionableFindingCount > 0) {
		failDependency('artifact root is missing iterator upstream issue evidence for actionable findings', upstreamDependencies.fanout);
	}
	const iteratorPr = optionalArtifact(artifacts, artifactSchemas, 'iterator_upstream_pull_request');
	if (iteratorPr) {
		assertProductionArtifact(iteratorPr, 'iterator_upstream_pull_request');
		assertRealArtifactUrl(firstValue(iteratorPr, ['url', 'html_url', 'pr_url', 'pull_request.url']), 'iterator upstream PR URL');
	} else if (actionableFindingCount > 0) {
		failDependency('artifact root is missing iterator upstream PR evidence for actionable findings', upstreamDependencies.fanout);
	}

	const revalidation = optionalArtifact(artifacts, artifactSchemas, 'revalidation_attempt');
	if (revalidation) {
		assertProductionArtifact(revalidation, 'revalidation_attempt');
		assert.ok(['pass', 'passed', 'succeeded', 'success'].includes(String(firstValue(revalidation, ['status', 'decision', 'result']) || '').toLowerCase()) || firstValue(revalidation, ['passed', 'success']) === true, 'revalidation evidence records success');
		assertRealArtifactUrl(firstValue(revalidation, ['artifact_url', 'url', 'report_url']), 'revalidation artifact URL');
	} else if (actionableFindingCount > 0 || iteratorPr) {
		failDependency('artifact root is missing revalidation evidence after iterator changes', upstreamDependencies.fanout);
	}

	const reviewer = optionalArtifact(artifacts, artifactSchemas, 'reviewer_gate_outcome');
	if (reviewer) {
		assertProductionArtifact(reviewer, 'reviewer_gate_outcome');
		assert.equal(String(firstValue(reviewer, ['decision', 'status']) || '').toUpperCase(), 'PASS', 'reviewer gate passes');
		assertRealArtifactUrl(firstValue(reviewer, ['artifact_url', 'url', 'report_url']), 'reviewer gate artifact URL');
	}

	const publishGate = requireArtifact(artifacts, artifactSchemas, 'static_site_publish_gate');
	assertProductionArtifact(publishGate, 'static_site_publish_gate');
	assertRealArtifactUrl(firstValue(publishGate, ['artifact_url', 'url', 'report_url']), 'publication gate artifact URL');
	for (const gateId of ['fallback_blocks', 'conversion_findings', 'visual_parity']) {
		assert.equal(publishGate.gates?.[gateId]?.passed, true, `publish gate ${gateId} passed`);
	}
	const pr = optionalArtifact(artifacts, artifactSchemas, 'static_site_pull_request');
	if (pr) {
		assertProductionArtifact(pr, 'static_site_pull_request');
		assertRealArtifactUrl(firstValue(pr, ['url', 'html_url', 'pr_url', 'pull_request.url']), 'publication PR URL');
		if (!revalidation) {
			failDependency('artifact root is missing revalidation evidence for publication PR', upstreamDependencies.fanout);
		}
	}
}

if (controllerResultPath || controllerRunSpecPath) {
	const controllerRunSpec = await readJsonFile(controllerRunSpecPath || controllerPath);
	const controllerResult = await readJsonFile(controllerResultPath);
	// Homeboy validate-proof covers generic materialization readiness; this script keeps WPSG-specific semantic assertions.
	assertRunScopedLoopId(controllerRunSpec);
	assert.equal(controllerRunSpec.metadata?.authority?.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs', 'controller run spec records its repo-owned builder');
	assert.ok(controllerRunSpec.workflows?.every((workflow) => workflow.inputs?.policy_results?.['wpsg-complexity-policy']), 'controller run spec carries WPSG complexity policy results on materialized workflows');
	assert.ok(controllerRunSpec.metadata?.policy_materialization?.['wpsg-complexity-policy'], 'controller run spec records Homeboy policy materialization metadata');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'fallback_blocks'), 'controller run spec keeps fallback block metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'conversion_findings'), 'controller run spec keeps conversion finding metrics');
	assert.ok(controllerRunSpec.metrics?.some((metric) => metric.metric_id === 'visual_parity'), 'controller run spec keeps visual parity metrics');
	assert.ok(controllerResult.loop_id || controllerResult.data?.loop_id || controllerResult.value?.loop_id, 'controller result returns a durable loop id');
	assertNoToolCallPlaceholderArtifacts(controllerResult);
	const loopId = controllerResult.loop_id || controllerResult.data?.loop_id || controllerResult.value?.loop_id;
	await assertControllerEventProof(controllerRunSpec, loopId);
	await assertControllerArtifactProof(controllerRunSpec);
	console.log('site generation loop semantic proof passed');
	process.exit(0);
}

if (proofMode !== 'fixture') {
	fail('legacy aggregate/plan proof is fixture-only; production proof requires controller-result, controller-run-spec, controller event, and Homeboy artifact evidence');
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
      schema: 'blocks-engine/php-transformer/site-artifact/v1',
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
  assert.match(validationWorkloadJson, /base64_decode/, 'static validation embeds a website artifact payload for the ability bridge');
  assert.match(workflow, /Build SSI finding packets/, 'static validation builds SSI finding packets');
  assert.match(workflow, /Build PHP transformer iterator fanout declaration/, 'static validation declares iterator fanout for Homeboy controller primitives');
  assert.doesNotMatch(workflow, /gh workflow run php-transformer-iterator\.yml/, 'static validation does not dispatch the iterator through a workflow-run boundary');
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
