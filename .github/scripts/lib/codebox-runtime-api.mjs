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

export function buildCodeboxPlaygroundPreviewUrl(blueprint) {
	return `${codeboxRuntimeApi.preview.playgroundUrl}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}
