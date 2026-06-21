#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runtimeWorkflowBuilderExecution } from './lib/ci-runtime-utils.mjs';

const inputPath = process.env.FINDING_GROUPS_PATH || process.argv[2] || 'homeboy-ci-results/grouped-finding-packets.json';
const outputPath = process.env.FANOUT_CONFIG_PATH || process.argv[3] || 'homeboy-ci-results/php-transformer-iterator-fanout-config.json';

const grouped = JSON.parse(await readFile(inputPath, 'utf8'));
const groups = Array.isArray(grouped?.groups) ? grouped.groups : [];

const config = {
	schema: 'homeboy/generic-fanout-reconcile-config/v1',
	orchestrator: {
		id: 'wp-site-generator-php-transformer-iterator',
		source_repo: process.env.SOURCE_REPO || '',
		source_pr: process.env.SOURCE_PR || '',
		source_head_sha: process.env.SOURCE_HEAD_SHA || '',
		validation_run_id: process.env.VALIDATION_RUN_ID || '',
		artifact_name: process.env.ARTIFACT_NAME || '',
		visual_artifact_name: process.env.VISUAL_ARTIFACT_NAME || '',
	},
	groups: groups.map((group, index) => ({
		key: group.group_id || group.owner_repo || group.candidate_repo || `finding-group-${index + 1}`,
		items: [group],
	})),
	task_request_template: {
		id: 'php-transformer-iterator-{{group.key}}',
		group_key: '{{group.key}}',
		item_ids: '{{group.item_ids}}',
		finding_group: '{{group.items.0}}',
		inputs: {
			finding_group: '{{group.items.0}}',
		},
		instructions: 'Run the PHP transformer iterator for {{group.key}} with {{group.item_count}} grouped finding artifact(s).',
	},
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
