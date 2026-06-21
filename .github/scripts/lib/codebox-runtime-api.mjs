import path from 'node:path';

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
		validationArtifactEnvelope: 'wp-codebox/validation-artifact-envelope/v1',
	}),
	abilities: Object.freeze({
		runnerWorkspaceCommand: 'wp-codebox/runner-workspace-command',
		runnerWorkspacePublish: 'wp-codebox/runner-workspace-publish',
	}),
	preview: Object.freeze({
		playgroundUrl: 'https://playground.wordpress.net/',
	}),
});

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

export function codeboxValidationArtifactEnvelopeSchema() {
	return codeboxRuntimeApi.runtimeSchemas.validationArtifactEnvelope;
}

export function codeboxRunnerWorkspaceCommandAbility() {
	return codeboxRuntimeApi.abilities.runnerWorkspaceCommand;
}

export function codeboxRunnerWorkspacePublishAbility() {
	return codeboxRuntimeApi.abilities.runnerWorkspacePublish;
}

export function buildCodeboxPlaygroundPreviewUrl(blueprint) {
	return `${codeboxRuntimeApi.preview.playgroundUrl}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}
