import path from 'node:path';

import {
	runtimeApiAbilities,
	runtimePackageProfile,
	runtimePackageProfiles,
	readAgentRuntimeContract,
	runtimeToolProfileInputs,
	runtimeWorkflowInputs,
} from './agent-runtime-api.mjs';

export const codeboxRuntimeApi = Object.freeze({
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

export function codeboxRuntimePackageAbility() {
	return runtimeApiAbilities.runRuntimePackage;
}

export function codeboxRuntimeProvider() {
	return 'wp-codebox';
}

export function codeboxRuntimeProfileId() {
	return runtimePackageProfile.id;
}

export function codeboxRuntimePackageProfiles(contract = readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_PROVIDER: 'wp-codebox',
})) {
	return runtimePackageProfiles(contract);
}

export function codeboxRuntimeToolProfileInputs(profileId, contract = readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: 'wp-codebox/runner-workspace-command',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: 'wp-codebox/runner-workspace-publish',
})) {
	return runtimeToolProfileInputs(profileId, contract);
}

export function codeboxRuntimeWorkflowInputs(profileId, contract = readAgentRuntimeContract({
	HOMEBOY_AGENT_RUNTIME_PROVIDER: 'wp-codebox',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_COMMAND_ABILITY: 'wp-codebox/runner-workspace-command',
	HOMEBOY_AGENT_RUNTIME_WORKSPACE_PUBLISH_ABILITY: 'wp-codebox/runner-workspace-publish',
})) {
	return runtimeWorkflowInputs(profileId, contract);
}

export function resolveWpCodeboxCliPath(repoRoot, env = process.env) {
	return env.WP_CODEBOX_CLI || path.join(repoRoot, codeboxRuntimeApi.componentPaths.wpCodeboxCli);
}

export function resolveCodeboxCliPath(repoRoot, env = process.env) {
	return resolveWpCodeboxCliPath(repoRoot, env);
}

export function resolveVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || codeboxRuntimeApi.visualParity.outputRoot;
}

export function resolveCodeboxVisualParityOutputRoot(env = process.env) {
	return resolveVisualParityOutputRoot(env);
}

export function wpSiteGeneratorPluginMountTarget() {
	return codeboxRuntimeApi.componentPaths.wpSiteGeneratorPluginMount;
}

export function codeboxPluginMountTarget() {
	return wpSiteGeneratorPluginMountTarget();
}

export function codeboxWorkspaceRecipeSchema() {
	return codeboxRuntimeApi.runtimeSchemas.workspaceRecipe;
}
