#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-loop-typed-artifacts-'));
const generatedControllerPath = path.join(tempDir, 'static-site-generation-loop.controller.json');

const typedArtifacts = {
	concept_packet: {
		schema: 'wp-site-generator/ConceptPacket/v1',
		artifact: 'ConceptPacket',
		workflows: ['store-idea', 'website-idea'],
		pipelines: [
			'bundles/store-idea-agent/pipelines/store-idea-artifact-pipeline.json',
			'bundles/website-idea-agent/pipelines/website-idea-artifact-pipeline.json',
		],
	},
	design_packet: {
		schema: 'wp-site-generator/DesignPacket/v1',
		artifact: 'DesignPacket',
		workflows: ['design-store', 'design-website'],
		pipelines: ['bundles/design-agent/pipelines/design-artifact-pipeline.json'],
	},
	static_site_candidate: {
		schema: 'wp-site-generator/StaticSiteCandidate/v1',
		artifact: 'StaticSiteCandidate',
		workflows: ['static-store', 'static-site'],
		pipelines: ['bundles/static-site-agent/pipelines/static-site-candidate-pipeline.json'],
	},
};

async function readJson(relativePath) {
	return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function assertTypedArtifactEnvelope(envelope, artifactId, contract) {
	assert.equal(envelope.schema, 'homeboy/agent-task-typed-artifact/v1', `${artifactId} uses the Homeboy typed-artifact envelope`);
	assert.equal(envelope.output_key, artifactId, `${artifactId} envelope output key matches the loop artifact id`);
	assert.equal(envelope.artifact, contract.artifact, `${artifactId} envelope names the payload artifact`);
	assert.equal(envelope.payload_schema, contract.schema, `${artifactId} envelope points at the WPSG payload schema`);
	assert.ok(envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload), `${artifactId} envelope carries a payload object`);
}

try {
	const buildResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-ssi-loop-controller.mjs', '--output', generatedControllerPath], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: { ...process.env, HOMEBOY_AGENT_RUNTIME_TASK_ABILITY: 'homeboy/run-runtime-package' },
	});
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const generatedController = JSON.parse(await readFile(generatedControllerPath, 'utf8'));
	const checkedInController = await readJson('.github/homeboy/controllers/static-site-generation-loop.controller.json');
	assert.deepEqual(checkedInController.artifacts, generatedController.artifacts, 'checked-in controller artifact declarations match the builder output');

	const fixtureEnvelopes = await readJson('tests/fixtures/wpsg-loop-typed-artifact-envelopes.json');
	const artifactsById = new Map(generatedController.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
	const workflowsById = new Map(generatedController.workflows.map((workflow) => [workflow.workflow_id, workflow]));
	assert.ok(generatedController.abilities.every((ability) => ability.ability_id), 'deterministic controller generation keeps non-empty ability declarations');

	for (const [artifactId, contract] of Object.entries(typedArtifacts)) {
		const declaration = artifactsById.get(artifactId);
		assert.ok(declaration, `${artifactId} is declared in the loop spec`);
		assert.equal(declaration.kind, contract.schema, `${artifactId} declares the WPSG payload schema`);
		assert.equal(declaration.required, true, `${artifactId} is required loop evidence`);
		assert.deepEqual(declaration.typed_artifact, {
			schema: 'homeboy/agent-task-typed-artifact/v1',
			output_key: artifactId,
			payload_schema: contract.schema,
		}, `${artifactId} declares the typed-artifact envelope Homeboy must collect`);

		assertTypedArtifactEnvelope(fixtureEnvelopes[artifactId], artifactId, contract);

		for (const workflowId of contract.workflows) {
			const workflow = workflowsById.get(workflowId);
			assert.ok(workflow, `${workflowId} workflow exists`);
			assert.ok(workflow.emits.includes(artifactId), `${workflowId} emits ${artifactId}`);
			assert.ok(workflow.artifacts.includes(artifactId), `${workflowId} artifact handoff includes ${artifactId}`);
			assert.equal(workflow.runtime_execution?.kind, 'bundle', `${workflowId} declares a Homeboy-owned bundle execution input`);
			assert.equal(workflow.runtime_execution?.input?.options?.wait_for_completion, true, `${workflowId} places wait_for_completion in runtime-package options`);
			assert.equal(workflow.runtime_execution?.input?.options?.time_budget_ms, 1200000, `${workflowId} places time_budget_ms in runtime-package options`);
			assert.equal(workflow.runtime_execution?.input?.input?.wait_for_completion, undefined, `${workflowId} does not mix wait_for_completion into domain input`);
			assert.equal(workflow.runtime_execution?.input?.input?.time_budget_ms, undefined, `${workflowId} does not mix time_budget_ms into domain input`);
		}

		for (const pipelinePath of contract.pipelines) {
			const pipeline = await readJson(pipelinePath);
			const requiredOutputs = pipeline.steps.flatMap((step) => step.step_config?.completion_assertions?.required_artifact_outputs || []);
			assert.ok(requiredOutputs.some((output) => output.output_key === artifactId && output.schema === contract.schema && output.artifact === contract.artifact), `${pipelinePath} requires ${artifactId}`);
			const pipelineText = await readFile(path.join(repoRoot, pipelinePath), 'utf8');
			assert.match(pipelineText, /emit_typed_artifact/, `${pipelinePath} requires typed-artifact tool emission`);
			assert.match(pipelineText, new RegExp(`output_key=${artifactId}`), `${pipelinePath} documents the ${artifactId} output key`);
			assert.match(pipelineText, new RegExp(`schema=${contract.schema}`), `${pipelinePath} documents the ${artifactId} schema`);
		}
	}

	for (const forbiddenKey of ['controller_state', 'provider_selection', 'dispatch_provider', 'runtime_substrate']) {
		assert.equal(generatedController[forbiddenKey], undefined, `WPSG loop spec does not own ${forbiddenKey}`);
	}
	assert.doesNotMatch(JSON.stringify(generatedController), /wp[_-]?codebox|codebox_(?:result|envelope|payload)|playground_(?:url|result)/i, 'WPSG loop spec does not include private Codebox runtime result fields');

	console.log('WPSG loop typed artifact contract tests passed');
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
