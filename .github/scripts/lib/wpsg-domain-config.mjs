export const wpsgLoopConfig = Object.freeze({
	repository: 'chubes4/wp-site-generator',
	controllerSpecPath: '.github/homeboy/controllers/static-site-generation-loop.controller.json',
	complexityPolicyId: 'wpsg-complexity-policy',
	complexityPolicyPath: '.github/site-generation-complexity-policy.json',
	defaultWebsiteFlowSlug: 'website-idea-artifact-flow',
	defaultArtifactRoot: '.ci/homeboy-agent-task-artifacts',
	defaultRefPolicy: 'branch-defaults',
	productionRefPolicy: 'production',
	runtimeWorkloadProfiles: Object.freeze({
		workspaceIteration: 'workspace-iteration',
		workspacePublication: 'workspace-publication',
	}),
	runtimePackageProfile: 'wpsg-agent-runtime-package',
});

export function siteGenerationLoopId(runId) {
	return `wp-site-generator/static-site-generation-loop/${requiredLoopIdSegment(runId)}`;
}

function requiredLoopIdSegment(value) {
	const segment = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	if (!segment) {
		throw new Error('Site generation loop run id is required.');
	}
	return segment;
}
