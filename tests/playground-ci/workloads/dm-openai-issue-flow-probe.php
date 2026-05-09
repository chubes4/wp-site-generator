<?php
/**
 * Stage 5 OpenAI issue flow probe.
 *
 * Imports the wc-idea-agent bundle, configures OpenAI + GitHub credentials from
 * bench_env, runs a real AI pipeline step, and captures the GitHub issue URL
 * produced by the AI-visible publish handler tool.
 */

use DataMachine\Core\Database\Agents\Agents;
use DataMachine\Core\Database\Flows\Flows;
use DataMachine\Core\Database\Jobs\Jobs;
use DataMachine\Core\Database\Pipelines\Pipelines;
use DataMachine\Core\PluginSettings;
use DataMachine\Engine\AI\WpAiClientProviderAdmin;
use DataMachineCode\Handlers\GitHub\GitHubIssuePublish;

if (function_exists('wp_set_current_user')) {
    wp_set_current_user(1);
}

if (!function_exists('did_action') || !function_exists('do_action')) {
    return [
        'metrics' => ['has_actions_api' => 0],
        'metadata' => ['error' => 'WordPress action API not available'],
    ];
}

if (function_exists('wp_supports_ai') && !wp_supports_ai()) {
    return [
        'metrics' => ['wp_supports_ai' => 0],
        'metadata' => ['error' => 'WordPress AI client support is disabled'],
    ];
}

if (function_exists('WordPress\\OpenAiAiProvider\\register_provider')) {
    WordPress\OpenAiAiProvider\register_provider();
}

$openai_provider_registered = class_exists(WpAiClientProviderAdmin::class)
    && WpAiClientProviderAdmin::isProviderRegistered('openai');

if (!did_action('wp_abilities_api_categories_init')) {
    do_action('wp_abilities_api_categories_init');
}
if (!did_action('wp_abilities_api_init')) {
    do_action('wp_abilities_api_init');
}

if (!function_exists('wp_get_ability')) {
    return [
        'metrics' => ['has_abilities_api' => 0],
        'metadata' => ['error' => 'Abilities API not loaded (expected in WP core 6.9+)'],
    ];
}

$github_token = trim((string) (getenv('GITHUB_TOKEN') ?: getenv('GH_TOKEN') ?: ''));
$openai_api_key = trim((string) getenv('OPENAI_API_KEY'));
$target_repo = trim((string) (getenv('STAGE5_GITHUB_REPO') ?: 'chubes4/wc-site-generator'));
$openai_model = trim((string) (getenv('STAGE5_OPENAI_MODEL') ?: 'gpt-4o-mini'));
$proof_mode_raw = strtolower(trim((string) (getenv('STAGE5_PROOF_MODE') ?: 'true')));
$proof_mode = !in_array($proof_mode_raw, ['0', 'false', 'no', 'off'], true);

$metadata = [
    'target_repo' => $target_repo,
    'openai_model' => $openai_model,
    'proof_mode' => $proof_mode,
    'github_token_present' => $github_token !== '',
    'openai_key_present' => $openai_api_key !== '',
    'openai_provider_registered' => $openai_provider_registered,
];

if ($github_token === '' || $openai_api_key === '') {
    return [
        'metrics' => [
            'github_token_present' => $github_token !== '' ? 1 : 0,
            'openai_key_present' => $openai_api_key !== '' ? 1 : 0,
        ],
        'metadata' => $metadata + ['error' => 'GITHUB_TOKEN and OPENAI_API_KEY are required for Stage 5'],
    ];
}

if ($target_repo === '' || !str_contains($target_repo, '/')) {
    return [
        'metrics' => ['target_repo_valid' => 0],
        'metadata' => $metadata + ['error' => 'STAGE5_GITHUB_REPO must be owner/repo'],
    ];
}

$settings = function_exists('get_option') ? (array) get_option('datamachine_settings', []) : [];
$settings['github_credential_profiles'] = [
    [
        'id' => 'stage5-ci',
        'label' => 'Stage 5 CI token',
        'mode' => 'pat',
        'pat' => $github_token,
        'default_repo' => $target_repo,
        'allowed_repos' => [$target_repo],
    ],
];
$settings['github_default_profile_id'] = 'stage5-ci';
$settings['github_default_repo'] = $target_repo;
$settings['default_provider'] = 'openai';
$settings['default_model'] = $openai_model;
$settings['mode_models'] = [
    'pipeline' => ['provider' => 'openai', 'model' => $openai_model],
    'chat' => ['provider' => 'openai', 'model' => $openai_model],
    'system' => ['provider' => 'openai', 'model' => $openai_model],
];
$settings['max_turns'] = 3;
$settings['wp_ai_client_connect_timeout'] = 30;
update_option('datamachine_settings', $settings, false);
update_option('connectors_ai_openai_api_key', $openai_api_key, false);
PluginSettings::clearCache();

