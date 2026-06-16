#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = process.env.GITHUB_WORKSPACE || process.cwd();
const outputPath = args.get('--output') || process.env.HOMEBOY_CONTROLLER_SPEC_PATH || path.join(root, '.github/homeboy/controllers/static-site-generation-loop.controller.json');

const artifactSchemas = {
	concept_packet: 'wp-site-generator/ConceptPacket/v1',
	design_packet: 'wp-site-generator/DesignPacket/v1',
	static_site_candidate: 'wp-site-generator/StaticSiteCandidate/v1',
	import_validation_result: 'wp-site-generator/ImportValidationResult/v1',
	static_site_pull_request: 'github/PullRequest/v1',
	static_validation_run: 'homeboy/Run/v1',
	visual_parity_artifact: 'wp-site-generator/VisualParityArtifact/v1',
	finding_packet_set: 'wp-site-generator/FindingPacketSet/v1',
	finding_group: 'wp-site-generator/FindingGroup/v1',
	iterator_upstream_issue: 'github/Issue/v1',
	iterator_upstream_pull_request: 'github/PullRequest/v1',
	revalidation_attempt: 'wp-site-generator/RevalidationAttempt/v1',
	reviewer_gate_outcome: 'wp-site-generator/SsiStackReviewerGate/v1',
};

const agentBundles = {
	store_idea: { bundle: 'bundles/store-idea-agent', slug: 'store-idea-agent', emits: ['concept_packet'] },
	website_idea: { bundle: 'bundles/website-idea-agent', slug: 'website-idea-agent', emits: ['concept_packet'] },
	design_store: { bundle: 'bundles/design-store-agent', slug: 'design-store-agent', requires: ['concept_packet'], emits: ['design_packet'] },
	design_website: { bundle: 'bundles/design-website-agent', slug: 'design-website-agent', requires: ['concept_packet'], emits: ['design_packet'] },
	static_store: { bundle: 'bundles/static-store-agent', slug: 'static-store-agent', requires: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] },
	static_site: { bundle: 'bundles/static-site-agent', slug: 'static-site-agent', requires: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] },
	php_transformer_iterator: { bundle: 'bundles/php-transformer-iterator-agent', slug: 'php-transformer-iterator-agent', requires: ['finding_group'], emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'] },
	ssi_stack_reviewer: { bundle: 'bundles/ssi-stack-reviewer-agent', slug: 'ssi-stack-reviewer-agent', requires: ['static_site_pull_request', 'static_validation_run', 'visual_parity_artifact'], emits: ['reviewer_gate_outcome'] },
};

const abilityIds = [
	'datamachine/run-agent-bundle',
	'github_issue_publish',
	'github_pull_request_publish',
	'comment_github_pull_request',
	'wpsg_materialize_packet',
];

const artifactFlow = [
	{ edge_id: 'concept-to-design', from: ['store-idea', 'website-idea'], to: ['design-store', 'design-website'], artifact: 'concept_packet', required: true },
	{ edge_id: 'design-to-static', from: ['design-store', 'design-website'], to: ['static-store', 'static-site'], artifact: 'design_packet', required: true },
	{ edge_id: 'static-to-validation', from: ['static-store', 'static-site'], to: ['static-validation'], artifact: 'static_site_pull_request', required: true },
	{ edge_id: 'validation-to-findings', from: ['static-validation'], to: ['finding-packets'], artifact: 'static_validation_run', required: true },
	{ edge_id: 'visual-to-findings', from: ['static-validation'], to: ['finding-packets'], artifact: 'visual_parity_artifact', required: true },
	{ edge_id: 'findings-to-iterator-groups', from: ['finding-packets'], to: ['iterator'], artifact: 'finding_group', required: true, fan_out: 'per_finding_group' },
	{ edge_id: 'iterator-to-revalidation', from: ['iterator'], to: ['revalidation'], artifact: 'iterator_upstream_pull_request', required: true },
	{ edge_id: 'revalidation-to-reviewer', from: ['revalidation'], to: ['reviewer'], artifact: 'revalidation_attempt', required: true },
	{ edge_id: 'iterator-evidence-to-reviewer', from: ['iterator'], to: ['reviewer'], artifact: 'iterator_upstream_pull_request', required: true },
];

function handoff({ consumes = [], emits = [] } = {}) {
	return { consumes, emits, artifacts: [...consumes, ...emits] };
}

