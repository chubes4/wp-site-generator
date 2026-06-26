#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJsonOrNull, writeJsonFile } from './lib/ci-runtime-utils.mjs';

const repoRoot = process.cwd();
const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const actionId = process.env.HOMEBOY_LOOP_ACTION_ID || 'static-validation';
const actionRoot = path.join(repoRoot, '.ci', 'homeboy-controller-actions', sanitizeSegment(actionId));
const candidatePath = path.join(actionRoot, 'static-site-candidate.json');
const validationSettingsPath = path.join(actionRoot, 'static-validation-settings.json');
const findingPacketsPath = path.join(actionRoot, 'finding-packets.json');

await mkdir(actionRoot, { recursive: true });

const commandInput = JSON.parse(await readFile(inputPath, 'utf8'));
const candidateEnvelope = commandInput?.request?.inputs?.artifacts?.static_site_candidate
	|| commandInput?.request?.inputs?.static_site_candidate;
const candidatePayload = candidateEnvelope?.payload || candidateEnvelope?.static_site_candidate || candidateEnvelope;
if (!candidatePayload || typeof candidatePayload !== 'object') {
	throw new Error('static-validation requires hydrated static_site_candidate input.');
}

await writeJsonFile(candidatePath, candidatePayload);

const settingsResult = runNode('build static validation settings', [
	'.github/scripts/build-static-validation-settings.mjs',
	'--candidate',
	candidatePath,
	'--output',
	validationSettingsPath,
]);
if (settingsResult.status !== 0) {
	throw new Error(`build-static-validation-settings failed: ${settingsResult.stderr || settingsResult.stdout}`);
}

const settings = JSON.parse(await readFile(validationSettingsPath, 'utf8'));
const site = settings.site || candidatePayload.site_id || candidatePayload.slug || sanitizeSegment(actionId);
const visualRoot = process.env.VISUAL_PARITY_OUTPUT || 'visual-parity-artifacts';
const visualDir = path.join(repoRoot, visualRoot, site);
const visualSummaryPath = path.join(visualDir, 'summary.json');
const visualDiffPath = path.join(visualDir, 'visual-diff.json');
const importReadyPath = path.join(visualDir, 'import-ready.json');

const visualResult = runNode('run static visual parity', ['.github/scripts/static-visual-parity.mjs'], {
	SITE: site,
	STATIC_SITE_CANDIDATE_PATH: candidatePath,
	VISUAL_PARITY_OUTPUT: visualRoot,
});

const findingResult = runNode('build SSI finding packets', ['.github/scripts/build-ssi-finding-packets.mjs'], {
	SITE: site,
	STATIC_SITE_CANDIDATE_PATH: candidatePath,
	SOURCE_REPO: process.env.SOURCE_REPO || 'chubes4/wp-site-generator',
	SOURCE_HEAD_SHA: process.env.SOURCE_HEAD_SHA || '',
	VALIDATION_RUN_ID: `${process.env.HOMEBOY_LOOP_ID || 'controller'}:${actionId}`,
	FINDING_PACKETS_PATH: findingPacketsPath,
	VISUAL_SUMMARY_PATH: visualSummaryPath,
	VISUAL_DIFF_PATH: visualDiffPath,
	IMPORT_READY_PATH: importReadyPath,
	VISUAL_OUTCOME: visualResult.status === 0 ? 'success' : 'failed',
});
if (findingResult.status !== 0) {
	throw new Error(`build-ssi-finding-packets failed: ${findingResult.stderr || findingResult.stdout}`);
}

const importReady = await readJsonOrNull(importReadyPath) || {};
const visualSummary = await readJsonOrNull(visualSummaryPath) || {};
const visualDiff = await readJsonOrNull(visualDiffPath) || {};
const findingPackets = await readJsonOrNull(findingPacketsPath) || { packets: [] };
const importSummary = importReady.import_report_summary || visualSummary.import_report_summary || null;
const fallbackBlocks = numberValue(importSummary?.fallback_blocks ?? importSummary?.fallback_block_count ?? importSummary?.ssi_fallback_count);
const conversionFindings = Array.isArray(findingPackets.packets) ? findingPackets.packets.length : 0;
const visualPass = visualResult.status === 0 && (visualSummary.summary?.pass ?? visualSummary.pass ?? visualDiff.pass ?? true) !== false;

const importValidationResult = {
	schema: 'wp-site-generator/ImportValidationResult/v1',
	status: visualResult.status === 0 ? 'pass' : 'fail',
	passed: visualResult.status === 0,
	site,
	metrics: {
		fallback_blocks: fallbackBlocks,
		conversion_findings: conversionFindings,
	},
	import_report: importSummary || importReady.import_result || importReady,
	artifact_url: importReadyPath,
};
const visualParityArtifact = {
	schema: 'wp-site-generator/VisualParityArtifact/v1',
	status: visualPass ? 'pass' : 'fail',
	pass: visualPass,
	summary: {
		status: visualPass ? 'pass' : 'fail',
		pass: visualPass,
		mismatch_count: numberValue(visualSummary.summary?.mismatch_count ?? visualSummary.mismatch_count ?? visualDiff.mismatch_count),
		max_delta_ratio: numberValue(visualSummary.summary?.max_delta_ratio ?? visualSummary.max_delta_ratio ?? visualDiff.max_delta_ratio ?? visualDiff.mismatch_ratio),
	},
	artifact_url: visualSummaryPath,
	visual_diff_path: existsSync(visualDiffPath) ? visualDiffPath : '',
};
const staticValidationRun = {
	schema: 'homeboy/Run/v1',
	status: visualResult.status === 0 ? 'completed' : 'completed_with_findings',
	success: visualResult.status === 0,
	site,
	artifact_url: validationSettingsPath,
	commands: [
		commandEvidence('build-static-validation-settings', settingsResult),
		commandEvidence('static-visual-parity', visualResult),
		commandEvidence('build-ssi-finding-packets', findingResult),
	],
};
const findingPacketSet = {
	schema: 'wp-site-generator/FindingPacketSet/v1',
	...findingPackets,
	actionable_conversion_count: conversionFindings,
	artifact_url: findingPacketsPath,
};

await writeJsonFile(outputPath, {
	artifacts: {
		static_validation_run: staticValidationRun,
		import_validation_result: importValidationResult,
		visual_parity_artifact: visualParityArtifact,
		finding_packet_set: findingPacketSet,
	},
});

function runNode(label, args, env = {}) {
	return spawnSync(process.execPath, args, {
		cwd: repoRoot,
		encoding: 'utf8',
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

function commandEvidence(label, result) {
	return {
		label,
		status: result.status,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

function numberValue(value, fallback = 0) {
	const number = Number(value ?? fallback);
	return Number.isFinite(number) ? number : fallback;
}

function sanitizeSegment(value) {
	return String(value || 'action').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'action';
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}
