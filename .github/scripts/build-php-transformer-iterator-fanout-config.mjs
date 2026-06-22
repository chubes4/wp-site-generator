#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runtimeWorkflowBuilderExecution } from './lib/ci-runtime-utils.mjs';

const inputPath = process.env.FINDING_GROUPS_PATH || process.argv[2] || 'homeboy-ci-results/grouped-finding-packets.json';
const outputPath = process.env.FANOUT_CONFIG_PATH || process.argv[3] || 'homeboy-ci-results/php-transformer-iterator-fanout-config.json';

const grouped = JSON.parse(await readFile(inputPath, 'utf8'));
const groups = Array.isArray(grouped?.groups) ? grouped.groups : [];

const config = {
	schema: 'wp-site-generator/php-transformer-iterator-fanout-input/v1',
	fanout_id: 'wp-site-generator-php-transformer-iterator',
	primitive: {
		provider: 'homeboy',
		command: 'agent-task fanout submit-batch',
		input_contract: 'homeboy/agent-task-fanout-input/v1',
		status_command: 'agent-task fanout status',
		artifacts_command: 'agent-task fanout artifacts',
		controller_workflow: 'iterator',
	},
	orchestrator: {
		id: 'wp-site-generator-php-transformer-iterator',
		source_repo: process.env.SOURCE_REPO || '',
		source_pr: process.env.SOURCE_PR || '',
		source_head_sha: process.env.SOURCE_HEAD_SHA || '',
		validation_run_id: process.env.VALIDATION_RUN_ID || '',
		artifact_name: process.env.ARTIFACT_NAME || '',
		visual_artifact_name: process.env.VISUAL_ARTIFACT_NAME || '',
	},
	packets: groups.map((group, index) => {
		const key = group.group_id || group.owner_repo || group.candidate_repo || `finding-group-${index + 1}`;
		return {
			task_id: `php-transformer-iterator-${key}`,
			group_key: key,
			inputs: { finding_group: group },
			metadata: {
				item_ids: Array.isArray(group.item_ids) ? group.item_ids : [],
				finding_group: group,
			},
			instructions: `Run the PHP transformer iterator for ${key} with ${group.count || 1} grouped finding artifact(s).`,
		};
	}),
	...runtimeWorkflowBuilderExecution({
		kind: 'wpsg-php-transformer-iterator',
		workflowBuilder: 'bundles/php-transformer-iterator-agent/scripts/build-agent-iterator-workflow.mjs',
		visual_artifact_dir: '.ci/visual-parity',
	}),
	summary: {
		source_schema_version: grouped?.schema_version || null,
		packet_count: grouped?.packet_count || 0,
		actionable_packet_count: grouped?.actionable_packet_count || 0,
		candidate_repos: Array.isArray(grouped?.candidate_repos) ? grouped.candidate_repos : [],
	},
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
