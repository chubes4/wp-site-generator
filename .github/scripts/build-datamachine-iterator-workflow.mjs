#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatRatio, summarizeVisualDiff } from './lib/visual-artifacts.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;
const packetsPath = process.env.FINDING_PACKETS_PATH || process.argv[2] || 'homeboy-ci-results/finding-packets.json';
const outputPath = process.env.DATAMACHINE_WORKFLOW_PATH || process.argv[3] || 'homeboy-ci-results/datamachine-iterator-workflow.json';
const pipelinePath = process.env.ITERATOR_PIPELINE_PATH || 'bundles/php-transformer-iterator-agent/pipelines/php-transformer-iterator-pipeline.json';
const flowPath = process.env.ITERATOR_FLOW_PATH || 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json';
const visualArtifactDir = process.env.VISUAL_ARTIFACT_DIR || '';
const maxPromptFindingGroups = numberOrDefault(process.env.ITERATOR_MAX_PROMPT_GROUPS, 12);
const maxPromptTextLength = numberOrDefault(process.env.ITERATOR_MAX_PROMPT_TEXT_LENGTH, 600);

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
	const userMessage = [
		...promptQueue.map((item) => item?.prompt || '').filter(Boolean),
		formatFindingPrompt(packets),
	].filter(Boolean).join('\n\n');
	const completionAssertions = {
		...(aiConfig.completion_assertions || iteratorFlowStep.completion_assertions || {}),
	};
	completionAssertions.required_tool_names = completionAssertions.required_tool_names || ['comment_github_pull_request'];
	completionAssertions.complete_when_any = (completionAssertions.complete_when_any || []).map((outcome) => {
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
	};
	if (packets.length === 0) {
		initialData.completion_assertions_satisfied = {
			complete_when_any: ['no_actionable_findings'],
		};
	}

	return {
		workflow: {
			steps: [
				{
					step_type: 'ai',
					label: aiConfig.label || 'Repair transformer findings',
					system_prompt: aiConfig.system_prompt || '',
					prompt_queue: [
						{
							prompt: userMessage,
							added_at: 'static-validation-iterator-build',
						},
					],
					queue_mode: 'static',
					enabled_tools: iteratorFlowStep.enabled_tools || [],
					disabled_tools: aiConfig.disabled_tools || iteratorFlowStep.disabled_tools || [],
					completion_assertions: completionAssertions,
					tool_runtime_rules: toolRuntimeRules,
				},
			],
		},
		initial_data: initialData,
	};
}

function formatFindingPrompt(packets) {
	if (packets.length === 0) {
		return 'No actionable finding groups were supplied. Finish with the no_actionable_findings outcome.';
	}

	const visiblePackets = packets.slice(0, maxPromptFindingGroups);
	const summaries = visiblePackets.map((item, index) => summarizeFindingForPrompt(item, index));
	const omittedCount = Math.max(0, packets.length - visiblePackets.length);
	return [
		'Process these grouped static-site validation findings. They are embedded here so the iterator does not depend on DataPacket child-job hydration.',
		'For each group: route owner, open or reuse the required upstream issue/PR, and comment back to the source generated-site PR. A run is incomplete until comment_github_pull_request is called.',
		omittedCount > 0 ? `Only the first ${visiblePackets.length} of ${packets.length} finding groups are embedded. The omitted ${omittedCount} group(s) require a follow-up iterator run.` : '',
		'Finding groups:',
		JSON.stringify(summaries, null, 2),
	].filter(Boolean).join('\n\n');
}

