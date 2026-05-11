#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = process.env.FINDING_GROUPS_PATH || 'php-transformer-iterator-input.json';
const outputPath = process.env.FANOUT_ITEMS_PATH || 'php-transformer-iterator-fanout-items.json';

const sourceRepo = requiredEnv('SOURCE_REPO');
const sourcePr = requiredEnv('SOURCE_PR');
const sourceHeadSha = process.env.SOURCE_HEAD_SHA || '';
const validationRunId = requiredEnv('VALIDATION_RUN_ID');

const groups = JSON.parse(await readFile(inputPath, 'utf8'));
const items = (Array.isArray(groups.groups) ? groups.groups : []).map((group, index) => {
	const id = `${String(index + 1).padStart(2, '0')}-${slug([
		group.candidate_repo,
		group.kind,
		group.converter,
		group.block_name,
		group.reason,
	].filter(Boolean).join('-'))}`;

	const payload = {
		source_repo: sourceRepo,
		source_pr: sourcePr,
		source_head_sha: sourceHeadSha,
		validation_run_id: validationRunId,
		finding_groups: {
			schema_version: groups.schema_version || 2,
			packet_count: groups.packet_count || 0,
			actionable_packet_count: groups.actionable_packet_count || 0,
			deduped_packet_count: groups.deduped_packet_count || 0,
			group_count: 1,
			candidate_repos: [group.candidate_repo].filter(Boolean),
			groups: [group],
		},
	};

	return {
		id,
		candidate_repo: group.candidate_repo || '',
		kind: group.kind || '',
		prompt: `Run the PHP transformer iterator now. Process exactly one finding group in this item.\n\n${JSON.stringify(payload, null, 2)}`,
	};
});

if (items.length === 0) {
	throw new Error(`No finding groups found in ${inputPath}.`);
}

await writeFile(outputPath, `${JSON.stringify(items, null, 2)}\n`);

function requiredEnv(name) {
	const value = process.env[name] || '';
	if (value.trim() === '') {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function slug(value) {
	const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return normalized.slice(0, 72) || 'finding';
}
