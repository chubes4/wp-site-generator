#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = process.env.GITHUB_WORKSPACE || process.cwd();
const outputPath = args.get('--output') || process.env.HOMEBOY_CONTROLLER_SPEC_PATH || path.join(root, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
const issueUrl = 'https://github.com/chubes4/wp-site-generator/issues/639';

const planContracts = {
	generation: '.ci/site-generation-loop.agent-task-plan.json',
	validation_settings: '.ci/static-validation-settings-${site}.json',
	finding_packets: '.ci/finding-packets/finding-packets.json',
	finding_groups: '.ci/finding-packets/grouped-finding-packets.json',
	iterator_workflow: '.ci/datamachine-iterator-workflow.json',
	iterator: '.ci/php-transformer-iterator.agent-task-plan.json',
	reviewer: '.ci/ssi-stack-reviewer.agent-task-plan.json',
};

const controller = {
	schema: 'homeboy/controller-spec/v1',
	controller_id: 'wp-site-generator/static-site-generation-loop',
	title: 'Static Site Importer self-improving site-generation loop',
	description: 'WPSG-owned domain ingredient contract for generating a static-site candidate, validating it through Static Site Importer, routing finding groups, revalidating, and publishing only when quality metrics clear.',
	authority: {
		builder: '.github/scripts/build-homeboy-ssi-loop-controller.mjs',
		plan_contracts: planContracts,
	},
	ingredients: {
		agents: [
			'store-idea-agent',
			'website-idea-agent',
			'design-store-agent',
			'design-website-agent',
			'static-store-agent',
			'static-site-agent',
			'php-transformer-iterator-agent',
			'ssi-stack-reviewer-agent',
		],
		tools: [
			'datamachine/run-agent-bundle',
			'github_issue_publish',
			'github_pull_request_publish',
			'comment_github_pull_request',
		],
		workflows: {
			generation: {
				builder: '.github/scripts/build-homeboy-site-generation-plan.mjs',
				plan: planContracts.generation,
			},
			static_validation: {
				builders: ['.github/scripts/build-static-validation-settings.mjs', '.github/scripts/static-visual-parity.mjs'],
				settings: planContracts.validation_settings,
			},
			finding_packets: {
				builders: ['.github/scripts/build-ssi-finding-packets.mjs', '.github/scripts/group-ssi-finding-packets.mjs'],
				outputs: [planContracts.finding_packets, planContracts.finding_groups],
			},
			iterator: {
				builders: ['.github/scripts/build-datamachine-iterator-workflow.mjs', '.github/scripts/build-homeboy-php-transformer-iterator-plan.mjs'],
				workflow: planContracts.iterator_workflow,
				plan: planContracts.iterator,
			},
			reviewer: {
				builder: '.github/scripts/build-ssi-stack-reviewer-workflow.mjs',
				plan: planContracts.reviewer,
			},
		},
		artifact_schemas: [
			{ id: 'concept_packet', schema: 'wp-site-generator/ConceptPacket/v1' },
			{ id: 'design_packet', schema: 'wp-site-generator/DesignPacket/v1' },
			{ id: 'static_site_candidate', schema: 'wp-site-generator/StaticSiteCandidate/v1' },
			{ id: 'import_validation_result', schema: 'wp-site-generator/ImportValidationResult/v1' },
			{ id: 'static_site_pull_request', schema: 'github/PullRequest/v1' },
			{ id: 'static_validation_run', schema: 'homeboy/Run/v1' },
			{ id: 'visual_parity_artifact', schema: 'wp-site-generator/VisualParityArtifact/v1' },
			{ id: 'finding_packet_set', schema: 'wp-site-generator/FindingPacketSet/v1' },
			{ id: 'finding_group', schema: 'wp-site-generator/FindingGroup/v1' },
			{ id: 'iterator_upstream_issue', schema: 'github/Issue/v1' },
			{ id: 'iterator_upstream_pull_request', schema: 'github/PullRequest/v1' },
			{ id: 'revalidation_attempt', schema: 'wp-site-generator/RevalidationAttempt/v1' },
			{ id: 'reviewer_gate_outcome', schema: 'wp-site-generator/SsiStackReviewerGate/v1' },
		],
		dependencies: [
			{ repo: 'chubes4/wp-site-generator', role: 'generated source and WPSG domain policy' },
			{ repo: 'chubes4/static-site-importer', role: 'SSI import/source-selection/asset-map behavior' },
			{ repo: 'chubes4/html-to-blocks-converter', role: 'HTML-to-block conversion behavior' },
			{ repo: 'chubes4/block-format-bridge', role: 'block serialization/scope/report behavior' },
			{ repo: 'chubes4/block-artifact-compiler', role: 'artifact schema/compiler behavior' },
		],
	},
	quality_gates: {
		fallback_blocks: {
			metric_paths: ['import_validation_result.metrics.fallback_blocks', 'import_validation_result.metrics.fallback_block_count', 'import_validation_result.metrics.ssi_fallback_count'],
			pass_when: 'value === 0',
			on_fail: 'finding_packets',
		},
		conversion_findings: {
			metric_paths: ['import_validation_result.metrics.conversion_findings', 'finding_packet_set.actionable_conversion_count'],
			pass_when: 'value === 0',
			actionable_kinds: ['unsupported_html_fallback', 'core_html_block', 'freeform_block'],
			on_fail: 'iterator_subloops',
		},
		visual_parity: {
			metric_paths: ['visual_parity_artifact.summary.status', 'visual_parity_artifact.summary.mismatch_count', 'visual_parity_artifact.summary.max_delta_ratio'],
			pass_when: 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0',
			on_fail: 'finding_packets',
		},
		reviewer_evidence: {
			requires: ['static_site_pull_request.url', 'static_validation_run.artifact_url', 'visual_parity_artifact.artifact_url'],
			forbids: ['localhost', '127.0.0.1', '/Users/'],
			on_fail: 'escalate',
		},
	},
	phases: [
		{
			id: 'generation',
			label: 'Generate candidate artifacts',
			workflow: 'generation',
			tasks: ['store-idea-agent', 'website-idea-agent', 'design-store-packet', 'design-website-packet', 'generate-store-candidate', 'generate-website-candidate'],
			emits: ['concept_packet', 'design_packet', 'static_site_candidate'],
			on_success: 'import_validation',
		},
		{
			id: 'import_validation',
			label: 'Import candidate before publication',
			workflow: 'generation',
			tasks: ['validate-store-candidate', 'validate-website-candidate'],
			requires: ['static_site_candidate'],
			emits: ['import_validation_result', 'finding_packet_set'],
			gates: ['fallback_blocks', 'conversion_findings'],
			on_pass: 'publish_pr',
			on_fail: 'finding_packets',
		},
		{
			id: 'publish_pr',
			label: 'Publish generated static-site PR',
			workflow: 'generation',
			tasks: ['publish-store-pr', 'publish-website-pr'],
			requires: ['static_site_candidate', 'import_validation_result'],
			emits: ['static_site_pull_request'],
			on_success: 'static_validation',
		},
		{
			id: 'static_validation',
			label: 'Validate published PR and visual parity',
			workflow: 'static_validation',
			builders: ['.github/scripts/build-static-validation-settings.mjs', '.github/scripts/static-visual-parity.mjs'],
			tasks: ['static-site-importer-bench', 'visual-parity'],
			requires: ['static_site_pull_request'],
			emits: ['static_validation_run', 'import_validation_result', 'visual_parity_artifact'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			on_pass: 'reviewer_gate',
			on_fail: 'finding_packets',
		},
		{
			id: 'finding_packets',
			label: 'Normalize validation artifacts into finding packets',
			workflow: 'finding_packets',
			builders: ['.github/scripts/build-ssi-finding-packets.mjs', '.github/scripts/group-ssi-finding-packets.mjs', '.github/scripts/build-datamachine-iterator-workflow.mjs'],
			requires_any: ['import_validation_result', 'static_validation_run', 'visual_parity_artifact'],
			emits: ['finding_packet_set', 'finding_group'],
			on_actionable: 'iterator_subloops',
			on_clean: 'reviewer_gate',
		},
		{
			id: 'iterator_subloops',
			label: 'Run upstream iterator subloops per finding group',
			workflow: 'iterator',
			requires: ['finding_group'],
			emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'],
			owner_repos: ['chubes4/html-to-blocks-converter', 'chubes4/block-format-bridge', 'chubes4/static-site-importer', 'chubes4/wp-site-generator'],
			on_success: 'revalidation',
			on_blocked: 'escalate',
		},
		{
			id: 'revalidation',
			label: 'Re-run validation after upstream iterator work',
			workflows: ['static_validation', 'finding_packets'],
			builders: ['.github/scripts/build-static-validation-settings.mjs', '.github/scripts/build-ssi-finding-packets.mjs', '.github/scripts/group-ssi-finding-packets.mjs'],
			requires: ['static_site_pull_request', 'iterator_upstream_pull_request'],
			emits: ['revalidation_attempt', 'static_validation_run', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'],
			max_attempts: 3,
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			on_pass: 'reviewer_gate',
			on_fail: 'iterator_subloops',
			on_exhausted: 'escalate',
		},
		{
			id: 'reviewer_gate',
			label: 'Run SSI stack reviewer gate',
			workflow: 'reviewer',
			requires: ['static_site_pull_request', 'static_validation_run', 'visual_parity_artifact'],
			requires_any: ['finding_packet_set', 'iterator_upstream_pull_request'],
			emits: ['reviewer_gate_outcome'],
			gates: ['reviewer_evidence'],
			on_pass: 'complete',
			on_needs_work: 'iterator_subloops',
			on_insufficient_evidence: 'escalate',
		},
	],
	tracking: {
		issue: issueUrl,
	},
	blockers: [
		{ repo: 'Extra-Chill/homeboy', issue: 3905, needed_for: 'autonomous controller pending-action execution' },
		{ repo: 'Extra-Chill/homeboy', issue: 3904, needed_for: 'Lab @file plan staging for controller-submitted plans' },
		{ repo: 'Extra-Chill/homeboy', issue: 4216, needed_for: 'native nested controller/subloop execution for validation and iterator fan-out' },
		{ repo: 'Extra-Chill/homeboy', issue: 4218, needed_for: 'controller lineage/event persistence for PRs, validation runs, findings, upstream PRs, and reviewer gates' },
		{ repo: 'Extra-Chill/homeboy', issue: 4647, needed_for: 'generic repo loop bridge that maps WPSG domain ingredients to executable controller policy/actions' },
	],
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(controller, null, 2)}\n`);
console.log(outputPath);

function parseArgs(argv) {
	const parsed = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}
		const next = argv[i + 1];
		parsed.set(arg, next && !next.startsWith('--') ? next : '1');
		if (next && !next.startsWith('--')) {
			i += 1;
		}
	}
	return parsed;
}
