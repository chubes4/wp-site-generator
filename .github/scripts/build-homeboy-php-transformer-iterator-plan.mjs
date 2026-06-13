#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = process.env.GITHUB_WORKSPACE || process.cwd();
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const repository = process.env.GITHUB_REPOSITORY || process.env.SOURCE_REPO || 'chubes4/wp-site-generator';
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const workflowPath = args.get('--workflow') || process.env.DATAMACHINE_WORKFLOW_PATH || '.ci/datamachine-iterator-workflow.json';
const outputPath = args.get('--output') || process.env.HOMEBOY_ITERATOR_PLAN_PATH || path.join(root, '.ci', 'php-transformer-iterator.agent-task-plan.json');
const artifactsRoot = process.env.HOMEBOY_ARTIFACT_ROOT || path.join(root, '.ci', 'homeboy-agent-task-artifacts');
const sourcePr = process.env.SOURCE_PR || args.get('--source-pr') || '';
const sourceHeadSha = process.env.SOURCE_HEAD_SHA || args.get('--source-head-sha') || '';
const validationRunId = process.env.VALIDATION_RUN_ID || args.get('--validation-run-id') || '';
const wpCodeboxBin = process.env.HOMEBOY_WP_CODEBOX_BIN || '';

const ci = (name) => path.join(root, '.ci', name);
const executorConfig = {
	execution_kind: 'datamachine_bundle',
	provider: 'openai',
	model,
	provider_plugin_paths: [ci('ai-provider-for-openai')],
	agents_api: ci('agents-api'),
	data_machine: ci('data-machine'),
	data_machine_code: ci('data-machine-code'),
	homeboy_extensions: path.join(ci('homeboy-extensions'), 'wordpress'),
	bundle_host_path: path.join(root, 'bundles/php-transformer-iterator-agent'),
	bundle_path: '/workspace/wp-site-generator/bundles/php-transformer-iterator-agent',
	agent_slug: 'php-transformer-iterator-agent',
	pipeline_slug: 'php-transformer-iterator-pipeline',
	flow_slug: 'php-transformer-iterator-manual-flow',
	target_repo: repository,
	prompt: 'Run the static-site validation iterator now. The prebuilt workflow embeds grouped finding context; process it as the source of truth.',
	success_requires_pr: true,
	success_completion_outcomes: ['pull_request_path'],
	max_turns: 24,
	step_budget: 20,
	time_budget_ms: 600000,
	task_timeout_seconds: 900,
	engine_data_outputs: {
		upstream_action_url: 'metadata.engine_data.php_transformer_iterator.upstream_action_url',
		source_callback_url: 'metadata.engine_data.php_transformer_iterator.source_callback_url',
	},
	tool_recorders: [{ tool: 'create_github_pull_request' }],
	extra_required_abilities: [
		'datamachine-code/create-github-pull-request',
		'datamachine-code/upsert-github-pull-review-comment',
	],
	execute_workflow_path: workflowPath,
	transcript_artifact_name: `php-transformer-iterator-transcript-${runId}`,
	secret_env: ['OPENAI_API_KEY', 'GITHUB_TOKEN'],
	artifacts: path.join(artifactsRoot, 'php-transformer-iterator-agent', `php-transformer-iterator-transcript-${runId}`),
};

if (wpCodeboxBin) {
	executorConfig.wp_codebox_bin = wpCodeboxBin;
}

const plan = {
	schema: 'homeboy/agent-task-plan/v1',
	plan_id: `php-transformer-iterator-${runId}`,
	tasks: [
		{
			schema: 'homeboy/agent-task-request/v1',
			task_id: 'php-transformer-iterator',
			group_key: 'php-transformer-iterator',
			parent_plan_id: `php-transformer-iterator-${runId}`,
			executor: {
				backend: 'codebox',
				model,
				config: executorConfig,
			},
			instructions: 'Run the PR-first Static Site Importer transformer iterator against the grouped finding workflow and comment back to the source generated-site PR.',
			inputs: {
				title: `Run SSI iterator${sourcePr ? ` for PR #${sourcePr}` : ''}`,
				source_repo: repository,
				source_pr: sourcePr,
				source_head_sha: sourceHeadSha,
				validation_run_id: validationRunId,
			},
			limits: { task_timeout_seconds: 900 },
			expected_artifacts: ['datamachine-transcript'],
		},
	],
	options: {
		max_concurrency: 1,
		resource_budget: { max_active_units: 1, default_task_units: 1 },
		retry: { max_attempts: 0 },
	},
	metadata: {
		source: 'wp-site-generator php-transformer-iterator native adapter',
		generated_by: '.github/scripts/build-homeboy-php-transformer-iterator-plan.mjs',
		workflow_path: workflowPath,
		source_repo: repository,
		source_pr: sourcePr,
		source_head_sha: sourceHeadSha,
		validation_run_id: validationRunId,
	},
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(outputPath);

function parseArgs(argv) {
	const parsed = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}
		const next = argv[i + 1];
		parsed.set(arg, next && !next.startsWith('--') ? next : '1');
		if (next && !next.startsWith('--')) {
			i += 1;
		}
	}
	return parsed;
}
