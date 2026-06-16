#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = process.env.GITHUB_WORKSPACE || process.cwd();
const outputPath = args.get('--output') || process.env.HOMEBOY_CONTROLLER_SPEC_PATH || path.join(root, '.github/homeboy/controllers/static-site-generation-loop.controller.json');
const artifacts = {
	concept_packet: { schema: 'wp-site-generator/ConceptPacket/v1' },
	design_packet: { schema: 'wp-site-generator/DesignPacket/v1' },
	static_site_candidate: { schema: 'wp-site-generator/StaticSiteCandidate/v1' },
	import_validation_result: { schema: 'wp-site-generator/ImportValidationResult/v1' },
	static_site_pull_request: { schema: 'github/PullRequest/v1' },
	static_validation_run: { schema: 'homeboy/Run/v1' },
	visual_parity_artifact: { schema: 'wp-site-generator/VisualParityArtifact/v1' },
	finding_packet_set: { schema: 'wp-site-generator/FindingPacketSet/v1' },
	finding_group: { schema: 'wp-site-generator/FindingGroup/v1' },
	iterator_upstream_issue: { schema: 'github/Issue/v1' },
	iterator_upstream_pull_request: { schema: 'github/PullRequest/v1' },
	revalidation_attempt: { schema: 'wp-site-generator/RevalidationAttempt/v1' },
	reviewer_gate_outcome: { schema: 'wp-site-generator/SsiStackReviewerGate/v1' },
};

const controller = {
	schema: 'homeboy/controller-spec/v1',
	controller_id: 'wp-site-generator/static-site-generation-loop',
	title: 'Static Site Importer self-improving site-generation loop',
	description: 'WPSG-owned domain ingredient contract for generating a static-site candidate, validating it through Static Site Importer, routing finding groups, revalidating, and publishing only when quality metrics clear.',
	authority: {
		builder: '.github/scripts/build-homeboy-ssi-loop-controller.mjs',
		contract_issue: 'https://github.com/Extra-Chill/homeboy/issues/4658',
	},
	agents: {
		store_idea: { bundle: 'bundles/store-idea-agent', slug: 'store-idea-agent', emits: ['concept_packet'] },
		website_idea: { bundle: 'bundles/website-idea-agent', slug: 'website-idea-agent', emits: ['concept_packet'] },
		design_store: { bundle: 'bundles/design-store-agent', slug: 'design-store-agent', requires: ['concept_packet'], emits: ['design_packet'] },
		design_website: { bundle: 'bundles/design-website-agent', slug: 'design-website-agent', requires: ['concept_packet'], emits: ['design_packet'] },
		static_store: { bundle: 'bundles/static-store-agent', slug: 'static-store-agent', requires: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] },
		static_site: { bundle: 'bundles/static-site-agent', slug: 'static-site-agent', requires: ['design_packet'], emits: ['static_site_candidate', 'import_validation_result', 'static_site_pull_request'] },
		php_transformer_iterator: { bundle: 'bundles/php-transformer-iterator-agent', slug: 'php-transformer-iterator-agent', requires: ['finding_group'], emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'] },
		ssi_stack_reviewer: { bundle: 'bundles/ssi-stack-reviewer-agent', slug: 'ssi-stack-reviewer-agent', requires: ['static_site_pull_request', 'static_validation_run', 'visual_parity_artifact'], emits: ['reviewer_gate_outcome'] },
	},
	tools: {
		abilities: [
			'datamachine/run-agent-bundle',
			'github_issue_publish',
			'github_pull_request_publish',
			'comment_github_pull_request',
			'wp-site-generator/materialize-packet',
		],
		ability_tools: [
			{ name: 'wpsg_materialize_packet', ability: 'wp-site-generator/materialize-packet' },
		],
	},
	workflows: {
		generation: {
			requires: [],
			emits: ['concept_packet', 'design_packet', 'static_site_candidate', 'import_validation_result', 'static_site_pull_request'],
			uses_agents: ['store_idea', 'website_idea', 'design_store', 'design_website', 'static_store', 'static_site'],
			uses_tools: ['datamachine/run-agent-bundle', 'github_pull_request_publish', 'wpsg_materialize_packet'],
		},
		static_validation: {
			requires: ['static_site_pull_request'],
			emits: ['static_validation_run', 'import_validation_result', 'visual_parity_artifact'],
		},
		finding_packets: {
			requires_any: ['import_validation_result', 'static_validation_run', 'visual_parity_artifact'],
			emits: ['finding_packet_set', 'finding_group'],
		},
		iterator: {
			requires: ['finding_group'],
			emits: ['iterator_upstream_issue', 'iterator_upstream_pull_request'],
			uses_agents: ['php_transformer_iterator'],
			uses_tools: ['datamachine/run-agent-bundle', 'github_issue_publish', 'github_pull_request_publish', 'comment_github_pull_request'],
		},
		revalidation: {
			requires: ['static_site_pull_request', 'iterator_upstream_pull_request'],
			emits: ['revalidation_attempt', 'static_validation_run', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'],
			gates: ['fallback_blocks', 'conversion_findings', 'visual_parity'],
		},
		reviewer: {
			requires: ['static_site_pull_request', 'static_validation_run', 'visual_parity_artifact'],
			requires_any: ['finding_packet_set', 'iterator_upstream_pull_request'],
			emits: ['reviewer_gate_outcome'],
			uses_agents: ['ssi_stack_reviewer'],
			uses_tools: ['datamachine/run-agent-bundle', 'comment_github_pull_request'],
		},
	},
	artifacts,
	dependencies: [
		{ repo: 'chubes4/wp-site-generator', role: 'generated source and WPSG domain policy' },
		{ repo: 'chubes4/static-site-importer', role: 'SSI import/source-selection/asset-map behavior' },
		{ repo: 'chubes4/html-to-blocks-converter', role: 'HTML-to-block conversion behavior' },
		{ repo: 'chubes4/block-format-bridge', role: 'block serialization/scope/report behavior' },
		{ repo: 'chubes4/block-artifact-compiler', role: 'artifact schema/compiler behavior' },
	],
	gates: {
		fallback_blocks: {
			metric_paths: ['import_validation_result.metrics.fallback_blocks', 'import_validation_result.metrics.fallback_block_count', 'import_validation_result.metrics.ssi_fallback_count'],
			pass_when: 'value === 0',
		},
		conversion_findings: {
			metric_paths: ['import_validation_result.metrics.conversion_findings', 'finding_packet_set.actionable_conversion_count'],
			pass_when: 'value === 0',
			actionable_kinds: ['unsupported_html_fallback', 'core_html_block', 'freeform_block'],
		},
		visual_parity: {
			metric_paths: ['visual_parity_artifact.summary.status', 'visual_parity_artifact.summary.mismatch_count', 'visual_parity_artifact.summary.max_delta_ratio'],
			pass_when: 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0',
		},
		reviewer_evidence: {
			requires: ['static_site_pull_request.url', 'static_validation_run.artifact_url', 'visual_parity_artifact.artifact_url'],
			forbids: ['localhost', '127.0.0.1', '/Users/'],
		},
	},
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
