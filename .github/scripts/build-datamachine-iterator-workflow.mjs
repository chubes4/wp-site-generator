#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = new URL('../..', import.meta.url).pathname;
const packetsPath = process.env.FINDING_PACKETS_PATH || process.argv[2] || 'homeboy-ci-results/finding-packets.json';
const outputPath = process.env.DATAMACHINE_WORKFLOW_PATH || process.argv[3] || 'homeboy-ci-results/datamachine-iterator-workflow.json';
const pipelinePath = process.env.ITERATOR_PIPELINE_PATH || 'bundles/php-transformer-iterator-agent/pipelines/php-transformer-iterator-pipeline.json';
const flowPath = process.env.ITERATOR_FLOW_PATH || 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json';

const findingPackets = normalizeFindingInput(await readJson(resolveRepoPath(packetsPath)));
const pipeline = await readJson(resolveRepoPath(pipelinePath));
const flow = await readJson(resolveRepoPath(flowPath));

const workflow = buildWorkflow(findingPackets, pipeline, flow);
await mkdir(path.dirname(resolveRepoPath(outputPath)), { recursive: true });
await writeFile(resolveRepoPath(outputPath), `${JSON.stringify(workflow, null, 2)}\n`);

function buildWorkflow(packets, pipelineConfig, flowConfig) {
	const iteratorPipelineStep = pipelineConfig.steps.find((step) => step?.step_type === 'ai' || step?.step_config?.step_type === 'ai');
	const iteratorFlowStep = flowConfig.steps.find((step) => step?.step_type === 'ai');
	if (!iteratorPipelineStep || !iteratorFlowStep) {
		throw new Error('Iterator bundle must contain an AI repair step in both pipeline and flow JSON.');
	}

	const aiConfig = iteratorPipelineStep.step_config || {};
	const promptQueue = Array.isArray(iteratorFlowStep.prompt_queue) ? iteratorFlowStep.prompt_queue : [];
	const userMessage = promptQueue.map((item) => item?.prompt || '').filter(Boolean).join('\n\n');

	return {
		workflow: {
			steps: [
				{
					type: 'system_task',
					label: 'Emit SSI finding packets',
					flow_step_settings: {
						task: 'emit_data_packets',
						params: {
							packets: packets.map(toDataMachinePacket),
							replace_data_packets: true,
							suppress_result_packet: true,
							complete_no_items: true,
						},
					},
				},
				{
					type: 'ai',
					label: aiConfig.label || 'Repair transformer findings',
					system_prompt: aiConfig.system_prompt || '',
					user_message: userMessage,
					enabled_tools: iteratorFlowStep.enabled_tools || [],
					disabled_tools: aiConfig.disabled_tools || iteratorFlowStep.disabled_tools || [],
					completion_assertions: aiConfig.completion_assertions || iteratorFlowStep.completion_assertions || {},
					tool_runtime_rules: aiConfig.tool_runtime_rules || iteratorFlowStep.tool_runtime_rules || [],
				},
			],
		},
		initial_data: {
			job_source: 'system',
			job_label: 'SSI finding iterator workflow',
		},
	};
}

function toDataMachinePacket(item, index) {
	const packet = Array.isArray(item?.packets) ? item.packets[0] || {} : item;
	const kind = text(item.kind) || text(packet.kind) || 'finding';
	const pathLabel = text(packet.path) || text(packet.selector) || `finding-${index + 1}`;
	const sourceRepo = text(packet.source_repo) || 'chubes4/wp-site-generator';
	const sourcePr = text(packet.source_pr);
	const validationRunId = text(packet.validation_run_id);
	const identifierParts = [sourceRepo, sourcePr, validationRunId, kind, pathLabel].filter(Boolean);
	const isGroup = Array.isArray(item?.packets);
	const title = isGroup
		? `${kind}: ${text(item.reason) || pathLabel}`
		: `${kind}: ${pathLabel}`;
	const body = isGroup
		? `Grouped SSI finding with ${item.count || item.packets.length} packet(s). ${text(item.reason) || text(packet.reason) || text(packet.preview)}`
		: text(packet.reason) || text(packet.preview) || 'Static Site Importer validation finding.';

	return {
		type: isGroup ? 'ssi_finding_group' : 'ssi_finding',
		data: {
			title,
			body,
			finding_packet: packet,
			finding_group: isGroup ? item : null,
		},
		metadata: {
			source_type: 'ssi_validation',
			item_identifier: identifierParts.join(':'),
			kind,
			candidate_repo: text(item.candidate_repo) || text(packet.candidate_repo),
			_engine_data: {
				finding_packet: packet,
				finding_group: isGroup ? item : null,
			},
		},
	};
}

function normalizeFindingInput(input) {
	if (Array.isArray(input)) {
		return input;
	}
	if (Array.isArray(input?.groups)) {
		return input.groups;
	}
	if (Array.isArray(input?.packets)) {
		return input.packets;
	}
	if (Array.isArray(input?.findings)) {
		return input.findings;
	}

	throw new Error('Finding input must be an array, grouped finding object, or object with packets/findings.');
}

function resolveRepoPath(inputPath) {
	return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

async function readJson(inputPath) {
	return JSON.parse(await readFile(inputPath, 'utf8'));
}

function text(value) {
	return value === undefined || value === null ? '' : String(value);
}
