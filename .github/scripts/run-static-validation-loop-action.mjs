#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildWebsiteArtifactFromSource, resolveStaticSiteCandidateSource } from './lib/static-site-candidate.mjs';
import { buildSsiValidationSettings, loadSsiStackManifest, loadWordPressRuntimeSettingsDescriptor } from './lib/ssi-stack-runtime.mjs';
import { evaluateStaticSitePublishGateContract, validationMetricValue } from './lib/ssi-metrics.mjs';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const repoRoot = process.cwd();
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const outputRoot = path.join(repoRoot, '.homeboy', 'static-validation', input.action_id || 'action');
await mkdir(outputRoot, { recursive: true });

const candidate = findArtifact(input.controller, 'static_site_candidate');
if (!candidate) {
	throw new Error('static-validation requires a static_site_candidate artifact from an earlier loop action.');
}
if (candidateIsBlocked(candidate)) {
	throw new Error('static-validation requires a generated static_site_candidate; received a blocked or missing-input candidate.');
}

const candidatePath = path.join(outputRoot, 'static-site-candidate.json');
await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

const site = slug(candidate.site_id || candidate.site_slug || candidate.slug || candidate.id || `static-validation-${input.action_id || 'site'}`);
const candidateSource = await resolveStaticSiteCandidateSource({
	repoRoot,
	site,
	candidatePath,
	materializedRoot: path.join(outputRoot, 'materialized'),
});
const websiteArtifact = await buildWebsiteArtifactFromSource(candidateSource);
const manifest = await loadSsiStackManifest('');
const runtimeSettingsDescriptor = await loadWordPressRuntimeSettingsDescriptor('.github/homeboy/wordpress-runtime/ssi-validation-settings.descriptor.json');
const lane = candidate.lane || candidate.site_kind || candidate.target_lane || 'wordpress';
const { settings, workloads } = buildSsiValidationSettings({ site: candidateSource.site, lane, manifest, websiteArtifact, runtimeSettingsDescriptor });

const settingsPath = path.join(outputRoot, 'static-validation-settings.json');
const websiteArtifactPath = path.join(outputRoot, 'website-artifact.json');
const benchPath = path.join(outputRoot, 'bench.json');
const benchStdoutPath = path.join(outputRoot, 'bench.stdout.log');
const benchStderrPath = path.join(outputRoot, 'bench.stderr.log');
const validationReportPath = path.join(outputRoot, 'validation-report.md');
const findingPacketsPath = path.join(outputRoot, 'finding-packets.json');
await writeFile(settingsPath, `${JSON.stringify({ site: candidateSource.site, lane, candidate_source: candidateSource, settings, workloads, stack_manifest: manifest }, null, 2)}\n`);
await writeFile(websiteArtifactPath, `${JSON.stringify(websiteArtifact, null, 2)}\n`);

const benchResult = runHomeboyBench({ settings, workloads, benchPath });
await writeFile(benchStdoutPath, benchResult.stdout || '');
await writeFile(benchStderrPath, benchResult.stderr || '');
if (benchResult.status !== 0) {
	throw new Error(`homeboy bench failed during static validation; see ${benchStderrPath}`);
}
const bench = JSON.parse(await readFile(benchPath, 'utf8'));
const ssiScenario = findSsiScenario(bench);
if (!ssiScenario) {
	throw new Error('homeboy bench did not produce an ssi-import scenario; static validation cannot classify importer quality.');
}
const metrics = ssiScenario.metrics && typeof ssiScenario.metrics === 'object' ? ssiScenario.metrics : {};
const importReportSummary = ssiScenario.metadata?.import_report_summary || null;

const report = runNodeScript('.github/scripts/render-ssi-validation-report.mjs', [], {
	SITE: candidateSource.site,
	BENCH_PATH: benchPath,
	SSI_STACK_MANIFEST_PATH: '',
});
await writeFile(validationReportPath, report.stdout || '');

