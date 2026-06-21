import path from 'node:path';

const codeboxRuntimeContract = Object.freeze({
	provider: 'wp-codebox',
	compatibilityProvider: 'codebox',
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
	preview: Object.freeze({
		playgroundUrl: 'https://playground.wordpress.net/',
	}),
});

const codeboxRuntimePackageProfile = Object.freeze({
	id: 'wpsg-agent-runtime-package',
	compatibilityId: 'wpsg-codebox-runtime-package',
	provider: codeboxRuntimeContract.provider,
	compatibilityProvider: codeboxRuntimeContract.compatibilityProvider,
	runtimeTaskAbility: codeboxRuntimeContract.abilities.runRuntimePackage,
	runtimeBundleAbility: codeboxRuntimeContract.abilities.runRuntimePackage,
	runtimeWorkflowAbility: codeboxRuntimeContract.abilities.runRuntimePackage,
});

const codeboxRuntimeToolProfiles = Object.freeze({
	workspaceIteration: Object.freeze({
		id: 'workspace-iteration',
		abilityRequirements: Object.freeze([
			codeboxRuntimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeContract.abilities.workspaceCommand,
			codeboxRuntimeContract.abilities.workspacePublish,
		]),
		abilityTools: Object.freeze([
			{ name: 'workspace_clone', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_worktree_add', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_read', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_write', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_edit', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_git_status', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_git_commit', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'workspace_git_push', ability: codeboxRuntimeContract.abilities.workspaceCommand },
			{ name: 'create_github_pull_request', ability: codeboxRuntimeContract.abilities.workspacePublish },
			{ name: 'create_github_issue', ability: codeboxRuntimeContract.abilities.workspacePublish },
		]),
	}),
	workspacePublication: Object.freeze({
		id: 'workspace-publication',
		abilityRequirements: Object.freeze([
			codeboxRuntimePackageProfile.runtimeTaskAbility,
			codeboxRuntimeContract.abilities.workspacePublish,
		]),
		abilityTools: Object.freeze([]),
	}),
});

export function codeboxRuntimePackageAbility() {
	return codeboxRuntimePackageProfile.runtimeTaskAbility;
}

export function codeboxRuntimeProvider() {
	return codeboxRuntimePackageProfile.provider;
}

export function codeboxRuntimeProfileId() {
	return codeboxRuntimePackageProfile.id;
}

export function codeboxRuntimePackageProfiles() {
	const profile = {
		schema: 'homeboy/runtime-profile/v1',
		id: codeboxRuntimePackageProfile.id,
		runtime_task_ability: codeboxRuntimePackageProfile.runtimeTaskAbility,
		runtime_bundle_ability: codeboxRuntimePackageProfile.runtimeBundleAbility,
		runtime_workflow_ability: codeboxRuntimePackageProfile.runtimeWorkflowAbility,
		ability_requirements: [codeboxRuntimePackageProfile.runtimeTaskAbility],
	};
	return {
		[codeboxRuntimePackageProfile.id]: profile,
		[codeboxRuntimePackageProfile.compatibilityId]: {
			...profile,
			id: codeboxRuntimePackageProfile.compatibilityId,
		},
	};
}

export function codeboxRuntimeToolProfileInputs(profileId) {
	const profile = codeboxRuntimeToolProfiles[profileId] || Object.values(codeboxRuntimeToolProfiles).find((candidate) => candidate.id === profileId);
	if (!profile) {
		throw new Error(`Unknown WPSG Codebox runtime tool profile: ${profileId}`);
	}
	return {
		ability_requirements: JSON.stringify(profile.abilityRequirements),
		ability_tools: JSON.stringify(profile.abilityTools),
	};
}

export function codeboxRuntimeWorkflowInputs(profileId) {
	return {
		runtime_provider: codeboxRuntimePackageProfile.provider,
		runtime_profile: codeboxRuntimePackageProfile.id,
		runtime_profiles: JSON.stringify(codeboxRuntimePackageProfiles()),
		...codeboxRuntimeToolProfileInputs(profileId),
	};
}

export function resolveCodeboxCliPath(repoRoot, env = process.env) {
	return env.WP_CODEBOX_CLI || path.join(repoRoot, codeboxRuntimeContract.componentPaths.wpCodeboxCli);
}

export function resolveCodeboxVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || codeboxRuntimeContract.visualParity.outputRoot;
}

export function codeboxPluginMountTarget() {
	return codeboxRuntimeContract.componentPaths.wpSiteGeneratorPluginMount;
}

export function codeboxWorkspaceRecipeSchema() {
	return codeboxRuntimeContract.runtimeSchemas.workspaceRecipe;
}

export function buildCodeboxPlaygroundPreviewUrl(blueprint) {
	return `${codeboxRuntimeContract.preview.playgroundUrl}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}
