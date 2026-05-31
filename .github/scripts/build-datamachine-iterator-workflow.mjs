#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = new URL('../..', import.meta.url).pathname;
const packetsPath = process.env.FINDING_PACKETS_PATH || process.argv[2] || 'homeboy-ci-results/finding-packets.json';
const outputPath = process.env.DATAMACHINE_WORKFLOW_PATH || process.argv[3] || 'homeboy-ci-results/datamachine-iterator-workflow.json';
const pipelinePath = process.env.ITERATOR_PIPELINE_PATH || 'bundles/php-transformer-iterator-agent/pipelines/php-transformer-iterator-pipeline.json';
const flowPath = process.env.ITERATOR_FLOW_PATH || 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json';
const visualArtifactDir = process.env.VISUAL_ARTIFACT_DIR || '';

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

function summarizeVisualDiff(diff) {
	if (!diff || typeof diff !== 'object') {
		return null;
	}

	return {
		pass: Boolean(diff.pass),
		threshold: numberOrNull(diff.threshold),
		mismatch_pixels: numberOrNull(diff.mismatchPixels),
		total_pixels: numberOrNull(diff.totalPixels),
		mismatch_ratio: numberOrNull(diff.mismatchRatio),
		dimension_mismatch: Boolean(diff.dimensionMismatch),
		source: imageSummary(diff.source),
		imported: imageSummary(diff.imported),
		diff: imageSummary(diff.diff),
		regions: Array.isArray(diff.regions) ? diff.regions.slice(0, 8).map(summarizeRegion) : [],
	};
}

function imageSummary(value) {
	return value && typeof value === 'object'
		? {
			path: text(value.path),
			width: numberOrNull(value.width),
			height: numberOrNull(value.height),
		}
		: null;
}

function summarizeRegion(region) {
	return {
		rank: numberOrNull(region.rank),
		x: numberOrNull(region.x),
		y: numberOrNull(region.y),
		width: numberOrNull(region.width),
		height: numberOrNull(region.height),
		mismatch_pixels: numberOrNull(region.mismatchPixels),
		total_pixels: numberOrNull(region.totalPixels),
		mismatch_ratio: numberOrNull(region.mismatchRatio),
		source_matches: summarizeMatches(region.source_matches),
		imported_matches: summarizeMatches(region.imported_matches),
		layout_deltas: summarizeLayoutDeltas(region.layout_deltas),
	};
}

function summarizeMatches(matches) {
	return Array.isArray(matches)
		? matches.slice(0, 3).map((match) => ({
			selector: text(match.selector),
			path: text(match.path),
			text: text(match.text).slice(0, 180),
			child_summary: text(match.child_summary).slice(0, 240),
			rect: match.rect && typeof match.rect === 'object'
				? {
					x: numberOrNull(match.rect.x),
					y: numberOrNull(match.rect.y),
					width: numberOrNull(match.rect.width),
					height: numberOrNull(match.rect.height),
				}
				: null,
		}))
		: [];
}

function summarizeLayoutDeltas(deltas) {
	return Array.isArray(deltas)
		? deltas.slice(0, 3).map((delta) => ({
			pair: numberOrNull(delta.pair),
			source_selector: text(delta.source_selector),
			imported_selector: text(delta.imported_selector),
			source_path: text(delta.source_path),
			imported_path: text(delta.imported_path),
			source_child_summary: text(delta.source_child_summary).slice(0, 240),
			imported_child_summary: text(delta.imported_child_summary).slice(0, 240),
			rect_delta: delta.rect_delta && typeof delta.rect_delta === 'object'
				? {
					x: numberOrNull(delta.rect_delta.x),
					y: numberOrNull(delta.rect_delta.y),
					width: numberOrNull(delta.rect_delta.width),
					height: numberOrNull(delta.rect_delta.height),
				}
				: null,
			style_diffs: Array.isArray(delta.style_diffs)
				? delta.style_diffs.slice(0, 8).map((diff) => ({
					property: text(diff.property),
					source: text(diff.source).slice(0, 160),
					imported: text(diff.imported).slice(0, 160),
				}))
				: [],
		}))
		: [];
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
	if (Array.isArray(input?.findings)) {
		return input.findings;
	}

	throw new Error('Finding input must be an array, grouped finding object, or object with packets/findings.');
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

function numberOrNull(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function formatRatio(value) {
	const number = Number(value);
	return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : 'unknown';
}

function joinPosix(...parts) {
	return parts.join('/').replaceAll('\\', '/').replace(/\/+/g, '/');
}
