<?php
/**
 * Imports and runs the wc-static-site-agent against a single supplied
 * status:idea-ready issue, then captures the resulting static-site PR URL,
 * branch, and slug from the github_pull_request_publish tool call.
 */

use DataMachine\Core\Database\Agents\Agents;
use DataMachine\Core\Database\Chat\ConversationStoreFactory;
use DataMachine\Core\Database\Flows\Flows;
use DataMachine\Core\Database\Jobs\Jobs;
use DataMachine\Core\Database\Pipelines\Pipelines;
use DataMachine\Core\PluginSettings;
use DataMachine\Engine\AI\WpAiClientProviderAdmin;
use DataMachineCode\Handlers\GitHub\GitHubPullRequestPublish;

if (function_exists('wp_set_current_user')) {
    wp_set_current_user(1);
}

if (!function_exists('did_action') || !function_exists('do_action')) {
    return [
        'metrics' => ['has_actions_api' => 0],
        'metadata' => ['error' => 'WordPress action API not available'],
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
        'metadata' => ['error' => 'Abilities API not loaded'],
    ];
}

$github_token = trim((string) (getenv('GITHUB_TOKEN') ?: getenv('GH_TOKEN') ?: ''));
$openai_api_key = trim((string) getenv('OPENAI_API_KEY'));
$openai_model = trim((string) (getenv('STATIC_SITE_AGENT_OPENAI_MODEL') ?: 'gpt-5.5'));
$target_repo = trim((string) (getenv('STATIC_SITE_AGENT_TARGET_REPO') ?: 'chubes4/wc-site-generator'));
$issue_number = (int) (getenv('STATIC_SITE_AGENT_ISSUE_NUMBER') ?: 0);
$transcript_dir = trim((string) getenv('STATIC_SITE_AGENT_TRANSCRIPT_DIR'));

$metadata = [
    'target_repo' => $target_repo,
    'issue_number' => $issue_number,
    'openai_model' => $openai_model,
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
        'metadata' => $metadata + ['error' => 'GITHUB_TOKEN and OPENAI_API_KEY are required'],
    ];
}

if ($issue_number <= 0) {
    return [
        'metrics' => ['issue_number_valid' => 0],
        'metadata' => $metadata + ['error' => 'STATIC_SITE_AGENT_ISSUE_NUMBER must be a positive integer'],
    ];
}

if ($target_repo === '' || !str_contains($target_repo, '/')) {
    return [
        'metrics' => ['target_repo_valid' => 0],
        'metadata' => $metadata + ['error' => 'STATIC_SITE_AGENT_TARGET_REPO must be owner/repo'],
    ];
}

$settings = function_exists('get_option') ? (array) get_option('datamachine_settings', []) : [];
$settings['github_credential_profiles'] = [
    [
        'id' => 'wc-static-site-agent-ci',
        'label' => 'wc-static-site-agent CI token',
        'mode' => 'pat',
        'pat' => $github_token,
        'default_repo' => $target_repo,
        'allowed_repos' => [$target_repo],
    ],
];
$settings['github_default_profile_id'] = 'wc-static-site-agent-ci';
$settings['github_default_repo'] = $target_repo;
$settings['default_provider'] = 'openai';
$settings['default_model'] = $openai_model;
$settings['mode_models'] = [
    'pipeline' => ['provider' => 'openai', 'model' => $openai_model],
    'chat' => ['provider' => 'openai', 'model' => $openai_model],
    'system' => ['provider' => 'openai', 'model' => $openai_model],
];
$settings['max_turns'] = 12;
$settings['wp_ai_client_connect_timeout'] = 30;
update_option('datamachine_settings', $settings, false);
update_option('connectors_ai_openai_api_key', $openai_api_key, false);
update_option('datamachine_persist_pipeline_transcripts', true, false);
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