const findingResult = runNodeScript('.github/scripts/build-ssi-finding-packets.mjs', [], {
	SITE: candidateSource.site,
	BENCH_PATH: benchPath,
	FINDING_PACKETS_PATH: findingPacketsPath,
	SOURCE_REPO: process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator',
	SOURCE_BRANCH: process.env.GITHUB_REF_NAME || '',
	SOURCE_HEAD_SHA: process.env.GITHUB_SHA || '',
	VALIDATION_RUN_ID: process.env.WPSG_REPLAY_ID || process.env.HOMEBOY_LOOP_ID || '',
	STATIC_SITE_CANDIDATE_PATH: candidatePath,
	SSI_STACK_MANIFEST_PATH: '',
});
if (findingResult.status !== 0) {
	throw new Error(`finding packet generation failed: ${findingResult.stderr || findingResult.stdout}`);
}
const findingPackets = JSON.parse(await readFile(findingPacketsPath, 'utf8'));
const actionableFindingCount = Array.isArray(findingPackets) ? findingPackets.length : Number(findingPackets.actionable_conversion_count || 0);

const visualParityArtifact = loadVisualParityArtifact(outputRoot);
const gate = evaluateStaticSitePublishGateContract({
	validation: { metrics, conversion_findings: { actionable: actionableFindingCount } },
	visualParity: visualParityArtifact,
});

const importValidationResult = {
	schema: 'wp-site-generator/ImportValidationResult/v1',
	artifact_url: benchPath,
	status: 'imported',
	metrics: {
		...metrics,
		fallback_blocks: validationMetricValue({ metrics }, 'ssi_fallback_count'),
		fallback_block_count: validationMetricValue({ metrics }, 'ssi_fallback_count'),
		conversion_findings: actionableFindingCount,
	},
	import_report: importReportSummary,
	bench_scenario: ssiScenario,
	website_artifact: websiteArtifactPath,
	workload_count: workloads.length,
};
const findingPacketSet = {
	schema: 'wp-site-generator/FindingPacketSet/v1',
	artifact_url: findingPacketsPath,
	packets: Array.isArray(findingPackets) ? findingPackets : findingPackets.packets || [],
	actionable_conversion_count: actionableFindingCount,
};
const staticValidationRun = {
	schema: 'homeboy/Run/v1',
	artifact_url: benchPath,
	status: gate.failed_gates.length === 0 ? 'passed' : 'failed',
	mode: 'homeboy_bench_wordpress_runtime',
	bench_output: benchPath,
	validation_report: validationReportPath,
	workloads: workloads.map((workload) => workload.id).filter(Boolean),
};

await writeFile(outputPath, `${JSON.stringify({
	schema: 'wp-site-generator/static-validation-loop-action-result/v1',
	success: true,
	artifacts: {
		static_validation_run: staticValidationRun,
		import_validation_result: importValidationResult,
		visual_parity_artifact: visualParityArtifact,
		finding_packet_set: findingPacketSet,
	},
}, null, 2)}\n`);

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
	}
	return null;
}

function runHomeboyBench({ settings, workloads, benchPath }) {
	const homeboyBin = process.env.HOMEBOY_BIN || 'homeboy';
	return spawnSync(homeboyBin, [
		'bench',
		'wp-site-generator',
		'--force-hot',
		'--allow-local-hot',
		'--iterations',
		'1',
		'--output',
		benchPath,
		'--artifact-root',
		process.env.HOMEBOY_ARTIFACT_ROOT || path.join(outputRoot, 'homeboy-artifacts'),
		'--setting-json',
		`wordpress_runtime_workloads=${JSON.stringify(workloads)}`,
	], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			HOMEBOY_SETTINGS_JSON: JSON.stringify(settings),
			HOMEBOY_BENCH_ITERATIONS: '1',
		},
	});
}

function runNodeScript(script, args = [], env = {}) {
	return spawnSync(process.execPath, [script, ...args], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
}

function findSsiScenario(bench) {
	const payload = bench?.data?.payload || bench?.data || bench;
	return payload?.results?.scenarios?.find((scenario) => scenario?.id === 'ssi-import')
		|| payload?.scenarios?.find((scenario) => scenario?.id === 'ssi-import')
		|| null;
}

function loadVisualParityArtifact(root) {
	return {
		schema: 'wp-site-generator/VisualParityArtifact/v1',
		artifact_url: root,
		summary: {
			status: 'not_run',
			mismatch_count: 0,
			max_delta_ratio: 0,
		},
	};
}

function candidateIsBlocked(candidate) {
	return Boolean(candidate.blocked_reason || candidate.failure_reason || candidate.status === 'blocked' || candidate.source?.concept_packet === null || candidate.source?.design_packet === null);
}

function artifactFromOutputs(outputs, artifactId) {
	const artifacts = outputs?.artifacts || outputs?.typed_artifacts || outputs?.typedArtifacts || {};
	return artifacts[artifactId];
}

function slug(value) {
	return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'static-validation-site';
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}
