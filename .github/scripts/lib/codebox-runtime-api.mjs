import path from 'node:path';

export const codeboxRuntimeApi = Object.freeze({
	provider: 'codebox',
	abilities: Object.freeze({
		runRuntimePackage: 'agents/run-runtime-package',
		workspaceCapture: 'wp-codebox/runner-workspace-capture',
		workspaceCommand: 'wp-codebox/runner-workspace-command',
		workspacePublish: 'wp-codebox/runner-workspace-publish',
		toolCallTranscriptRecord: 'wp-codebox/record-tool-call-transcript',
		artifactHandoff: 'wp-codebox/handoff-artifacts',
	}),
	componentPaths: Object.freeze({
		wpCodeboxCli: '.ci/wp-codebox/packages/cli/dist/index.js',
		wpSiteGeneratorPluginMount: '/wordpress/wp-content/plugins/wp-site-generator',
	}),
	visualParity: Object.freeze({
		outputRoot: 'visual-parity-artifacts',
	}),
	runtimeSchemas: Object.freeze({
		workspaceRecipe: 'wp-codebox/workspace-recipe/v1',
	}),
});

export const runtimeApiAbilities = Object.freeze({
	runRuntimePackage: codeboxRuntimeApi.abilities.runRuntimePackage,
});

export const codeboxRuntimeBackend = Object.freeze({
	provider: codeboxRuntimeApi.provider,
	workspaceCaptureAbility: codeboxRuntimeApi.abilities.workspaceCapture,
	workspaceCommandAbility: codeboxRuntimeApi.abilities.workspaceCommand,
	workspacePublishAbility: codeboxRuntimeApi.abilities.workspacePublish,
	toolCallTranscriptRecordAbility: codeboxRuntimeApi.abilities.toolCallTranscriptRecord,
	artifactHandoffAbility: codeboxRuntimeApi.abilities.artifactHandoff,
});

export const runtimeAbilityNames = Object.freeze({
	workspaceCapture: codeboxRuntimeApi.abilities.workspaceCapture,
	workspaceCommand: codeboxRuntimeApi.abilities.workspaceCommand,
	workspacePublish: codeboxRuntimeApi.abilities.workspacePublish,
	toolCallTranscriptRecord: codeboxRuntimeApi.abilities.toolCallTranscriptRecord,
	artifactHandoff: codeboxRuntimeApi.abilities.artifactHandoff,
});

export const runtimePackageProfile = Object.freeze({
	id: 'wpsg-agent-runtime-package',
	compatibilityId: 'wpsg-codebox-runtime-package',
	provider: codeboxRuntimeApi.provider,
	runtimeTaskAbility: codeboxRuntimeApi.abilities.runRuntimePackage,
	runtimeBundleAbility: codeboxRuntimeApi.abilities.runRuntimePackage,
	runtimeWorkflowAbility: codeboxRuntimeApi.abilities.runRuntimePackage,
});

export const runtimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: 'workspace-iteration',
		abilityRequirements: Object.freeze([
			runtimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeApi.abilities.workspaceCommand,
			codeboxRuntimeApi.abilities.workspacePublish,
		]),
		abilityTools: Object.freeze([
			{ name: 'workspace_clone', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_worktree_add', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_read', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_write', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_edit', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_git_status', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_git_commit', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'workspace_git_push', ability: codeboxRuntimeApi.abilities.workspaceCommand },
			{ name: 'create_github_pull_request', ability: codeboxRuntimeApi.abilities.workspacePublish },
			{ name: 'create_github_issue', ability: codeboxRuntimeApi.abilities.workspacePublish },
		]),
	}),
	workspacePublication: Object.freeze({
		id: 'workspace-publication',
		abilityRequirements: Object.freeze([
			runtimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeApi.abilities.workspacePublish,
		]),
		abilityTools: Object.freeze([]),
	}),
});

export function runtimePackageProfiles() {
	const profile = {
		id: runtimePackageProfile.id,
		runtime_task_ability: runtimePackageProfile.runtimeTaskAbility,
		runtime_bundle_ability: runtimePackageProfile.runtimeBundleAbility,
		runtime_workflow_ability: runtimePackageProfile.runtimeWorkflowAbility,
		ability_requirements: [runtimePackageProfile.runtimeTaskAbility],
	};
	return {
		[runtimePackageProfile.id]: profile,
		[runtimePackageProfile.compatibilityId]: {
			...profile,
			id: runtimePackageProfile.compatibilityId,
		},
	};
}

export function resolveWpCodeboxCliPath(repoRoot, env = process.env) {
	return env.WP_CODEBOX_CLI || path.join(repoRoot, codeboxRuntimeApi.componentPaths.wpCodeboxCli);
}

export function resolveVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || codeboxRuntimeApi.visualParity.outputRoot;
}

export function wpSiteGeneratorPluginMountTarget() {
	return codeboxRuntimeApi.componentPaths.wpSiteGeneratorPluginMount;
}

export function codeboxWorkspaceRecipeSchema() {
	return codeboxRuntimeApi.runtimeSchemas.workspaceRecipe;
}
