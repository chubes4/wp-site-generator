<?php
/**
 * Runs the static-site-agent bundle against a single supplied issue through
 * the Data Machine bundle runner contract, then captures the resulting static
 * site PR URL, branch, and slug from tool recorder engine data.
 */

use DataMachine\Core\Database\Chat\ConversationStoreFactory;
use DataMachine\Core\PluginSettings;
use DataMachine\Engine\AI\WpAiClientProviderAdmin;

if (!function_exists('wp_site_generator_static_site_agent_result')) {
    function wp_site_generator_static_site_agent_result(array $metrics, array $metadata, ?string $error = null): array {
        if ($error !== null) {
            $metadata['error'] = $error;
        }

        return [
            'metrics' => $metrics,
            'metadata' => $metadata,
        ];
    }
}

if (!function_exists('wp_site_generator_static_site_agent_inputs')) {
    function wp_site_generator_static_site_agent_inputs(): array {
        return [
            'github_token' => trim((string) (getenv('GITHUB_TOKEN') ?: getenv('GH_TOKEN') ?: '')),
            'openai_api_key' => trim((string) getenv('OPENAI_API_KEY')),
            'openai_model' => trim((string) (getenv('STATIC_SITE_AGENT_OPENAI_MODEL') ?: 'gpt-5.5')),
            'target_repo' => trim((string) (getenv('STATIC_SITE_AGENT_TARGET_REPO') ?: 'chubes4/wp-site-generator')),
            'issue_number' => (int) (getenv('STATIC_SITE_AGENT_ISSUE_NUMBER') ?: 0),
            'transcript_dir' => trim((string) getenv('STATIC_SITE_AGENT_TRANSCRIPT_DIR')),
        ];
    }
}

if (!function_exists('wp_site_generator_static_site_agent_validate_inputs')) {
    function wp_site_generator_static_site_agent_validate_inputs(array $inputs, array $metadata): ?array {
        if ($inputs['github_token'] === '' || $inputs['openai_api_key'] === '') {
            return wp_site_generator_static_site_agent_result([
                'github_token_present' => $inputs['github_token'] !== '' ? 1 : 0,
                'openai_key_present' => $inputs['openai_api_key'] !== '' ? 1 : 0,
            ], $metadata, 'GITHUB_TOKEN and OPENAI_API_KEY are required');
        }

        if ($inputs['issue_number'] <= 0) {
            return wp_site_generator_static_site_agent_result([
                'issue_number_valid' => 0,
            ], $metadata, 'STATIC_SITE_AGENT_ISSUE_NUMBER must be a positive integer');
        }

        if ($inputs['target_repo'] === '' || !str_contains($inputs['target_repo'], '/')) {
            return wp_site_generator_static_site_agent_result([
                'target_repo_valid' => 0,
            ], $metadata, 'STATIC_SITE_AGENT_TARGET_REPO must be owner/repo');
        }

        return null;
    }
}

if (!function_exists('wp_site_generator_static_site_agent_configure_settings')) {
    function wp_site_generator_static_site_agent_configure_settings(array $inputs): array {
        $settings = function_exists('get_option') ? (array) get_option('datamachine_settings', []) : [];
        $settings['github_credential_profiles'] = [
            [
                'id' => 'static-site-agent-ci',
                'label' => 'static-site-agent CI token',
                'mode' => 'pat',
                'pat' => $inputs['github_token'],
                'default_repo' => $inputs['target_repo'],
                'allowed_repos' => [$inputs['target_repo']],
            ],
        ];
        $settings['github_default_profile_id'] = 'static-site-agent-ci';
        $settings['github_default_repo'] = $inputs['target_repo'];
        $settings['default_provider'] = 'openai';
        $settings['default_model'] = $inputs['openai_model'];
        $settings['mode_models'] = [
            'pipeline' => ['provider' => 'openai', 'model' => $inputs['openai_model']],
            'chat' => ['provider' => 'openai', 'model' => $inputs['openai_model']],
            'system' => ['provider' => 'openai', 'model' => $inputs['openai_model']],
        ];
        $settings['max_turns'] = 12;
        $settings['wp_ai_client_connect_timeout'] = 30;

        update_option('datamachine_settings', $settings, false);
        update_option('connectors_ai_openai_api_key', $inputs['openai_api_key'], false);
        update_option('datamachine_persist_pipeline_transcripts', true, false);
        PluginSettings::clearCache();

        return $settings;
    }
}

