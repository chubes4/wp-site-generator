export const codeboxRuntimeApi = Object.freeze({
	providerProfile: Object.freeze({
		id: 'wp-codebox',
		provider: 'wp-codebox',
	}),
	providerRuntimeInvocation: Object.freeze({
		schema: 'wp-codebox/provider-runtime-invocation-contract/v1',
		version: 1,
		tasks: Object.freeze({
			workspaceCapture: 'wp-codebox.runner-workspace.capture',
			workspaceCommand: 'wp-codebox.runner-workspace.command',
			workspacePublish: 'wp-codebox.runner-workspace.publish',
			toolCallTranscriptRecord: 'wp-codebox.tool-call-transcript.record',
			artifactHandoff: 'wp-codebox.artifact-handoff',
		}),
		abilities: Object.freeze({
			workspaceCapture: 'wp-codebox/runner-workspace-capture',
			workspaceCommand: 'wp-codebox/runner-workspace-command',
			workspacePublish: 'wp-codebox/runner-workspace-publish',
			toolCallTranscriptRecord: 'wp-codebox/record-tool-call-transcript',
			artifactHandoff: 'wp-codebox/handoff-artifacts',
		}),
		result_schemas: Object.freeze({
			workspace_capture: 'wp-codebox/runner-workspace-capture-result/v1',
			workspace_command: 'wp-codebox/runner-workspace-command-result/v1',
			workspace_publication: 'wp-codebox/runner-workspace-publication-result/v1',
			tool_call_transcript: 'wp-codebox/tool-call-transcript/v1',
			evidence_artifact_envelope: 'wp-codebox/evidence-artifact-envelope/v1',
		}),
	}),
	visualParity: Object.freeze({
		outputRoot: 'visual-parity-artifacts',
	}),
	runtimeSchemas: Object.freeze({
		workspaceRecipe: 'wp-codebox/workspace-recipe/v1',
		validationArtifactEnvelope: 'wp-codebox/validation-artifact-envelope/v1',
	}),
	preview: Object.freeze({
		playgroundUrl: 'https://playground.wordpress.net/',
	}),
});

export function codeboxProviderRuntimeInvocationContract() {
	return JSON.parse(JSON.stringify(codeboxRuntimeApi.providerRuntimeInvocation));
}

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
	return codeboxRuntimeApi.providerRuntimeInvocation.abilities.workspaceCommand;
}

export function codeboxRunnerWorkspacePublishAbility() {
	return codeboxRuntimeApi.providerRuntimeInvocation.abilities.workspacePublish;
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
