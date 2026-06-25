#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const input = JSON.parse(await readFile(inputPath, 'utf8'));

const candidate = requireArtifact(input.controller, 'static_site_candidate');
const validation = requireArtifact(input.controller, 'import_validation_result');
const publishGate = requireArtifact(input.controller, 'static_site_publish_gate');
const publishAllowed = publishGate.publish_allowed === true;

const pullRequest = {
	schema: 'github/PullRequest/v1',
	status: publishAllowed ? 'ready_for_publication' : 'blocked_by_publish_gate',
	mode: 'deterministic_loop_dry_run',
	publish_allowed: publishAllowed,
	title: candidate.proposed_pr_title || candidate.pr_title || candidate.proposed?.pr_title || `Generated static site: ${candidate.site_id || candidate.slug || candidate.site_slug || 'candidate'}`,
	body: candidate.pr_body || candidate.proposed_pr_body || '',
	branch: candidate.proposed_branch || candidate.branch || candidate.proposed?.branch || null,
	url: null,
	number: null,
	validation_status: validation.status || '',
	static_site_candidate: candidate.site_id || candidate.slug || candidate.site_slug || candidate.id || '',
	note: 'Publication is represented as a dry-run artifact during headless validation; no pull request is created by this loop action.',
};

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/static-publication-loop-action-result/v1',
	success: true,
	artifacts: {
		static_site_pull_request: pullRequest,
	},
}, null, 2)}\n`);

function requireArtifact(controller, artifactId) {
	const artifact = findArtifact(controller, artifactId);
	if (!artifact) {
		throw new Error(`static-publication requires a ${artifactId} artifact from an earlier loop action.`);
	}
	return artifact;
}

function findArtifact(controller, artifactId) {
	for (const lineage of [...(controller?.task_lineage || [])].reverse()) {
		const value = artifactFromOutputs(lineage?.outputs, artifactId);
		if (value) {
			return value.payload || value;
		}
	}
	for (const event of [...(controller?.history || [])].reverse()) {
		const outcomes = event?.payload?.execution?.result?.aggregate?.outcomes || [];
		for (const outcome of [...outcomes].reverse()) {
			const value = artifactFromOutputs(outcome?.outputs, artifactId) || artifactFromOutputs(outcome?.metadata, artifactId);
			if (value) {
				return value.payload || value;
			}
		}
		const direct = artifactFromOutputs(event?.payload?.execution?.result?.result, artifactId) || artifactFromOutputs(event?.payload?.execution?.result, artifactId);
		if (direct) {
			return direct.payload || direct;
		}
	}
	return null;
}

function artifactFromOutputs(outputs, artifactId) {
	const artifacts = outputs?.artifacts || outputs?.typed_artifacts || outputs?.typedArtifacts || {};
	return artifacts[artifactId];
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}