const controller = {
	schema: 'homeboy/agent-task-loop-spec/v1',
	loop_id: 'wp-site-generator/static-site-generation-loop',
	phase: 'init',
	config_version: 'wpsg-ssi-loop-v1',
	metadata: {
		title: 'Static Site Importer self-improving site-generation loop',
		description: 'WPSG-owned domain ingredient contract for generating a static-site candidate, validating it through Static Site Importer, routing finding groups, revalidating, and publishing only when quality metrics clear.',
		authority: {
			builder: '.github/scripts/build-homeboy-ssi-loop-controller.mjs',
			contract_issue: 'https://github.com/Extra-Chill/homeboy/issues/4658',
			homeboy_from_spec: [
				'https://github.com/Extra-Chill/homeboy/issues/4722',
				'https://github.com/Extra-Chill/homeboy/issues/4723',
			],
		},
	},
	agents: Object.entries(agentBundles).map(([agent_id, metadata]) => ({
		agent_id,
		role: metadata.slug,
		instructions: `Run the ${metadata.slug} bundle for the WPSG SSI loop when Homeboy selects this workflow.`,
		abilities: ['datamachine/run-agent-bundle'],
		metadata,
	})),
	abilities: abilityIds.map((ability_id) => ({ ability_id })),
	workflows: [
		{
			workflow_id: 'store-idea',
			agent_id: 'store_idea',
			prompt: 'Produce a commerce concept packet for the WPSG static-site generation loop.',
			abilities: ['datamachine/run-agent-bundle', 'github_issue_publish', 'wpsg_materialize_packet'],
			...handoff({ emits: ['concept_packet'] }),
		},
		{
			workflow_id: 'website-idea',
			agent_id: 'website_idea',
			prompt: 'Produce a content-site concept packet for the WPSG static-site generation loop.',
			abilities: ['datamachine/run-agent-bundle', 'github_issue_publish', 'wpsg_materialize_packet'],
			...handoff({ emits: ['concept_packet'] }),
		},
		{
			workflow_id: 'design-store',
			agent_id: 'design_store',
			prompt: 'Produce a design packet from a commerce concept packet for the WPSG static-site generation loop.',
			abilities: ['datamachine/run-agent-bundle', 'wpsg_materialize_packet'],
			...handoff({ consumes: ['concept_packet'], emits: ['design_packet'] }),
		},
		{
			workflow_id: 'design-website',
			agent_id: 'design_website',
			prompt: 'Produce a design packet from a content-site concept packet for the WPSG static-site generation loop.',
			abilities: ['datamachine/run-agent-bundle', 'wpsg_materialize_packet'],
			...handoff({ consumes: ['concept_packet'], emits: ['design_packet'] }),
		},
		{
			workflow_id: 'static-store',
			agent_id: 'static_store',
			prompt: 'Produce a commerce static-site candidate and pull request from a WPSG design packet.',
			abilities: ['datamachine/run-agent-bundle', 'github_pull_request_publish', 'wpsg_materialize_packet'],
			...handoff({ consumes: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] }),
			dependencies: ['wp-site-generator'],
		},
		{
			workflow_id: 'static-site',
			agent_id: 'static_site',
			prompt: 'Produce a content static-site candidate and pull request from a WPSG design packet.',
			abilities: ['datamachine/run-agent-bundle', 'github_pull_request_publish', 'wpsg_materialize_packet'],
			...handoff({ consumes: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] }),
			dependencies: ['wp-site-generator'],
		},
		{
			workflow_id: 'static-validation',
			tasks: ['Validate a static-site pull request through SSI import, static checks, and visual parity.'],
			...handoff({ consumes: ['static_site_pull_request'], emits: ['static_validation_run', 'import_validation_result', 'visual_parity_artifact'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'html-to-blocks-converter', 'block-format-bridge', 'block-artifact-compiler'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
		},
		{
			workflow_id: 'finding-packets',
			tasks: ['Group SSI and BFB diagnostic artifacts into finding packets for upstream routing.'],
			...handoff({ consumes: ['import_validation_result', 'static_validation_run', 'visual_parity_artifact'], emits: ['finding_packet_set', 'finding_group'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'html-to-blocks-converter', 'block-format-bridge', 'block-artifact-compiler'],
		},
		{
			workflow_id: 'iterator',
			agent_id: 'php_transformer_iterator',
			prompt: 'Route each finding group to the owning SSI stack repository and open the focused upstream issue or pull request described by the packet evidence.',
			abilities: ['datamachine/run-agent-bundle', 'github_issue_publish', 'github_pull_request_publish', 'comment_github_pull_request'],
			...handoff({ consumes: ['finding_group'], emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'] }),
			fan_out: {
				mode: 'per_artifact',
				artifact: 'finding_group',
				group_by: ['owner_repo', 'root_cause', 'group_id'],
				requires_non_empty: true,
			},
			dependencies: ['static-site-importer', 'html-to-blocks-converter', 'block-format-bridge', 'block-artifact-compiler'],
		},
		{
			workflow_id: 'revalidation',
			tasks: ['Revalidate the generated-site pull request after an upstream iterator pull request is available.'],
			...handoff({ consumes: ['static_site_pull_request', 'iterator_upstream_pull_request'], emits: ['revalidation_attempt', 'static_validation_run', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'html-to-blocks-converter', 'block-format-bridge', 'block-artifact-compiler'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
		},
		{
			workflow_id: 'reviewer',
			agent_id: 'ssi_stack_reviewer',
			prompt: 'Review the upstream iterator action with the static validation and visual parity evidence before promotion.',
			abilities: ['datamachine/run-agent-bundle', 'comment_github_pull_request'],
			...handoff({ consumes: ['static_site_pull_request', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'iterator_upstream_pull_request', 'revalidation_attempt'], emits: ['reviewer_gate_outcome'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'html-to-blocks-converter', 'block-format-bridge', 'block-artifact-compiler'],
			gates: ['reviewer_evidence'],
			promotion_gate: {
				requires: ['reviewer_gate_outcome.decision'],
				passing_decisions: ['PASS'],
				blocks_on_missing_evidence: true,
			},
		},
	],
	artifact_flow: artifactFlow,
	iterator_groups: {
		artifact: 'finding_group',
		group_by: ['owner_repo', 'root_cause', 'group_id'],
		fan_out_workflow: 'iterator',
		join_workflows: ['revalidation', 'reviewer'],
	},
	artifacts: Object.entries(artifactSchemas).map(([artifact_id, schema]) => ({
		artifact_id,
		kind: schema,
		description: `${artifact_id} artifact using ${schema}`,
		required: true,
	})),
	dependencies: [
		{ dependency_id: 'wp-site-generator', kind: 'repo', value: 'chubes4/wp-site-generator', required: true },
		{ dependency_id: 'static-site-importer', kind: 'repo', value: 'chubes4/static-site-importer', required: true },
		{ dependency_id: 'html-to-blocks-converter', kind: 'repo', value: 'chubes4/html-to-blocks-converter', required: true },
		{ dependency_id: 'block-format-bridge', kind: 'repo', value: 'chubes4/block-format-bridge', required: true },
		{ dependency_id: 'block-artifact-compiler', kind: 'repo', value: 'chubes4/block-artifact-compiler', required: true },
	],
	gates: [
		{ gate_id: 'fallback_blocks', description: 'SSI import must not emit fallback blocks.', metrics: ['fallback_blocks'] },
		{ gate_id: 'conversion_findings', description: 'SSI/BFB diagnostics must not include actionable conversion findings.', metrics: ['conversion_findings'] },
		{ gate_id: 'visual_parity', description: 'Visual parity artifact must report no mismatches or delta.', metrics: ['visual_parity'] },
		{ gate_id: 'reviewer_evidence', description: 'Reviewer evidence must use durable public artifact references.', metrics: ['reviewer_evidence'] },
	],
	metrics: [
		{
			metric_id: 'fallback_blocks',
			description: 'Fallback block count reported by SSI import validation.',
			target: 'value === 0',
			input: { paths: ['import_validation_result.metrics.fallback_blocks', 'import_validation_result.metrics.fallback_block_count', 'import_validation_result.metrics.ssi_fallback_count'] },
		},
		{
			metric_id: 'conversion_findings',
			description: 'Actionable conversion finding count reported by SSI/BFB diagnostics.',
			target: 'value === 0',
			input: {
				paths: ['import_validation_result.metrics.conversion_findings', 'finding_packet_set.actionable_conversion_count'],
				actionable_kinds: ['unsupported_html_fallback', 'core_html_block', 'freeform_block'],
			},
		},
		{
			metric_id: 'visual_parity',
			description: 'Visual parity status, mismatch count, and maximum delta ratio.',
			target: 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0',
			input: { paths: ['visual_parity_artifact.summary.status', 'visual_parity_artifact.summary.mismatch_count', 'visual_parity_artifact.summary.max_delta_ratio'] },
		},
		{
			metric_id: 'reviewer_evidence',
			description: 'Durable PR, validation, and visual parity evidence references for the reviewer gate.',
			input: {
				requires: ['static_site_pull_request.url', 'static_validation_run.artifact_url', 'visual_parity_artifact.artifact_url'],
				forbids: ['localhost', '127.0.0.1', '/Users/'],
			},
		},
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
