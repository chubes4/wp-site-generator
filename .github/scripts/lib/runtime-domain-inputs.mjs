import { wpsgLoopConfig } from './wpsg-domain-config.mjs';

const runtimePackageProfileId = wpsgLoopConfig.runtimePackageProfile;
const defaultRuntimeWorkspaceRecipeSchema = 'homeboy/runtime-workspace-recipe/v1';
const defaultValidationArtifactEnvelopeSchema = 'homeboy/validation-artifact-envelope/v1';
const defaultVisualParityOutputRoot = 'visual-parity-artifacts';

export const runtimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: wpsgLoopConfig.runtimeWorkloadProfiles.workspaceIteration,
		requirements: Object.freeze(['command', 'publish']),
		tools: Object.freeze([
			['workspace_clone', 'command'],
			['workspace_worktree_add', 'command'],
			['workspace_read', 'command'],
			['workspace_write', 'command'],
			['workspace_edit', 'command'],
			['workspace_git_status', 'command'],
			['workspace_git_commit', 'command'],
			['workspace_git_push', 'command'],
			['create_github_pull_request', 'publish'],
			['create_github_issue', 'publish'],
		]),
	}),
	workspacePublication: Object.freeze({
		id: wpsgLoopConfig.runtimeWorkloadProfiles.workspacePublication,
		requirements: Object.freeze(['publish']),
		tools: Object.freeze([]),
	}),
});

export function runtimeToolProfileInputs(profileId, env = process.env) {
	const profile = wpsgRuntimeToolProfile(profileId);
	const abilityByKind = {
		command: env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY,
		publish: env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY,
	};
	const abilityRequirements = unique([
		runtimePackageAbility(env),
		...profile.requirements.map((kind) => abilityByKind[kind]),
	]);
	const abilityTools = profile.tools
		.map(([name, kind]) => ({ name, ability: abilityByKind[kind] }))
		.filter((tool) => tool.ability);

	return {
		ability_requirements: JSON.stringify(abilityRequirements),
		ability_tools: JSON.stringify(abilityTools),
	};
}

export function runtimePackageProfiles(env = process.env) {
	const ability = runtimePackageAbility(env);
	return {
		[runtimePackageProfileId]: {
			schema: 'homeboy/runtime-profile/v1',
			id: runtimePackageProfileId,
			runtime_task_ability: ability,
			runtime_bundle_ability: ability,
			runtime_workflow_ability: ability,
			ability_requirements: ability ? [ability] : [],
		},
	};
}

export function runtimePackageAbility(env = process.env) {
	return text(env.HOMEBOY_AGENT_RUNTIME_TASK_ABILITY);
}

export function runtimeBundleExecution({ packageSource, packageSlug, workflowId, input = {}, options = {}, ability = runtimePackageAbility() } = {}) {
	if (!packageSource || !packageSlug || !workflowId) {
		throw new Error('packageSource, packageSlug, and workflowId are required for runtime bundle execution.');
	}
	if (!ability) {
		throw new Error('HOMEBOY_AGENT_RUNTIME_TASK_ABILITY is required for runtime bundle execution.');
	}

	return {
		runtime_execution: {
			kind: 'bundle',
			ability,
			input: {
				package: {
					source: packageSource,
					slug: packageSlug,
				},
				workflow: {
					id: workflowId,
				},
				input,
				...(Object.keys(options).length > 0 ? { options } : {}),
			},
		},
	};
}

export function runtimeWorkflowBuilderExecution({ kind, workflowBuilder, ...metadata } = {}) {
	if (!kind || !workflowBuilder) {
		throw new Error('kind and workflowBuilder are required for runtime workflow-builder execution.');
	}

	return {
		runtime_execution: {
			kind,
			workflow_builder: workflowBuilder,
			...metadata,
		},
	};
}

export function runtimeWorkspaceRecipeSchema(env = process.env) {
	return text(env.HOMEBOY_AGENT_RUNTIME_WORKSPACE_RECIPE_SCHEMA) || defaultRuntimeWorkspaceRecipeSchema;
}

export function runtimeValidationArtifactEnvelopeSchema(env = process.env) {
	return text(env.HOMEBOY_AGENT_RUNTIME_VALIDATION_ARTIFACT_ENVELOPE_SCHEMA) || defaultValidationArtifactEnvelopeSchema;
}

export function resolveVisualParityOutputRoot(env = process.env) {
	return text(env.VISUAL_PARITY_OUTPUT) || text(env.HOMEBOY_AGENT_RUNTIME_VISUAL_PARITY_OUTPUT) || defaultVisualParityOutputRoot;
}

export function buildRuntimePreviewUrl(options = {}) {
	const { blueprint, evidenceRefs = [], env = process.env } = Object.hasOwn(options, 'blueprint') || Object.hasOwn(options, 'evidenceRefs') || Object.hasOwn(options, 'env')
		? options
		: { blueprint: options };
	const evidenceUrl = previewUrlFromEvidenceRefs(Array.isArray(evidenceRefs) ? evidenceRefs : [evidenceRefs]);
	if (evidenceUrl) {
		return evidenceUrl;
	}
	if (env.HOMEBOY_RUNTIME_PREVIEW_URL) {
		return env.HOMEBOY_RUNTIME_PREVIEW_URL;
	}
	if (!env.HOMEBOY_AGENT_RUNTIME_PREVIEW_URL_BASE) {
		throw new Error('HOMEBOY_AGENT_RUNTIME_PREVIEW_URL_BASE or preview evidence refs are required for runtime preview URLs.');
	}
	return `${env.HOMEBOY_AGENT_RUNTIME_PREVIEW_URL_BASE}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}

function previewUrlFromEvidenceRefs(refs) {
	for (const ref of refs) {
		if (typeof ref === 'string' && /^https?:\/\//.test(ref)) {
			return ref;
		}
		if (!ref || typeof ref !== 'object') {
			continue;
		}
		const candidate = ref.preview_url || ref.url || ref.urls?.preview || ref.preview?.url || ref.evidence?.preview_url;
		if (candidate) {
			return candidate;
		}
	}
	return '';
}

function wpsgRuntimeToolProfile(profileId) {
	const profile = runtimeToolProfiles[profileId] || Object.values(runtimeToolProfiles).find((candidate) => candidate.id === profileId);
	if (!profile) {
		throw new Error(`Unknown WPSG runtime tool profile: ${profileId}`);
	}
	return profile;
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function text(value) {
	return String(value || '').trim();
}