if (!class_exists(Agents::class) || !class_exists(Flows::class) || !class_exists(Jobs::class) || !class_exists(GitHubPullRequestPublish::class)) {
    return [
        'metrics' => ['required_classes_available' => 0],
        'metadata' => $metadata + ['error' => 'Required Data Machine / Data Machine Code classes are not available'],
    ];
}

$component_path = '/wordpress/wp-content/plugins/wc-site-generator-ci-driver';
$bundle_path = $component_path . '/bundles/wc-static-site-agent';
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

// Wrap github_pull_request_publish so a successful PR open is captured into
// engine data and the workflow can fail closed if no upstream PR URL appears.
if (!class_exists('WC_Site_Generator_Static_Site_Agent_Publish_Recorder')) {
    class WC_Site_Generator_Static_Site_Agent_Publish_Recorder {
        public function handle_tool_call(array $parameters, array $tool_def = []): array {
            $handler = new GitHubPullRequestPublish();
            $result = $handler->handle_tool_call($parameters, $tool_def);

            $job_id = (int) ($parameters['job_id'] ?? 0);
            if ($job_id <= 0 || !function_exists('datamachine_merge_engine_data')) {
                return $result;
            }

            $data = is_array($result['data'] ?? null) ? $result['data'] : [];
            $success = is_array($result) && !empty($result['success']);
            $pr_url = (string) ($data['html_url'] ?? '');
            $branch = (string) ($data['head'] ?? ($parameters['head'] ?? ''));
            $slug = self::derive_slug_from_branch($branch);

            datamachine_merge_engine_data($job_id, [
                'wc_static_site_agent' => [
                    'success' => $success,
                    'static_site_pr_url' => $pr_url,
                    'static_site_branch' => $branch,
                    'static_site_slug' => $slug,
                    'repo' => (string) ($data['repo'] ?? ($parameters['repo'] ?? '')),
                    'pull_number' => (int) ($data['pull_number'] ?? 0),
                    'title' => (string) ($data['title'] ?? ($parameters['title'] ?? '')),
                    'error' => $success ? null : (string) ($result['error'] ?? 'github_pull_request_publish failed'),
                ],
            ]);

            return $result;
        }

        private static function derive_slug_from_branch(string $branch): string {
            if ($branch === '') {
                return '';
            }
            // Convention: branch is `static/<slug>`.
            if (str_starts_with($branch, 'static/')) {
                return substr($branch, strlen('static/'));
            }
            return $branch;
        }
    }
}

add_filter('datamachine_resolved_tools', static function (array $tools): array {
    if (isset($tools['github_pull_request_publish'])) {
        $tools['github_pull_request_publish']['class'] = 'WC_Site_Generator_Static_Site_Agent_Publish_Recorder';
        $tools['github_pull_request_publish']['method'] = 'handle_tool_call';
    }
    return $tools;
}, 100, 1);

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

$agent = $agents->get_by_slug('wc-static-site-agent');
if (!$agent) {
    return [
        'metrics' => ['import_succeeded' => 1, 'agent_resolved' => 0],
        'metadata' => $metadata + ['error' => 'Imported agent wc-static-site-agent was not found'],
    ];
}

$agent_id = (int) $agent['agent_id'];
$agent_config = is_array($agent['agent_config'] ?? null) ? $agent['agent_config'] : [];
$agent_config['mode_models'] = $settings['mode_models'];
$agent_config['default_provider'] = 'openai';
$agent_config['default_model'] = $openai_model;
$agents->update_agent($agent_id, ['agent_config' => $agent_config]);
PluginSettings::clearCache();

$pipeline = $pipelines->get_by_portable_slug($agent_id, 'wc-static-site-pipeline');
if (!$pipeline) {
    return [
        'metrics' => ['agent_resolved' => 1, 'pipeline_resolved' => 0],
        'metadata' => $metadata + ['agent_id' => $agent_id, 'error' => 'Imported static-site pipeline was not found'],
    ];
}

