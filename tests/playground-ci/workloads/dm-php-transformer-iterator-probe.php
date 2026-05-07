<?php
/**
 * Imports and runs the php-transformer-iterator-agent with grouped SSI finding
 * packets supplied by the manual workflow.
 */

use DataMachine\Core\Database\Agents\Agents;
use DataMachine\Core\Database\Flows\Flows;
use DataMachine\Core\Database\Jobs\Jobs;
use DataMachine\Core\PluginSettings;
use DataMachine\Engine\AI\WpAiClientProviderAdmin;

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
$openai_model = trim((string) (getenv('ITERATOR_OPENAI_MODEL') ?: 'gpt-5.5'));
$source_repo = trim((string) (getenv('ITERATOR_SOURCE_REPO') ?: 'chubes4/wc-site-generator'));
$source_pr = trim((string) getenv('ITERATOR_SOURCE_PR'));
$source_head_sha = trim((string) getenv('ITERATOR_SOURCE_HEAD_SHA'));
$validation_run_id = trim((string) getenv('ITERATOR_VALIDATION_RUN_ID'));
$finding_groups_json = trim((string) getenv('ITERATOR_FINDING_GROUPS_JSON'));
$finding_groups = json_decode($finding_groups_json, true);

$metadata = [
    'source_repo' => $source_repo,
    'source_pr' => $source_pr,
    'source_head_sha' => $source_head_sha,
    'validation_run_id' => $validation_run_id,
    'openai_model' => $openai_model,
    'github_token_present' => $github_token !== '',
    'openai_key_present' => $openai_api_key !== '',
    'openai_provider_registered' => $openai_provider_registered,
    'finding_group_count' => is_array($finding_groups) ? (int) ($finding_groups['group_count'] ?? 0) : 0,
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

if (!is_array($finding_groups) || empty($finding_groups['groups'])) {
    return [
        'metrics' => ['finding_groups_valid' => 0],
        'metadata' => $metadata + ['error' => 'ITERATOR_FINDING_GROUPS_JSON must contain grouped findings'],
    ];
}

$allowed_repos = [
    'chubes4/static-site-importer',
    'chubes4/html-to-blocks-converter',
    'chubes4/block-format-bridge',
    'chubes4/wc-site-generator',
];

$settings = function_exists('get_option') ? (array) get_option('datamachine_settings', []) : [];
$settings['github_credential_profiles'] = [
    [
        'id' => 'php-transformer-iterator-ci',
        'label' => 'PHP Transformer Iterator CI token',
        'mode' => 'pat',
        'pat' => $github_token,
        'default_repo' => $source_repo,
        'allowed_repos' => array_values(array_unique(array_merge([$source_repo], $allowed_repos))),
    ],
];
$settings['github_default_profile_id'] = 'php-transformer-iterator-ci';
$settings['github_default_repo'] = $source_repo;
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
PluginSettings::clearCache();

foreach (['datamachine/import-agent', 'datamachine/run-flow', 'datamachine/drain-job'] as $ability_name) {
    if (!wp_get_ability($ability_name)) {
        return [
            'metrics' => ['required_abilities_resolved' => 0],
            'metadata' => $metadata + ['error' => $ability_name . ' not registered'],
        ];
    }
}

if (!class_exists(Agents::class) || !class_exists(Flows::class) || !class_exists(Jobs::class)) {
    return [
        'metrics' => ['required_classes_available' => 0],
        'metadata' => $metadata + ['error' => 'Required Data Machine classes are not available'],
    ];
}

$component_path = '/wordpress/wp-content/plugins/wc-site-generator-ci-driver';
$bundle_path = $component_path . '/bundles/php-transformer-iterator-agent';
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

if (!is_array($import_result) || empty($import_result['success'])) {
    return [
        'metrics' => ['import_succeeded' => 0, 'import_elapsed_ms' => $import_elapsed_ms],
        'metadata' => $metadata + ['error' => 'datamachine/import-agent did not succeed'],
    ];
}

$agents = new Agents();
$flows = new Flows();
$jobs = new Jobs();

$agent = $agents->get_by_slug('php-transformer-iterator-agent');
if (!$agent) {
    return [
        'metrics' => ['import_succeeded' => 1, 'agent_resolved' => 0],
        'metadata' => $metadata + ['error' => 'Imported agent was not found'],
    ];
}

$agent_id = (int) $agent['agent_id'];
$agent_config = is_array($agent['agent_config'] ?? null) ? $agent['agent_config'] : [];
$agent_config['mode_models'] = $settings['mode_models'];
$agent_config['default_provider'] = 'openai';
$agent_config['default_model'] = $openai_model;
$agents->update_agent($agent_id, ['agent_config' => $agent_config]);
PluginSettings::clearCache();

$flow = $flows->get_by_portable_slug(0, 'php-transformer-iterator-manual-flow');
if (!$flow) {
    $all_flows = method_exists($flows, 'get_flows') ? $flows->get_flows() : [];
    foreach ((array) $all_flows as $candidate_flow) {
        if (($candidate_flow['flow_slug'] ?? '') === 'php-transformer-iterator-manual-flow') {
            $flow = $candidate_flow;
            break;
        }
    }
}
if (!$flow) {
    return [
        'metrics' => ['agent_resolved' => 1, 'flow_resolved' => 0],
        'metadata' => $metadata + ['agent_id' => $agent_id, 'error' => 'Imported manual flow was not found'],
    ];
}

$flow_id = (int) $flow['flow_id'];
$flow_config = is_array($flow['flow_config'] ?? null) ? $flow['flow_config'] : [];
$prompt = "Run the PHP transformer iterator now.\n\n" . json_encode([
    'source_repo' => $source_repo,
    'source_pr' => $source_pr,
    'source_head_sha' => $source_head_sha,
    'validation_run_id' => $validation_run_id,
    'finding_groups' => $finding_groups,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

foreach ($flow_config as &$flow_step_config) {
    if (($flow_step_config['step_type'] ?? '') === 'ai') {
        $flow_step_config['queue_mode'] = 'static';
        $flow_step_config['prompt_queue'] = [
            [
                'added_at' => gmdate('c'),
                'prompt' => $prompt,
            ],
        ];
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
        'metadata' => $metadata + ['agent_id' => $agent_id, 'flow_id' => $flow_id, 'error' => 'datamachine/run-flow failed or returned no job_id'],
    ];
}

$drain_start_ns = hrtime(true);
$drain_result = wp_get_ability('datamachine/drain-job')->execute([
    'job_id' => $job_id,
    'step_budget' => 20,
    'time_budget_ms' => 300000,
]);
$drain_elapsed_ms = (hrtime(true) - $drain_start_ns) / 1_000_000;
$metadata['drain_result'] = $drain_result;

$job = $jobs->get_job($job_id);
$job_status = is_array($job) ? (string) ($job['status'] ?? '') : '';
$engine_data = function_exists('datamachine_get_engine_data') ? datamachine_get_engine_data($job_id) : [];
$token_usage = is_array($engine_data['token_usage'] ?? null) ? $engine_data['token_usage'] : [];

$metadata += [
    'agent_id' => $agent_id,
    'flow_id' => $flow_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
    'token_usage' => $token_usage,
    'error_message' => (string) ($engine_data['error_message'] ?? ''),
];

return [
    'metrics' => [
        'github_token_present' => 1,
        'openai_key_present' => 1,
        'openai_provider_registered' => $openai_provider_registered ? 1 : 0,
        'finding_groups_valid' => 1,
        'finding_group_count' => (int) ($finding_groups['group_count'] ?? 0),
        'required_abilities_resolved' => 1,
        'required_classes_available' => 1,
        'bundle_exists' => 1,
        'import_succeeded' => 1,
        'import_elapsed_ms' => $import_elapsed_ms,
        'agent_resolved' => 1,
        'flow_resolved' => 1,
        'run_flow_succeeded' => 1,
        'run_elapsed_ms' => $run_elapsed_ms,
        'drain_succeeded' => is_array($drain_result) && !empty($drain_result['success']) ? 1 : 0,
        'drain_elapsed_ms' => $drain_elapsed_ms,
        'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
        'job_completed' => $job_status === 'completed' ? 1 : 0,
        'openai_total_tokens' => (int) ($token_usage['total_tokens'] ?? 0),
    ],
    'metadata' => $metadata,
];
