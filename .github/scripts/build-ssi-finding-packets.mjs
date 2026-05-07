#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const schemaVersion = 1;
const site = requiredEnv('SITE');
const sourceRepo = requiredEnv('SOURCE_REPO');
const sourcePr = process.env.SOURCE_PR || '';
const sourceHeadSha = process.env.SOURCE_HEAD_SHA || '';
const sourceBranch = process.env.SOURCE_BRANCH || '';
const validationRunId = process.env.VALIDATION_RUN_ID || '';
const benchPath = process.env.BENCH_PATH || 'homeboy-ci-results/bench.json';
const outputPath = process.env.FINDING_PACKETS_PATH || 'homeboy-ci-results/finding-packets.json';
const candidateRepo = process.env.CANDIDATE_REPO || 'chubes4/static-site-importer';

const artifactNames = {
	ssi_validation: `ssi-validation-${site}`,
	visual_parity: `visual-parity-${site}`,
	finding_packets_file: path.basename(outputPath),
};

const packets = await buildPackets();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packets, null, 2)}\n`);

async function buildPackets() {
	let bench;
	try {
		bench = JSON.parse(await readFile(benchPath, 'utf8'));
	} catch {
		return [];
	}

	const summary = findSsiSummary(bench);
	if (!summary) {
		return [];
	}

	const packets = [];
	for (const diagnostic of asArray(summary.fallback_diagnostics)) {
		packets.push(packetFromFallbackDiagnostic(diagnostic));
	}
	for (const finding of asArray(summary.findings)) {
		packets.push(packetFromFinding(finding));
	}

	return dedupePackets(packets);
}

function findSsiSummary(bench) {
	const scenarios = asArray(bench?.data?.results?.scenarios);
	const scenario = scenarios.find((item) => item?.id === 'ssi-import');

	return scenario?.metadata?.import_report_summary || null;
}

function packetBase() {
	return {
		schema_version: schemaVersion,
		site,
		source_repo: sourceRepo,
		source_pr: normalizeNumber(sourcePr),
		source_head_sha: sourceHeadSha,
		source_branch: sourceBranch,
		validation_run_id: normalizeNumber(validationRunId),
		candidate_repo: candidateRepo,
		artifact_names: artifactNames,
	};
}

function packetFromFallbackDiagnostic(diagnostic) {
	const blockName = text(diagnostic?.block_name);

	return {
		...packetBase(),
		kind: blockName.toLowerCase() === 'core/html' ? 'core_html' : 'fallback',
		path: text(diagnostic?.path),
		preview: text(diagnostic?.preview),
		selector: text(diagnostic?.selector),
		excerpt: text(diagnostic?.excerpt),
		source_html_preview: text(diagnostic?.source_html_preview),
		block_name: blockName,
		converter: text(diagnostic?.converter),
		stage: text(diagnostic?.stage),
		reason: text(diagnostic?.reason),
	};
}

function packetFromFinding(finding) {
	return {
		...packetBase(),
		kind: text(finding?.kind),
		path: text(finding?.path),
		preview: text(finding?.preview),
		selector: text(finding?.selector),
		excerpt: text(finding?.excerpt),
		source_html_preview: text(finding?.source_html_preview),
		block_name: text(finding?.block_name),
		converter: text(finding?.converter),
		stage: text(finding?.stage),
		reason: text(finding?.reason),
	};
}

function dedupePackets(packets) {
	const seen = new Set();
	const deduped = [];

	for (const packet of packets) {
		const key = JSON.stringify([
			packet.kind,
			packet.path,
			packet.preview,
			packet.selector,
			packet.excerpt,
			packet.source_html_preview,
			packet.block_name,
			packet.converter,
			packet.stage,
			packet.reason,
		]);

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		deduped.push(packet);
	}

	return deduped;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeNumber(value) {
	if (value === '') {
		return '';
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
}

function text(value) {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}
