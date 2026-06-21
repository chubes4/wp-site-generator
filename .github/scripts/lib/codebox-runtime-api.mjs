export const codeboxRuntimeApi = Object.freeze({
	providerProfile: Object.freeze({
		id: 'wp-codebox',
		provider: 'wp-codebox',
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

export function resolveVisualParityOutputRoot(env = process.env) {
	return env.VISUAL_PARITY_OUTPUT || codeboxRuntimeApi.visualParity.outputRoot;
}

export function codeboxWorkspaceRecipeSchema() {
	return codeboxRuntimeApi.runtimeSchemas.workspaceRecipe;
}

export function codeboxRuntimeWorkspaceRecipeSchema() {
	return codeboxWorkspaceRecipeSchema();
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

export function codeboxRuntimeProviderProfile() {
	return {
		...codeboxRuntimeApi.providerProfile,
		workspaceCommandAbility: codeboxRunnerWorkspaceCommandAbility(),
		workspacePublishAbility: codeboxRunnerWorkspacePublishAbility(),
	};
}

export function buildCodeboxPlaygroundPreviewUrl(blueprint) {
	return `${codeboxRuntimeApi.preview.playgroundUrl}#${encodeURIComponent(JSON.stringify(blueprint))}`;
}