$required_abilities = [
    'datamachine/import-agent',
    'datamachine/run-flow',
    'datamachine/drain-job',
];
foreach ($required_abilities as $ability_name) {
    if (!wp_get_ability($ability_name)) {
        return [
            'metrics' => ['required_abilities_resolved' => 0],
            'metadata' => $metadata + ['error' => $ability_name . ' not registered'],
        ];
    }
}

if (!class_exists(Agents::class) || !class_exists(Pipelines::class) || !class_exists(Flows::class) || !class_exists(Jobs::class) || !class_exists(GitHubIssuePublish::class)) {
    return [
        'metrics' => ['required_classes_available' => 0],
        'metadata' => $metadata + ['error' => 'Required Data Machine/Data Machine Code classes are not available'],
    ];
}

$component_path = '/wordpress/wp-content/plugins/wc-site-generator-ci-driver';
$bundle_path = $component_path . '/bundles/wc-idea-agent';
$metadata += [
    'bundle_path' => $bundle_path,
    'bundle_exists' => is_dir($bundle_path),
    'bundle_manifest_exists' => is_file($bundle_path . '/manifest.json'),
];

if (!$metadata['bundle_exists'] || !$metadata['bundle_manifest_exists']) {
    return [
        'metrics' => ['bundle_exists' => $metadata['bundle_exists'] ? 1 : 0],
        'metadata' => $metadata + ['error' => 'Bundle directory missing or incomplete'],
    ];
}

$import_start_ns = hrtime(true);
$import_result = wp_get_ability('datamachine/import-agent')->execute([
    'source' => $bundle_path,
    'on_conflict' => 'skip',
]);
$import_elapsed_ms = (hrtime(true) - $import_start_ns) / 1_000_000;
$metadata['import_result'] = $import_result;

if (function_exists('is_wp_error') && is_wp_error($import_result)) {
    return [
        'metrics' => ['import_succeeded' => 0, 'import_elapsed_ms' => $import_elapsed_ms],
        'metadata' => $metadata + ['error' => 'datamachine/import-agent returned WP_Error: ' . $import_result->get_error_message()],
    ];
}

if (!is_array($import_result) || empty($import_result['success'])) {
    return [
        'metrics' => ['import_succeeded' => 0, 'import_elapsed_ms' => $import_elapsed_ms],
        'metadata' => $metadata + ['error' => 'datamachine/import-agent did not succeed'],
    ];
}

$agents = new Agents();
$pipelines = new Pipelines();
$flows = new Flows();
$jobs = new Jobs();

$agent = $agents->get_by_slug('wc-idea-agent');
if (!$agent) {
    return [
        'metrics' => ['import_succeeded' => 1, 'agent_resolved' => 0],
        'metadata' => $metadata + ['error' => 'Imported agent wc-idea-agent was not found'],
    ];
}

$agent_id = (int) $agent['agent_id'];
$agent_config = is_array($agent['agent_config'] ?? null) ? $agent['agent_config'] : [];
$agent_config['mode_models'] = $settings['mode_models'];
$agent_config['default_provider'] = 'openai';
$agent_config['default_model'] = $openai_model;
$agents->update_agent($agent_id, ['agent_config' => $agent_config]);
PluginSettings::clearCache();

$pipeline = $pipelines->get_by_portable_slug($agent_id, 'wc-idea-pipeline');
if (!$pipeline) {
    return [
        'metrics' => ['agent_resolved' => 1, 'pipeline_resolved' => 0],
        'metadata' => $metadata + ['agent_id' => $agent_id, 'error' => 'Imported pipeline wc-idea-pipeline was not found'],
    ];
}

