#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, readAgentRuntimeContract, runtimeBundleExecution, runtimePackageAbility } from './lib/ci-runtime-utils.mjs';

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
	static_site_publish_gate: 'wp-site-generator/StaticSitePublishGate/v1',
	finding_packet_set: 'wp-site-generator/FindingPacketSet/v1',
	finding_group: 'wp-site-generator/FindingGroup/v1',
	iterator_upstream_issue: 'github/Issue/v1',
	iterator_upstream_pull_request: 'github/PullRequest/v1',
	revalidation_attempt: 'wp-site-generator/RevalidationAttempt/v1',
	reviewer_gate_outcome: 'wp-site-generator/SsiStackReviewerGate/v1',
};

const agentBundles = {
	store_idea: { bundle: 'bundles/store-idea-agent', slug: 'store-idea-agent', flow: 'store-idea-artifact-flow', emits: ['concept_packet'] },
	website_idea: { bundle: 'bundles/website-idea-agent', slug: 'website-idea-agent', flow: 'website-idea-artifact-flow', emits: ['concept_packet'] },
	design_store: { bundle: 'bundles/design-agent', slug: 'design-agent', flow: 'design-artifact-flow', requires: ['concept_packet'], emits: ['design_packet'] },
	design_website: { bundle: 'bundles/design-agent', slug: 'design-agent', flow: 'design-artifact-flow', requires: ['concept_packet'], emits: ['design_packet'] },
	static_store: { bundle: 'bundles/static-site-agent', slug: 'static-site-agent', flow: 'static-site-candidate-flow', requires: ['concept_packet', 'design_packet'], emits: ['static_site_candidate'] },
	static_site: { bundle: 'bundles/static-site-agent', slug: 'static-site-agent', flow: 'static-site-candidate-flow', requires: ['concept_packet', 'design_packet'], emits: ['static_site_candidate'] },
	php_transformer_iterator: { bundle: 'bundles/php-transformer-iterator-agent', slug: 'php-transformer-iterator-agent', requires: ['finding_group'], emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'] },
	ssi_stack_reviewer: { bundle: 'bundles/ssi-stack-reviewer-agent', slug: 'ssi-stack-reviewer-agent', requires: ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt'], emits: ['reviewer_gate_outcome'] },
};

const runtimeContract = readAgentRuntimeContract(process.env);
const runtimePackageAbilityId = runtimePackageAbility(runtimeContract);

const abilityIds = [
	runtimePackageAbilityId,
	'github_issue_publish',
	'github_pull_request_publish',
	'comment_github_pull_request',
];

const artifactFlow = [
	{ edge_id: 'concept-to-design', from: ['store-idea', 'website-idea'], to: ['design-store', 'design-website'], artifact: 'concept_packet', required: true },
	{ edge_id: 'design-to-static', from: ['design-store', 'design-website'], to: ['static-store', 'static-site'], artifact: 'design_packet', required: true },
	{ edge_id: 'concept-to-static', from: ['store-idea', 'website-idea'], to: ['static-store', 'static-site'], artifact: 'concept_packet', required: true },
	{ edge_id: 'static-to-validation', from: ['static-store', 'static-site'], to: ['static-validation'], artifact: 'static_site_candidate', required: true },
	{ edge_id: 'validation-to-publication-gate', from: ['static-validation'], to: ['static-publication-gate'], artifact: 'import_validation_result', required: true },
	{ edge_id: 'visual-to-publication-gate', from: ['static-validation'], to: ['static-publication-gate'], artifact: 'visual_parity_artifact', required: true },
	{ edge_id: 'static-to-publication', from: ['static-store', 'static-site'], to: ['static-publication'], artifact: 'static_site_candidate', required: true },
	{ edge_id: 'validation-to-publication', from: ['static-validation'], to: ['static-publication'], artifact: 'import_validation_result', required: true },
	{ edge_id: 'publication-gate-to-publication', from: ['static-publication-gate'], to: ['static-publication'], artifact: 'static_site_publish_gate', required: true },
	{ edge_id: 'candidate-to-revalidation', from: ['static-store', 'static-site'], to: ['revalidation'], artifact: 'static_site_candidate', required: true },
	{ edge_id: 'validation-to-revalidation', from: ['static-validation'], to: ['revalidation'], artifact: 'import_validation_result', required: true },
	{ edge_id: 'visual-to-revalidation', from: ['static-validation'], to: ['revalidation'], artifact: 'visual_parity_artifact', required: true },
	{ edge_id: 'findings-to-revalidation', from: ['finding-packets'], to: ['revalidation'], artifact: 'finding_packet_set', required: true },
	{ edge_id: 'candidate-to-reviewer', from: ['static-store', 'static-site'], to: ['reviewer'], artifact: 'static_site_candidate', required: true },
	{ edge_id: 'validation-to-reviewer', from: ['static-validation'], to: ['reviewer'], artifact: 'import_validation_result', required: true },
	{ edge_id: 'static-run-to-reviewer', from: ['static-validation'], to: ['reviewer'], artifact: 'static_validation_run', required: true },
	{ edge_id: 'visual-to-reviewer', from: ['static-validation'], to: ['reviewer'], artifact: 'visual_parity_artifact', required: true },
	{ edge_id: 'findings-to-reviewer', from: ['finding-packets'], to: ['reviewer'], artifact: 'finding_packet_set', required: true },
	{ edge_id: 'publication-pr-evidence', from: ['static-publication'], to: ['reviewer'], artifact: 'static_site_pull_request', required: false, evidence_only: true },
	{ edge_id: 'validation-to-findings', from: ['static-validation'], to: ['finding-packets'], artifact: 'static_validation_run', required: true },
	{ edge_id: 'visual-to-findings', from: ['static-validation'], to: ['finding-packets'], artifact: 'visual_parity_artifact', required: true },
	{ edge_id: 'findings-to-iterator-groups', from: ['finding-packets'], to: ['iterator'], artifact: 'finding_group', required: true, fan_out: 'per_finding_group' },
	{ edge_id: 'revalidation-to-reviewer', from: ['revalidation'], to: ['reviewer'], artifact: 'revalidation_attempt', required: true },
	{ edge_id: 'iterator-issue-evidence-to-reviewer', from: ['iterator'], to: ['reviewer'], artifact: 'iterator_upstream_issue', required: false, evidence_only: true },
	{ edge_id: 'iterator-pr-evidence-to-reviewer', from: ['iterator'], to: ['reviewer'], artifact: 'iterator_upstream_pull_request', required: false, evidence_only: true },
];

function handoff({ consumes = [], emits = [] } = {}) {
	return { consumes, emits, artifacts: [...consumes, ...emits] };
}

function bundleInputs(agent_id, extra = {}) {
	const bundle = agentBundles[agent_id];
	return runtimeBundleExecution({
		packageSource: bundle.bundle,
		packageSlug: bundle.slug,
		workflowId: bundle.flow,
		ability: runtimePackageAbilityId,
		input: {
			wait_for_completion: true,
			...extra,
		},
	});
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
			controller_primitives: 'https://github.com/Extra-Chill/homeboy/pull/5152',
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
		abilities: [runtimePackageAbilityId],
		metadata,
	})),
	abilities: abilityIds.map((ability_id) => ({ ability_id })),
	workflows: [
		{
			workflow_id: 'store-idea',
			agent_id: 'store_idea',
			prompt: 'Produce a commerce concept packet for the WPSG static-site generation loop.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('store_idea'),
			...handoff({ emits: ['concept_packet'] }),
		},
		{
			workflow_id: 'website-idea',
			agent_id: 'website_idea',
			prompt: 'Produce a content-site concept packet for the WPSG static-site generation loop.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('website_idea'),
			...handoff({ emits: ['concept_packet'] }),
		},
		{
			workflow_id: 'design-store',
			agent_id: 'design_store',
			prompt: 'Produce a design packet from a commerce concept packet for the WPSG static-site generation loop.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('design_store', { site_kind: 'store' }),
			...handoff({ consumes: ['concept_packet'], emits: ['design_packet'] }),
		},
		{
			workflow_id: 'design-website',
			agent_id: 'design_website',
			prompt: 'Produce a design packet from a content-site concept packet for the WPSG static-site generation loop.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('design_website', { site_kind: 'website' }),
			...handoff({ consumes: ['concept_packet'], emits: ['design_packet'] }),
		},
		{
			workflow_id: 'static-store',
			agent_id: 'static_store',
			prompt: 'Produce a commerce static-site candidate artifact from a WPSG design packet.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('static_store', { site_kind: 'store' }),
			...handoff({ consumes: ['concept_packet', 'design_packet'], emits: ['static_site_candidate'] }),
			dependencies: ['wp-site-generator'],
		},
		{
			workflow_id: 'static-site',
			agent_id: 'static_site',
			prompt: 'Produce a content static-site candidate artifact from a WPSG design packet.',
			abilities: [runtimePackageAbilityId],
			...bundleInputs('static_site', { site_kind: 'website' }),
			...handoff({ consumes: ['concept_packet', 'design_packet'], emits: ['static_site_candidate'] }),
			dependencies: ['wp-site-generator'],
		},
		{
			workflow_id: 'static-validation',
			tasks: ['Validate a StaticSiteCandidate artifact through SSI import, static checks, and visual parity before any generated-site pull request is published.'],
			...handoff({ consumes: ['static_site_candidate'], emits: ['static_validation_run', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'blocks-engine'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
		},
		{
			workflow_id: 'static-publication-gate',
			tasks: ['Evaluate deterministic publication gates from validation and visual parity artifacts before any generated-site pull request is published.'],
			...handoff({ consumes: ['import_validation_result', 'visual_parity_artifact'], emits: ['static_site_publish_gate'] }),
			dependencies: ['wp-site-generator'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			publish_gate: {
				artifact: 'static_site_publish_gate',
				requires: ['publish_allowed', 'gates.fallback_blocks.passed', 'gates.conversion_findings.passed', 'gates.visual_parity.passed'],
				passing_value: true,
			},
		},
		{
			workflow_id: 'static-publication',
			tasks: ['Publish one generated-site pull request from a validated StaticSiteCandidate only when the deterministic StaticSitePublishGate allows publication.'],
			abilities: ['github_pull_request_publish'],
			...handoff({ consumes: ['static_site_candidate', 'import_validation_result', 'static_site_publish_gate'], emits: ['static_site_pull_request'] }),
			dependencies: ['wp-site-generator'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			publish_gate: {
				artifact: 'static_site_publish_gate',
				requires: ['publish_allowed'],
				passing_value: true,
			},
		},
		{
			workflow_id: 'finding-packets',
			tasks: ['Group SSI and Blocks Engine transformer diagnostic artifacts into finding packets for upstream routing.'],
			...handoff({ consumes: ['import_validation_result', 'static_validation_run', 'visual_parity_artifact'], emits: ['finding_packet_set', 'finding_group'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'blocks-engine'],
		},
		{
			workflow_id: 'iterator',
			agent_id: 'php_transformer_iterator',
			prompt: 'Route each finding group to the owning SSI stack repository and open the focused upstream issue or pull request described by the packet evidence.',
			abilities: [runtimePackageAbilityId, 'github_issue_publish', 'github_pull_request_publish', 'comment_github_pull_request'],
			...handoff({ consumes: ['finding_group'], emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'] }),
			fan_out: {
				mode: 'per_artifact',
				artifact: 'finding_group',
				group_by: ['owner_repo', 'root_cause', 'group_id'],
				requires_non_empty: true,
			},
			dependencies: ['static-site-importer', 'blocks-engine', 'homeboy-extensions'],
		},
		{
			workflow_id: 'revalidation',
			tasks: ['Revalidate the static-site candidate from candidate, validation, visual parity, and finding artifacts without requiring a generated-site or upstream pull request.'],
			...handoff({ consumes: ['static_site_candidate', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'], emits: ['revalidation_attempt', 'static_validation_run', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'blocks-engine'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
			metrics: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
		},
		{
			workflow_id: 'reviewer',
			agent_id: 'ssi_stack_reviewer',
			prompt: 'Review candidate, validation, visual parity, finding, and revalidation artifacts before promotion. Treat generated-site and upstream GitHub issue/PR URLs as optional publication evidence only.',
			abilities: [runtimePackageAbilityId, 'comment_github_pull_request'],
			...handoff({ consumes: ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt'], emits: ['reviewer_gate_outcome'] }),
			dependencies: ['wp-site-generator', 'static-site-importer', 'blocks-engine'],
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
		required: !['static_site_pull_request', 'iterator_upstream_issue', 'iterator_upstream_pull_request'].includes(artifact_id),
		...(['static_site_pull_request', 'iterator_upstream_issue', 'iterator_upstream_pull_request'].includes(artifact_id) ? { evidence_only: true } : {}),
	})),
	dependencies: [
		{ dependency_id: 'wp-site-generator', kind: 'repo', value: 'chubes4/wp-site-generator', required: true },
		{ dependency_id: 'static-site-importer', kind: 'repo', value: 'chubes4/static-site-importer', required: true },
		{ dependency_id: 'blocks-engine', kind: 'repo', value: 'Automattic/blocks-engine', required: true },
		{ dependency_id: 'homeboy-extensions', kind: 'repo', value: 'Extra-Chill/homeboy-extensions', required: true },
	],
	gates: [
		{ gate_id: 'fallback_blocks', description: 'SSI import must not emit fallback blocks.', metrics: ['fallback_blocks'] },
		{ gate_id: 'conversion_findings', description: 'SSI and Blocks Engine transformer diagnostics must not include actionable conversion findings.', metrics: ['conversion_findings'] },
		{ gate_id: 'visual_parity', description: 'Visual parity artifact must report no mismatches or delta.', metrics: ['visual_parity'] },
		{ gate_id: 'reviewer_evidence', description: 'Reviewer evidence must use durable candidate, validation, visual, finding, and revalidation artifact references; GitHub URLs are optional publication evidence.', metrics: ['reviewer_evidence'] },
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
			description: 'Actionable conversion finding count reported by SSI and Blocks Engine transformer diagnostics.',
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
			description: 'Durable candidate, validation, visual parity, finding, and revalidation evidence references for the reviewer gate.',
			input: {
				requires: ['static_site_candidate.artifact_url', 'import_validation_result.artifact_url', 'static_validation_run.artifact_url', 'visual_parity_artifact.artifact_url', 'finding_packet_set.artifact_url', 'revalidation_attempt.artifact_url'],
				optional_publication_evidence: ['static_site_pull_request.url', 'iterator_upstream_issue.url', 'iterator_upstream_pull_request.url'],
				forbids: ['localhost', '127.0.0.1', '/Users/'],
			},
		},
	],
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(controller, null, 2)}\n`);
console.log(outputPath);
