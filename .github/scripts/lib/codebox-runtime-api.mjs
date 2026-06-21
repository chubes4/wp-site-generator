export const codeboxRuntimeApi = Object.freeze({
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

export function resolveVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || codeboxRuntimeApi.visualParity.outputRoot;
}

export function codeboxRuntimeWorkspaceRecipeSchema() {
	return codeboxRuntimeApi.runtimeSchemas.workspaceRecipe;
}

export function buildCodeboxPlaygroundPreviewUrl(blueprint) {
	return `${codeboxRuntimeApi.preview.playgroundUrl}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}