$pipeline_id = (int) $pipeline['pipeline_id'];
$pipeline_config = is_array($pipeline['pipeline_config'] ?? null) ? $pipeline['pipeline_config'] : [];
if ($proof_mode) {
    $stage5_run_id = gmdate('YmdHis') . '-' . substr(md5((string) microtime(true)), 0, 6);
    $stage5_system_prompt = implode("\n\n", [
        'You are running a CI proof inside WordPress Playground.',
        'Call the github_issue_publish tool exactly once. Do not call any other tools. Do not mention secrets.',
        'Create a concise GitHub issue in ' . $target_repo . ' proving the imported Data Machine agent used a real OpenAI request from Playground.',
        'Title must start with: [Playground proof] Stage 5 OpenAI issue ' . $stage5_run_id,
        'Body must include these sections: Proof Path, Runtime, Verification, Cleanup. Say this issue can be closed after verification.',
    ]);

    foreach ($pipeline_config as &$pipeline_step_config) {
        if (($pipeline_step_config['step_type'] ?? '') === 'ai') {
            $pipeline_step_config['system_prompt'] = $stage5_system_prompt;
        }
    }
    unset($pipeline_step_config);
} else {
    $real_idea_system_prompt = implode("\n\n", [
        'You are the WC Idea Agent running inside WordPress Playground.',
        'Call the github_issue_publish tool exactly once. Do not call any other tools. Do not mention secrets.',
        'Create one distinct, buildable WooCommerce store concept in ' . $target_repo . ' for an underserved but visually interesting product category.',
        'Do not author implementation artifacts. Do not open pull requests or branches.',
        'Issue title shape: shopping-cart emoji, then the concept name, an em dash, and a one-line summary.',
        'Issue body sections, in this order: Recommended Concept; Who It Serves; What It Sells; Why It Could Work; Issue Overlap Check; Next Step.',
        'Use Next Step: move forward unless the recent issue corpus shows material overlap.',
    ]);

    foreach ($pipeline_config as &$pipeline_step_config) {
        if (($pipeline_step_config['step_type'] ?? '') === 'ai') {
            $pipeline_step_config['system_prompt'] = $real_idea_system_prompt;
        }
    }
    unset($pipeline_step_config);
}
$pipelines->update_pipeline($pipeline_id, ['pipeline_config' => $pipeline_config]);

$flow = $flows->get_by_portable_slug($pipeline_id, 'wc-idea-manual-flow');
if (!$flow) {
    return [
        'metrics' => ['pipeline_resolved' => 1, 'flow_resolved' => 0],
        'metadata' => $metadata + ['agent_id' => $agent_id, 'pipeline_id' => $pipeline_id, 'error' => 'Imported flow wc-idea-manual-flow was not found'],
    ];
}

$flow_id = (int) $flow['flow_id'];
$flow_config = is_array($flow['flow_config'] ?? null) ? $flow['flow_config'] : [];
foreach ($flow_config as &$flow_step_config) {
    if (($flow_step_config['step_type'] ?? '') === 'ai') {
        $flow_step_config['queue_mode'] = 'static';
        $flow_step_config['prompt_queue'] = [
            [
                'added_at' => gmdate('c'),
                'prompt' => $proof_mode
                    ? 'Run Stage 5 now. Publish one CI proof issue to ' . $target_repo . ' using the configured GitHub issue publish tool.'
                    : 'Generate and publish one real, buildable store concept issue to ' . $target_repo . '. Pick a visually interesting underserved category and use the required issue shape.',
            ],
        ];
    }
    if (($flow_step_config['step_type'] ?? '') === 'publish') {
        $flow_step_config['handler_configs']['github_issue']['repo'] = $target_repo;
        $flow_step_config['handler_configs']['github_issue']['labels'] = 'status:idea-ready';
        $flow_step_config['handler_slugs'] = ['github_issue'];
    }
}
unset($flow_step_config);
$flows->update_flow($flow_id, [
    'flow_config' => $flow_config,
    'agent_id' => $agent_id,
]);

if (!class_exists('WC_Site_Generator_Stage5_GitHub_Issue_Tool')) {
    class WC_Site_Generator_Stage5_GitHub_Issue_Tool {
        public function handle_tool_call(array $parameters, array $tool_def = []): array {
            $handler = new GitHubIssuePublish();
            $result = $handler->handle_tool_call($parameters, $tool_def);
            $job_id = (int) ($parameters['job_id'] ?? 0);
            if ($job_id > 0) {
                $data = is_array($result['data'] ?? null) ? $result['data'] : [];
                datamachine_merge_engine_data($job_id, [
                    'stage5_github_issue_publish' => [
                        'success' => is_array($result) && !empty($result['success']),
                        'repo' => (string) ($data['repo'] ?? ''),
                        'issue_url' => (string) ($data['issue_url'] ?? ''),
                        'html_url' => (string) ($data['html_url'] ?? ''),
                        'issue_number' => (int) ($data['issue_number'] ?? 0),
                        'title' => (string) ($data['title'] ?? ''),
                        'error' => !empty($result['success']) ? null : (string) ($result['error'] ?? 'GitHub issue publish failed'),
                    ],
                ]);
            }
            return $result;
        }
    }
}