$pipeline_id = (int) $pipeline['pipeline_id'];
$flow = $flows->get_by_portable_slug($pipeline_id, 'wc-static-site-manual-flow');
if (!$flow) {
    $all_flows = method_exists($flows, 'get_flows') ? $flows->get_flows() : [];
    foreach ((array) $all_flows as $candidate_flow) {
        if (($candidate_flow['flow_slug'] ?? '') === 'wc-static-site-manual-flow') {
            $flow = $candidate_flow;
            break;
        }
    }
}
if (!$flow) {
    return [
        'metrics' => ['agent_resolved' => 1, 'pipeline_resolved' => 1, 'flow_resolved' => 0],
        'metadata' => $metadata + ['agent_id' => $agent_id, 'pipeline_id' => $pipeline_id, 'error' => 'Imported manual flow was not found'],
    ];
}

$flow_id = (int) $flow['flow_id'];
$flow_config = is_array($flow['flow_config'] ?? null) ? $flow['flow_config'] : [];

// Override the manual flow so the GitHub fetch step targets exactly the
// supplied issue via DMC's new issue_number config (Extra-Chill/data-machine-code#279).
// Override the publish step's target repo to match the workflow input.
foreach ($flow_config as &$flow_step_config) {
    $step_type = (string) ($flow_step_config['step_type'] ?? '');

    if ($step_type === 'fetch') {
        $flow_step_config['handler_slug'] = 'github';
        $github_handler_config = [
            'data_source' => 'issues',
            'repo' => $target_repo,
            'state' => 'open',
            'issue_number' => $issue_number,
            'max_items' => 1,
        ];
        $flow_step_config['handler_config'] = $github_handler_config;
        $flow_step_config['handler_configs'] = [
            'github' => $github_handler_config,
        ];
    }

    if ($step_type === 'publish') {
        $flow_step_config['handler_slugs'] = ['github_pull_request'];
        $existing = is_array($flow_step_config['handler_configs']['github_pull_request'] ?? null)
            ? $flow_step_config['handler_configs']['github_pull_request']
            : [];
        $flow_step_config['handler_configs']['github_pull_request'] = $existing + [
            'base' => 'main',
            'draft' => false,
            'labels' => 'target:static-site',
            'maintainer_can_modify' => false,
            'repo' => $target_repo,
        ];
        $flow_step_config['handler_configs']['github_pull_request']['repo'] = $target_repo;
    }
}
unset($flow_step_config);

$flows->update_flow($flow_id, [
    'flow_config' => $flow_config,
    'agent_id' => $agent_id,
]);

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
            'flow_id' => $flow_id,
            'error' => 'datamachine/run-flow failed or returned no job_id',
        ],
    ];
}

$drain_start_ns = hrtime(true);
$drain_result = wp_get_ability('datamachine/drain-job')->execute([
    'job_id' => $job_id,
    'step_budget' => 20,
    'time_budget_ms' => 600000,
]);
$drain_elapsed_ms = (hrtime(true) - $drain_start_ns) / 1_000_000;
$metadata['drain_result'] = $drain_result;

$job = $jobs->get_job($job_id);
$job_status = is_array($job) ? (string) ($job['status'] ?? '') : '';
$engine_data = function_exists('datamachine_get_engine_data') ? datamachine_get_engine_data($job_id) : [];
$static_site_result = is_array($engine_data['wc_static_site_agent'] ?? null) ? $engine_data['wc_static_site_agent'] : [];
$token_usage = is_array($engine_data['token_usage'] ?? null) ? $engine_data['token_usage'] : [];
$transcript_artifacts = export_static_site_agent_transcript($job_id, $engine_data, $transcript_dir);

$static_site_pr_url = (string) ($static_site_result['static_site_pr_url'] ?? '');
$static_site_branch = (string) ($static_site_result['static_site_branch'] ?? '');
$static_site_slug = (string) ($static_site_result['static_site_slug'] ?? '');
$publish_succeeded = !empty($static_site_result['success']) && $static_site_pr_url !== '';
$drain_succeeded = is_array($drain_result) && !empty($drain_result['success']);
$job_completed = $job_status === 'completed';

