#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSingleAiWorkflow, buildSingleAiWorkflowStep } from './lib/agent-ai-workflow.mjs';
import { acceptedOutcomesForRepairMode, normalizeFindingInput, summarizeFindingForPrompt } from '../../../.github/scripts/lib/ssi-finding-packets.mjs';
import { summarizeVisualDiff } from '../../../.github/scripts/lib/visual-artifacts.mjs';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const packetsPath = process.env.FINDING_PACKETS_PATH || process.argv[2] || 'homeboy-ci-results/finding-packets.json';
const outputPath = process.env.AGENT_WORKFLOW_PATH || process.argv[3] || 'homeboy-ci-results/agent-iterator-workflow.json';
const pipelinePath = process.env.ITERATOR_PIPELINE_PATH || 'bundles/php-transformer-iterator-agent/pipelines/php-transformer-iterator-pipeline.json';
const flowPath = process.env.ITERATOR_FLOW_PATH || 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json';
const visualArtifactDir = process.env.VISUAL_ARTIFACT_DIR || '';
const maxPromptTextLength = numberOrDefault(process.env.ITERATOR_MAX_PROMPT_TEXT_LENGTH, 600);

const findingGroup = normalizeIteratorFindingInput(await readJson(resolveRepoPath(packetsPath)));
const pipeline = await readJson(resolveRepoPath(pipelinePath));
const flow = await readJson(resolveRepoPath(flowPath));

const workflow = buildWorkflow(findingGroup, pipeline, flow);
await mkdir(path.dirname(resolveRepoPath(outputPath)), { recursive: true });
await writeFile(resolveRepoPath(outputPath), `${JSON.stringify(workflow, null, 2)}\n`);

function buildWorkflow(findingGroup, pipelineConfig, flowConfig) {
	const iteratorPipelineStep = pipelineConfig.steps.find((step) => step?.step_type === 'ai' || step?.step_config?.step_type === 'ai');
	const iteratorFlowStep = flowConfig.steps.find((step) => step?.step_type === 'ai');
	if (!iteratorPipelineStep || !iteratorFlowStep) {
		throw new Error('Iterator bundle must contain an AI repair step in both pipeline and flow JSON.');
	}

	const aiConfig = iteratorPipelineStep.step_config || {};
	const promptQueue = Array.isArray(iteratorFlowStep.prompt_queue) ? iteratorFlowStep.prompt_queue : [];
	const userMessage = [
		...promptQueue.map((item) => item?.prompt || '').filter(Boolean),
		formatFindingPrompt(findingGroup),
	].filter(Boolean).join('\n\n');
	const acceptedOutcomes = acceptedOutcomesForRepairMode(repairModeForGroup(findingGroup));
	const completionAssertions = {
		...(aiConfig.completion_assertions || iteratorFlowStep.completion_assertions || {}),
	};
	completionAssertions.required_tool_names = completionAssertions.required_tool_names || ['comment_github_pull_request'];
	completionAssertions.complete_when_any = (completionAssertions.complete_when_any || [])
		.filter((outcome) => acceptedOutcomes.includes(outcome?.name))
		.map((outcome) => {
		const tools = Array.isArray(outcome.tools) ? [...outcome.tools] : [];
		if (!tools.some((tool) => tool?.name === 'comment_github_pull_request')) {
			tools.push({ name: 'comment_github_pull_request' });
		}
		return { ...outcome, tools };
	});
	const toolRuntimeRules = [...(aiConfig.tool_runtime_rules || iteratorFlowStep.tool_runtime_rules || [])];
	if (!toolRuntimeRules.some((rule) => rule?.id === 'iterator-issue-before-source-callback')) {
		toolRuntimeRules.push({
			id: 'iterator-issue-before-source-callback',
			type: 'block_until_tool',
			after_tool: 'create_github_issue',
			blocked_tools: ['create_github_issue'],
			until_one_of: ['comment_github_pull_request'],
		});
	}

	const initialData = {
		job_source: 'system',
		job_label: 'SSI finding iterator workflow',
		finding_group: findingGroup,
		repair_mode: repairModeForGroup(findingGroup),
		accepted_outcomes: acceptedOutcomes,
	};
	if (!findingGroup) {
		initialData.completion_assertions_satisfied = {
			complete_when_any: ['no_actionable_findings'],
		};
	}

	return buildSingleAiWorkflow({
		step: buildSingleAiWorkflowStep({
			aiConfig: {
				...aiConfig,
				completion_assertions: completionAssertions,
				tool_runtime_rules: toolRuntimeRules,
			},
			flowStep: iteratorFlowStep,
			label: 'Repair transformer findings',
			prompt: userMessage,
			addedAt: 'static-validation-iterator-build',
		}),
		initialData,
	});
}