add_filter('datamachine_resolved_tools', static function (array $tools): array {
    if (isset($tools['github_issue_publish'])) {
        $tools['github_issue_publish']['class'] = 'WC_Site_Generator_Stage5_GitHub_Issue_Tool';
        $tools['github_issue_publish']['method'] = 'handle_tool_call';
    }
    return $tools;
}, 100, 1);

$run_start_ns = hrtime(true);
$run_result = wp_get_ability('datamachine/run-flow')->execute(['flow_id' => $flow_id]);
$run_elapsed_ms = (hrtime(true) - $run_start_ns) / 1_000_000;
$metadata['run_result'] = $run_result;

$job_id = is_array($run_result) ? (int) ($run_result['job_id'] ?? 0) : 0;
if (!is_array($run_result) || empty($run_result['success']) || $job_id <= 0) {
    return [
        'metrics' => ['run_flow_succeeded' => 0, 'run_elapsed_ms' => $run_elapsed_ms],
        'metadata' => $metadata + [
            'agent_id' => $agent_id,
            'pipeline_id' => $pipeline_id,
            'flow_id' => $flow_id,
            'error' => 'datamachine/run-flow failed or returned no job_id',
        ],
    ];
}

$drain_start_ns = hrtime(true);
$drain_result = wp_get_ability('datamachine/drain-job')->execute([
    'job_id' => $job_id,
    'step_budget' => 8,
    'time_budget_ms' => 120000,
]);
$drain_elapsed_ms = (hrtime(true) - $drain_start_ns) / 1_000_000;
$metadata['drain_result'] = $drain_result;

$job = $jobs->get_job($job_id);
$job_status = is_array($job) ? (string) ($job['status'] ?? '') : '';
$engine_data = datamachine_get_engine_data($job_id);
$publish_result = is_array($engine_data['stage5_github_issue_publish'] ?? null) ? $engine_data['stage5_github_issue_publish'] : [];
$token_usage = is_array($engine_data['token_usage'] ?? null) ? $engine_data['token_usage'] : [];

$issue_url = (string) (($publish_result['html_url'] ?? '') ?: ($publish_result['issue_url'] ?? ''));
$publish_succeeded = !empty($publish_result['success']) && $issue_url !== '';
$drain_succeeded = is_array($drain_result) && !empty($drain_result['success']);
$job_completed = $job_status === 'completed';

$error_snapshot = array_filter([
    'error_reason' => $engine_data['error_reason'] ?? null,
    'error_step_id' => $engine_data['error_step_id'] ?? null,
    'error_message' => $engine_data['error_message'] ?? null,
]);

$metadata += [
    'agent_id' => $agent_id,
    'pipeline_id' => $pipeline_id,
    'flow_id' => $flow_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
    'publish_result' => $publish_result,
    'issue_url' => $issue_url,
    'token_usage' => $token_usage,
    'error_snapshot' => $error_snapshot,
    'error_message' => (string) ($error_snapshot['error_message'] ?? ''),
];

return [
    'metrics' => [
        'github_token_present' => 1,
        'openai_key_present' => 1,
        'openai_provider_registered' => $openai_provider_registered ? 1 : 0,
        'target_repo_valid' => 1,
        'required_abilities_resolved' => 1,
        'required_classes_available' => 1,
        'bundle_exists' => 1,
        'import_succeeded' => 1,
        'import_elapsed_ms' => $import_elapsed_ms,
        'agent_resolved' => 1,
        'pipeline_resolved' => 1,
        'flow_resolved' => 1,
        'run_flow_succeeded' => 1,
        'run_elapsed_ms' => $run_elapsed_ms,
        'drain_succeeded' => $drain_succeeded ? 1 : 0,
        'drain_elapsed_ms' => $drain_elapsed_ms,
        'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
        'publish_succeeded' => $publish_succeeded ? 1 : 0,
        'job_completed' => $job_completed ? 1 : 0,
        'openai_total_tokens' => (int) ($token_usage['total_tokens'] ?? 0),
    ],
    'metadata' => $metadata,
];