if (!function_exists('wp_site_generator_static_site_agent_bootstrap_abilities')) {
    function wp_site_generator_static_site_agent_bootstrap_abilities(): ?array {
        if (!function_exists('did_action') || !function_exists('do_action')) {
            return wp_site_generator_static_site_agent_result([
                'has_actions_api' => 0,
            ], ['error' => 'WordPress action API not available']);
        }

        if (function_exists('WordPress\\OpenAiAiProvider\\register_provider')) {
            WordPress\OpenAiAiProvider\register_provider();
        }

        if (!did_action('wp_abilities_api_categories_init')) {
            do_action('wp_abilities_api_categories_init');
        }
        if (!did_action('wp_abilities_api_init')) {
            do_action('wp_abilities_api_init');
        }

        if (!function_exists('wp_get_ability')) {
            return wp_site_generator_static_site_agent_result([
                'has_abilities_api' => 0,
            ], ['error' => 'Abilities API not loaded']);
        }

        return null;
    }
}

if (!function_exists('wp_site_generator_static_site_agent_validate_dependencies')) {
    function wp_site_generator_static_site_agent_validate_dependencies(array $metadata): ?array {
        foreach (['datamachine/run-agent-bundle'] as $ability_name) {
            if (!wp_get_ability($ability_name)) {
                return wp_site_generator_static_site_agent_result([
                    'required_abilities_resolved' => 0,
                ], $metadata, $ability_name . ' not registered');
            }
        }

        return null;
    }
}

if (!function_exists('wp_site_generator_static_site_agent_bundle_metadata')) {
    function wp_site_generator_static_site_agent_bundle_metadata(): array {
        $component_path = '/wordpress/wp-content/plugins/wp-site-generator-ci-driver';
        $bundle_path = $component_path . '/bundles/static-site-agent';

        return [
            'bundle_path' => $bundle_path,
            'bundle_exists' => is_dir($bundle_path),
            'bundle_manifest_exists' => is_file($bundle_path . '/manifest.json'),
        ];
    }
}

if (!function_exists('wp_site_generator_static_site_agent_run_bundle')) {
    function wp_site_generator_static_site_agent_run_bundle(string $bundle_path, array $inputs, array &$metadata): array {
        $start_ns = hrtime(true);
        $result = wp_get_ability('datamachine/run-agent-bundle')->execute([
            'source' => $bundle_path,
            'flow_slug' => 'static-site-manual-flow',
            'provider' => 'openai',
            'model' => $inputs['openai_model'],
            'wait_for_completion' => true,
            'step_budget' => 20,
            'time_budget_ms' => 600000,
            'job_source' => 'wp_site_generator_static_site_agent_probe',
            'job_label' => 'Static site agent CI probe',
            'required_outputs' => ['static_site_pr_url'],
            'engine_data_outputs' => [
                'static_site_pr_url' => 'metadata.engine_data.wc_static_site_agent.static_site_pr_url',
                'static_site_branch' => 'metadata.engine_data.wc_static_site_agent.static_site_branch',
                'static_site_slug' => 'metadata.engine_data.wc_static_site_agent.static_site_slug',
            ],
            'flow_step_patches' => [
                [
                    'step_type' => 'fetch',
                    'merge' => [
                        'handler_slug' => 'github',
                        'handler_configs' => [
                            'github' => [
                                'data_source' => 'issues',
                                'repo' => $inputs['target_repo'],
                                'state' => 'open',
                                'issue_number' => $inputs['issue_number'],
                                'max_items' => 1,
                            ],
                        ],
                    ],
                ],
                [
                    'step_type' => 'publish',
                    'merge' => [
                        'handler_slugs' => ['github_pull_request'],
                        'handler_configs' => [
                            'github_pull_request' => [
                                'base' => 'main',
                                'draft' => false,
                                'labels' => 'target:static-site',
                                'maintainer_can_modify' => false,
                                'repo' => $inputs['target_repo'],
                            ],
                        ],
                    ],
                ],
            ],
            'tool_recorders' => [
                [
                    'tool' => 'github_pull_request_publish',
                    'record' => [
                        'engine_key' => 'wc_static_site_agent',
                        'fields' => [
                            'success' => 'result.success',
                            'static_site_pr_url' => 'data.html_url',
                            'static_site_branch' => 'data.head',
                            'static_site_slug' => [
                                'paths' => ['data.head'],
                                'strip_prefix' => 'static/',
                            ],
                            'repo' => 'data.repo',
                            'pull_number' => 'data.pull_number',
                            'title' => 'data.title',
                        ],
                    ],
                ],
            ],
        ]);
        $elapsed_ms = (hrtime(true) - $start_ns) / 1_000_000;
        $metadata['run_agent_bundle_result'] = $result;

        return [
            'result' => $result,
            'elapsed_ms' => $elapsed_ms,
            'job_id' => is_array($result) ? (int) ($result['job_id'] ?? 0) : 0,
        ];
    }
}