$error_snapshot = array_filter([
    'error_reason' => $engine_data['error_reason'] ?? null,
    'error_step_id' => $engine_data['error_step_id'] ?? null,
    'error_message' => $engine_data['error_message'] ?? null,
]);

$metadata += [
    'agent_id' => $agent_id,
    'flow_id' => $flow_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
    'static_site_result' => $static_site_result,
    'static_site_pr_url' => $static_site_pr_url,
    'static_site_branch' => $static_site_branch,
    'static_site_slug' => $static_site_slug,
    'token_usage' => $token_usage,
    'transcript_session_id' => (string) ($engine_data['transcript_session_id'] ?? ''),
    'transcript_artifacts' => $transcript_artifacts,
    'error_snapshot' => $error_snapshot,
    'error_message' => (string) ($error_snapshot['error_message'] ?? ''),
];

return [
    'metrics' => [
        'github_token_present' => 1,
        'openai_key_present' => 1,
        'openai_provider_registered' => $openai_provider_registered ? 1 : 0,
        'issue_number_valid' => 1,
        'target_repo_valid' => 1,
        'required_abilities_resolved' => 1,
        'required_classes_available' => 1,
        'bundle_exists' => 1,
        'import_succeeded' => 1,
        'import_elapsed_ms' => $import_elapsed_ms,
        'agent_resolved' => 1,
        'flow_resolved' => 1,
        'run_flow_succeeded' => 1,
        'run_elapsed_ms' => $run_elapsed_ms,
        'drain_succeeded' => $drain_succeeded ? 1 : 0,
        'drain_elapsed_ms' => $drain_elapsed_ms,
        'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
        'job_completed' => $job_completed ? 1 : 0,
        'publish_succeeded' => $publish_succeeded ? 1 : 0,
        'static_site_pr_url_recorded' => $static_site_pr_url !== '' ? 1 : 0,
        'transcript_exported' => !empty($transcript_artifacts['json']) ? 1 : 0,
        'openai_total_tokens' => (int) ($token_usage['total_tokens'] ?? 0),
    ],
    'metadata' => $metadata,
];

function export_static_site_agent_transcript(int $job_id, array $engine_data, string $transcript_dir): array {
    $session_id = (string) ($engine_data['transcript_session_id'] ?? '');
    if ($session_id === '' || $transcript_dir === '') {
        return [];
    }

    if (!class_exists(ConversationStoreFactory::class)) {
        return ['error' => 'ConversationStoreFactory unavailable'];
    }

    $store = ConversationStoreFactory::get();
    $session = $store->get_session($session_id);
    if (!$session) {
        return ['session_id' => $session_id, 'error' => 'Transcript session missing'];
    }

    if (!is_dir($transcript_dir) && !wp_mkdir_p($transcript_dir)) {
        return ['session_id' => $session_id, 'error' => 'Transcript directory could not be created'];
    }

    $messages = is_array($session['messages'] ?? null) ? $session['messages'] : [];
    $metadata = is_array($session['metadata'] ?? null) ? $session['metadata'] : [];
    $base_path = rtrim($transcript_dir, '/') . '/job-' . $job_id . '-transcript';
    $json_path = $base_path . '.json';
    $summary_path = $base_path . '-summary.json';

    file_put_contents($json_path, wp_json_encode([
        'job_id' => $job_id,
        'session_id' => $session_id,
        'provider' => $session['provider'] ?? null,
        'model' => $session['model'] ?? null,
        'metadata' => $metadata,
        'messages' => $messages,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    file_put_contents($summary_path, wp_json_encode([
        'job_id' => $job_id,
        'session_id' => $session_id,
        'message_count' => count($messages),
        'roles' => array_count_values(array_map(static fn($message) => (string) ($message['role'] ?? 'unknown'), $messages)),
        'metadata' => $metadata,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    return [
        'session_id' => $session_id,
        'json' => $json_path,
        'summary' => $summary_path,
        'message_count' => count($messages),
    ];
}
