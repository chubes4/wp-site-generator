export function buildSingleAiWorkflowStep({ aiConfig = {}, flowStep = {}, label = 'AI workflow step', prompt, addedAt }) {
	return {
		step_type: 'ai',
		label: aiConfig.label || flowStep.label || label,
		system_prompt: aiConfig.system_prompt || flowStep.system_prompt || '',
		prompt_queue: [
			{
				prompt,
				added_at: addedAt,
			},
		],
		queue_mode: 'static',
		enabled_tools: flowStep.enabled_tools || [],
		disabled_tools: aiConfig.disabled_tools || flowStep.disabled_tools || [],
		completion_assertions: aiConfig.completion_assertions || flowStep.completion_assertions || {},
		tool_runtime_rules: aiConfig.tool_runtime_rules || flowStep.tool_runtime_rules || [],
	};
}

export function buildSingleAiWorkflow({ step, initialData = {} }) {
	return {
		workflow: {
			steps: [step],
		},
		initial_data: initialData,
	};
}
