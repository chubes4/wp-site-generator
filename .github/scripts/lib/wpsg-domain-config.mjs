export const wpsgLoopConfig = Object.freeze({
	repository: 'chubes4/wp-site-generator',
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