if (!function_exists('export_static_site_agent_transcript')) {
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
}

if (function_exists('wp_set_current_user')) {
    wp_set_current_user(1);
}

$bootstrap_error = wp_site_generator_static_site_agent_bootstrap_abilities();
if ($bootstrap_error !== null) {
    return $bootstrap_error;
}

$inputs = wp_site_generator_static_site_agent_inputs();
$openai_provider_registered = class_exists(WpAiClientProviderAdmin::class)
    && WpAiClientProviderAdmin::isProviderRegistered('openai');
$metadata = [
    'target_repo' => $inputs['target_repo'],
    'issue_number' => $inputs['issue_number'],
    'openai_model' => $inputs['openai_model'],
    'github_token_present' => $inputs['github_token'] !== '',
    'openai_key_present' => $inputs['openai_api_key'] !== '',
    'openai_provider_registered' => $openai_provider_registered,
];

$input_error = wp_site_generator_static_site_agent_validate_inputs($inputs, $metadata);
if ($input_error !== null) {
    return $input_error;
}

wp_site_generator_static_site_agent_configure_settings($inputs);

$dependency_error = wp_site_generator_static_site_agent_validate_dependencies($metadata);
if ($dependency_error !== null) {
    return $dependency_error;
}

$bundle_metadata = wp_site_generator_static_site_agent_bundle_metadata();
$metadata += $bundle_metadata;
if (!$metadata['bundle_exists'] || !$metadata['bundle_manifest_exists']) {
    return wp_site_generator_static_site_agent_result([
        'bundle_exists' => $metadata['bundle_exists'] ? 1 : 0,
    ], $metadata, 'Bundle directory missing or incomplete');
}

$run = wp_site_generator_static_site_agent_run_bundle($metadata['bundle_path'], $inputs, $metadata);
$run_result = $run['result'];
$run_elapsed_ms = $run['elapsed_ms'];
$job_id = $run['job_id'];
if (!is_array($run_result) || empty($run_result['success']) || $job_id <= 0) {
    return wp_site_generator_static_site_agent_result([
        'run_flow_succeeded' => 0,
        'run_elapsed_ms' => $run_elapsed_ms,
    ], $metadata, 'datamachine/run-agent-bundle failed or returned no job_id');
}

$drain_result = is_array($run_result['wait_result'] ?? null) ? $run_result['wait_result'] : [];
$engine_data = is_array($run_result['engine_data'] ?? null) ? $run_result['engine_data'] : (function_exists('datamachine_get_engine_data') ? datamachine_get_engine_data($job_id) : []);
$job_status = (string) ($run_result['job_status'] ?? $run_result['status'] ?? '');
$static_site_result = is_array($engine_data['wc_static_site_agent'] ?? null) ? $engine_data['wc_static_site_agent'] : [];
$token_usage = is_array($engine_data['token_usage'] ?? null) ? $engine_data['token_usage'] : [];
$transcript_artifacts = export_static_site_agent_transcript($job_id, $engine_data, $inputs['transcript_dir']);

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

return wp_site_generator_static_site_agent_result([
    'github_token_present' => 1,
    'openai_key_present' => 1,
    'openai_provider_registered' => $openai_provider_registered ? 1 : 0,
    'issue_number_valid' => 1,
    'target_repo_valid' => 1,
    'required_abilities_resolved' => 1,
    'required_classes_available' => 1,
    'bundle_exists' => 1,
    'run_agent_bundle_succeeded' => 1,
    'agent_resolved' => 1,
    'flow_resolved' => 1,
    'run_flow_succeeded' => 1,
    'run_elapsed_ms' => $run_elapsed_ms,
    'drain_succeeded' => $drain_succeeded ? 1 : 0,
    'drain_elapsed_ms' => (float) ($drain_result['elapsed_ms'] ?? 0),
    'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
    'job_completed' => $job_completed ? 1 : 0,
    'publish_succeeded' => $publish_succeeded ? 1 : 0,
    'static_site_pr_url_recorded' => $static_site_pr_url !== '' ? 1 : 0,
    'transcript_exported' => !empty($transcript_artifacts['json']) ? 1 : 0,
    'openai_total_tokens' => (int) ($token_usage['total_tokens'] ?? 0),
], $metadata);