function summarizeFindingForPrompt(item, index) {
	const packet = Array.isArray(item?.packets) ? item.packets[0] || {} : item;
	const visualArtifact = visualArtifactForPacket(packet);
	const summary = {
		index: index + 1,
		title: compactText(Array.isArray(item?.packets)
			? `${text(item.kind) || text(packet.kind) || 'finding'}: ${text(item.reason) || text(packet.reason) || text(packet.preview)}`
			: `${text(packet.kind) || 'finding'}: ${text(packet.reason) || text(packet.preview) || text(packet.path)}`),
		candidate_repo: text(item.candidate_repo) || text(packet.candidate_repo),
		repair_mode: text(item.repair_mode) || text(packet.repair_mode),
		route_reason: compactText(item.route_reason, 300),
		source_repo: text(packet.source_repo) || 'chubes4/wp-site-generator',
		source_pr: text(packet.source_pr),
		source_head_sha: text(packet.source_head_sha),
		source_branch: text(packet.source_branch),
		validation_run_id: text(packet.validation_run_id),
		site: text(packet.site),
		artifact_names: packet.artifact_names && typeof packet.artifact_names === 'object' ? packet.artifact_names : {},
		diagnostic_id: text(packet.diagnostic_id),
		kind: text(packet.kind),
		category: text(packet.category),
		reason_code: text(packet.reason_code),
		suggested_repair_class: text(packet.suggested_repair_class),
		converter: text(packet.converter),
		stage: text(packet.stage),
		source_path: text(packet.source_path) || text(packet.path),
		selector: text(packet.selector),
		block_name: text(packet.block_name),
		block_path: text(packet.block_path),
		reason: compactText(packet.reason),
		preview: compactText(packet.preview),
		excerpt: compactText(packet.excerpt),
		source_html_preview: compactText(packet.source_html_preview),
		emitted_block_preview: compactText(packet.emitted_block_preview),
		diagnostic_refs: summarizeRefs(packet.diagnostic_refs, 6),
		asset_map_refs: summarizeRefs(packet.asset_map_refs, 6),
		group_count: Number(item?.count) || (Array.isArray(item?.packets) ? item.packets.length : 1),
	};

	if (visualArtifact) {
		summary.visual_artifact = {
			artifact_name: visualArtifact.artifact_name,
			directory: visualArtifact.directory,
			files: visualArtifact.files,
			source_screenshot_path: visualArtifact.source_screenshot_path,
			imported_screenshot_path: visualArtifact.imported_screenshot_path,
			diff_screenshot_path: visualArtifact.diff_screenshot_path,
			visual_diff_path: visualArtifact.visual_diff_path,
			summary_path: visualArtifact.summary_path,
			comparison_html_path: visualArtifact.comparison_html_path,
			visual_diff: visualArtifact.visual_diff,
		};
	}

	return summary;
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
	let body = isGroup
		? `Grouped SSI finding with ${item.count || item.packets.length} packet(s). ${text(item.reason) || text(packet.reason) || text(packet.preview)}`
		: text(packet.reason) || text(packet.preview) || 'Static Site Importer validation finding.';
	body = `${body}\n\nDiagnostic: ${text(packet.diagnostic_id) || '(none)'}\nSource path: ${text(packet.source_path) || text(packet.path) || '(none)'}\nCategory: ${text(packet.category) || '(none)'}\nReason code: ${text(packet.reason_code) || '(none)'}\nSuggested repair class: ${text(packet.suggested_repair_class) || '(none)'}`;
	if (Array.isArray(packet.asset_map_refs) && packet.asset_map_refs.length > 0) {
		body = `${body}\nAsset map refs: ${packet.asset_map_refs.join(', ')}`;
	}
	if (text(packet.repair_mode) === 'issue_only' || text(item.repair_mode) === 'issue_only') {
		body = `${body}\n\nRepair mode: issue_only. This packet is aggregate evidence only; open or reuse a focused upstream issue instead of creating a repair PR.`;
	}
	const visualArtifact = visualArtifactForPacket(packet);
	if (visualArtifact) {
		body = `${body}\n\n${formatVisualArtifactContext(visualArtifact)}`;
	}

	return {
		type: isGroup ? 'ssi_finding_group' : 'ssi_finding',
		data: {
			title,
			body,
			finding_packet: packet,
			finding_group: isGroup ? item : null,
			visual_artifact: visualArtifact,
		},
		metadata: {
			source_type: 'ssi_validation',
			item_identifier: identifierParts.join(':'),
			kind,
			candidate_repo: text(item.candidate_repo) || text(packet.candidate_repo),
			repair_mode: text(item.repair_mode) || text(packet.repair_mode),
			route_reason: text(item.route_reason),
			diagnostic_id: text(packet.diagnostic_id),
			source_path: text(packet.source_path) || text(packet.path),
			category: text(packet.category),
			reason_code: text(packet.reason_code),
			suggested_repair_class: text(packet.suggested_repair_class),
			_engine_data: {
				finding_packet: packet,
				finding_group: isGroup ? item : null,
				visual_artifact: visualArtifact,
			},
		},
	};
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

function formatVisualArtifactContext(artifact) {
	const lines = [
		'Visual parity artifact context:',
		`- artifact: ${artifact.artifact_name || 'visual-parity'}`,
		`- directory: ${artifact.directory}`,
	];
	for (const [label, value] of [
		['source screenshot', artifact.source_screenshot_path],
		['imported screenshot', artifact.imported_screenshot_path],
		['diff screenshot', artifact.diff_screenshot_path],
		['visual diff json', artifact.visual_diff_path],
		['summary json', artifact.summary_path],
		['comparison html', artifact.comparison_html_path],
	]) {
		if (value) {
			lines.push(`- ${label}: ${value}`);
		}
	}

	const diff = artifact.visual_diff;
	if (diff) {
		lines.push(
			`- mismatch: ${formatRatio(diff.mismatch_ratio)}; threshold: ${formatRatio(diff.threshold)}; pixels: ${diff.mismatch_pixels || 0}/${diff.total_pixels || 0}; dimension_mismatch: ${diff.dimension_mismatch ? 'yes' : 'no'}`
		);
		if (diff.source && diff.imported) {
			lines.push(`- source size: ${diff.source.width || 0}x${diff.source.height || 0}; imported size: ${diff.imported.width || 0}x${diff.imported.height || 0}`);
		}
		for (const region of diff.regions.slice(0, 3)) {
			lines.push(
				`- region ${region.rank || '?'}: x=${region.x || 0}, y=${region.y || 0}, w=${region.width || 0}, h=${region.height || 0}, mismatch=${formatRatio(region.mismatch_ratio)}`
			);
			const sourceMatch = region.source_matches[0];
			const importedMatch = region.imported_matches[0];
			if (sourceMatch) {
				lines.push(`  source match: ${sourceMatch.selector || '(selector unknown)'} ${sourceMatch.text ? `"${sourceMatch.text}"` : ''}`.trimEnd());
			}
			if (importedMatch) {
				lines.push(`  imported match: ${importedMatch.selector || '(selector unknown)'} ${importedMatch.text ? `"${importedMatch.text}"` : ''}`.trimEnd());
			}
			for (const delta of region.layout_deltas.slice(0, 2)) {
				const rect = delta.rect_delta || {};
				lines.push(
					`  layout delta ${delta.pair || '?'}: ${delta.source_selector || '(source)'} -> ${delta.imported_selector || '(imported)'}; rect dx=${rect.x || 0}, dy=${rect.y || 0}, dw=${rect.width || 0}, dh=${rect.height || 0}`
				);
				for (const diff of delta.style_diffs.slice(0, 4)) {
					lines.push(`    style ${diff.property}: source=${diff.source || '(empty)'} imported=${diff.imported || '(empty)'}`);
				}
			}
		}
	}

	return lines.join('\n');
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

	throw new Error('Finding input must be an array, grouped finding object, or object with packets.');
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

function compactText(value, maxLength = maxPromptTextLength) {
	const compacted = text(value).replace(/\s+/g, ' ').trim();
	return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function summarizeRefs(value, maxItems) {
	return Array.isArray(value) ? value.slice(0, maxItems).map((item) => compactText(item, 240)) : [];
}

function numberOrDefault(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function joinPosix(...parts) {
	return parts.join('/').replaceAll('\\', '/').replace(/\/+/g, '/');
}