function normalizeIteratorFindingInput(input) {
	if (Array.isArray(input?.task_requests)) {
		return exactlyOneFindingGroup(input.task_requests.map((request) => request?.finding_group || request?.inputs?.finding_group || null));
	}
	if (Array.isArray(input?.tasks)) {
		return exactlyOneFindingGroup(input.tasks.map((task) => task?.inputs?.finding_group || task?.metadata?.finding_group || null));
	}

	return exactlyOneFindingGroup(normalizeFindingInput(input));
}

function exactlyOneFindingGroup(groups) {
	const present = groups.filter(Boolean);
	if (present.length === 0) {
		return null;
	}
	if (present.length !== 1) {
		throw new Error(`Iterator workflow expects exactly one finding_group per task; received ${present.length}.`);
	}
	return present[0];
}

function formatFindingPrompt(findingGroup) {
	if (!findingGroup) {
		return 'No actionable finding group was supplied. Finish with the no_actionable_findings outcome.';
	}

	const summary = summarizeFindingForPrompt(findingGroup, 0, { maxPromptTextLength, visualArtifactForPacket });
	return [
		'Process exactly one grouped static-site validation finding. It is embedded here so the iterator task does not depend on DataPacket child-job hydration.',
		'Use the structured repair_mode and accepted_outcomes contract from initial_data. Open one accepted upstream action for this finding group, then call comment_github_pull_request. A run is incomplete until the source callback succeeds.',
		'Finding group:',
		JSON.stringify(summary, null, 2),
	].filter(Boolean).join('\n\n');
}

function repairModeForGroup(group) {
	const packet = Array.isArray(group?.packets) ? group.packets[0] || {} : {};
	return text(group?.repair_mode) || text(packet.repair_mode) || 'pr_or_issue';
}

function visualArtifactForPacket(packet) {
	if (!visualArtifactDir) {
		return null;
	}

	const kind = text(packet.kind).toLowerCase();
	const artifactNames = packet.artifact_names && typeof packet.artifact_names === 'object' ? packet.artifact_names : {};
	if (!kind.startsWith('visual_') && !artifactNames.visual_parity) {
		return null;
	}

	const artifactDir = repoRelativePath(visualArtifactDir);
	const artifactDirPath = resolveRepoPath(visualArtifactDir);
	const visualDiffPath = path.join(artifactDirPath, 'visual-diff.json');
	const summaryPath = path.join(artifactDirPath, 'summary.json');
	const files = existingArtifactFiles(artifactDirPath);
	const visualDiff = existsSync(visualDiffPath) ? summarizeVisualDiff(readJsonSync(visualDiffPath)) : null;

	return {
		artifact_name: text(artifactNames.visual_parity) || (packet.site ? `visual-parity-${text(packet.site)}` : ''),
		directory: artifactDir,
		present: existsSync(artifactDirPath),
		files,
		source_screenshot_path: files.includes('source.png') ? joinPosix(artifactDir, 'source.png') : '',
		imported_screenshot_path: files.includes('imported.png') ? joinPosix(artifactDir, 'imported.png') : '',
		diff_screenshot_path: files.includes('diff.png') ? joinPosix(artifactDir, 'diff.png') : '',
		comparison_html_path: files.includes('comparison.html') ? joinPosix(artifactDir, 'comparison.html') : '',
		visual_diff_path: existsSync(visualDiffPath) ? joinPosix(artifactDir, 'visual-diff.json') : '',
		summary_path: existsSync(summaryPath) ? joinPosix(artifactDir, 'summary.json') : '',
		visual_diff: visualDiff,
	};
}

function existingArtifactFiles(artifactDirPath) {
	if (!existsSync(artifactDirPath)) {
		return [];
	}

	const known = ['source.png', 'imported.png', 'diff.png', 'visual-diff.json', 'summary.json', 'comparison.html'];
	const entries = new Set(readdirSync(artifactDirPath, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
	return known.filter((file) => entries.has(file));
}

function resolveRepoPath(inputPath) {
	return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function repoRelativePath(inputPath) {
	const absolutePath = resolveRepoPath(inputPath);
	return joinPosix(path.relative(repoRoot, absolutePath) || '.');
}

async function readJson(inputPath) {
	return JSON.parse(await readFile(inputPath, 'utf8'));
}

function readJsonSync(inputPath) {
	return JSON.parse(readFileSync(inputPath, 'utf8'));
}

function text(value) {
	return value === undefined || value === null ? '' : String(value);
}

function numberOrDefault(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function joinPosix(...parts) {
	return parts.join('/').replaceAll('\\', '/').replace(/\/+/g, '/');
}
