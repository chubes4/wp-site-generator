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
use DataMachineCode\Abilities\GitHubAbilities;

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
// Resolve the grouped finding payload. Two transports are accepted:
//
// 1. ITERATOR_FINDING_GROUPS_JSON — raw JSON via Homeboy's bench_env.
//    This is the Playground transport. Extra-Chill/homeboy-extensions#448
//    escapes sed metacharacters in the bench_env substitution so JSON
//    escapes (`\"`) and `&` survive the template round-trip intact.
// 2. ITERATOR_FINDING_GROUPS_PATH — host filesystem path. Local-dev
//    fallback for callers that run the workload directly without the
//    Playground sandbox; the host path is not visible inside Playground.
$finding_groups_json = trim((string) getenv('ITERATOR_FINDING_GROUPS_JSON'));
$finding_groups_path = trim((string) getenv('ITERATOR_FINDING_GROUPS_PATH'));
$finding_groups = null;
$finding_groups_source = '';
if ($finding_groups_json !== '') {
    $finding_groups = json_decode($finding_groups_json, true);
    $finding_groups_source = is_array($finding_groups) ? 'json' : '';
}
if (!is_array($finding_groups) && $finding_groups_path !== '' && is_file($finding_groups_path)) {
    $raw = (string) file_get_contents($finding_groups_path);
    $finding_groups = json_decode($raw, true);
    $finding_groups_source = is_array($finding_groups) ? 'path' : $finding_groups_source;
}

$metadata = [
    'source_repo' => $source_repo,
    'source_pr' => $source_pr,
    'source_head_sha' => $source_head_sha,
    'validation_run_id' => $validation_run_id,
    'openai_model' => $openai_model,
    'github_token_present' => $github_token !== '',
    'openai_key_present' => $openai_api_key !== '',
    'openai_provider_registered' => $openai_provider_registered,
    'finding_groups_source' => $finding_groups_source,
    'finding_groups_json_len' => strlen($finding_groups_json),
    'finding_groups_path' => $finding_groups_path,
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
        'metadata' => $metadata + [
            'error' => 'ITERATOR_FINDING_GROUPS_JSON or ITERATOR_FINDING_GROUPS_PATH must provide grouped findings JSON',
        ],
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

$required_abilities = [
    'datamachine/import-agent',
    'datamachine/run-flow',
    'datamachine/drain-job',
    'datamachine/workspace-worktree-add',
    'datamachine/workspace-read',
    'datamachine/workspace-write',
    'datamachine/workspace-edit',
    'datamachine/workspace-git-status',
    'datamachine/workspace-git-commit',
    'datamachine/workspace-git-push',
    'datamachine/create-github-pull-request',
    'datamachine/create-github-issue',
    'datamachine/comment-github-pull-request',
];

foreach ($required_abilities as $ability_name) {
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

if (!class_exists(GitHubAbilities::class)) {
    return [
        'metrics' => ['required_classes_available' => 0],
        'metadata' => $metadata + ['error' => 'Data Machine Code GitHub abilities are not available'],
    ];
}

if (!class_exists('WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder')) {
    class WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder {
        private static array $tool_results = [];

        public static function handle_ability_tool_call(array $parameters, array $tool_def = []): array {
            $ability_name = (string) ($tool_def['ability'] ?? '');
            $tool_name = (string) ($tool_def['tool_name'] ?? $ability_name);
            if ($ability_name === '' || !function_exists('wp_get_ability')) {
                return self::error($tool_name, 'Missing ability contract.');
            }

            $ability = wp_get_ability($ability_name);
            if (!$ability) {
                return self::error($tool_name, $ability_name . ' is not registered.');
            }

            $result = $ability->execute($parameters);
            if (function_exists('is_wp_error') && is_wp_error($result)) {
                $response = self::error($tool_name, $result->get_error_message());
                self::record($parameters, $tool_name, $response);
                return $response;
            }

            $response = is_array($result) ? $result : ['success' => true, 'data' => $result];
            $response['tool_name'] = $tool_name;
            self::record($parameters, $tool_name, $response);
            return $response;
        }

        public static function handle_pull_request_tool_call(array $parameters, array $tool_def = []): array {
            $response = self::handle_ability_tool_call($parameters, $tool_def + [
                'ability' => 'datamachine/create-github-pull-request',
                'tool_name' => 'create_github_pull_request',
            ]);
            if (!empty($response['success'])) {
                self::record_iterator_event($parameters, 'upstream_action', 'pull_request', self::first_url($response), $response);
            }
            return $response;
        }

        public static function handle_issue_tool_call(array $parameters, array $tool_def = []): array {
            $response = self::handle_ability_tool_call($parameters, $tool_def + [
                'ability' => 'datamachine/create-github-issue',
                'tool_name' => 'create_github_issue',
            ]);
            if (!empty($response['success'])) {
                self::record_iterator_event($parameters, 'upstream_action', 'issue', self::first_url($response), $response);
            }
            return $response;
        }

        public static function handle_comment_tool_call(array $parameters, array $tool_def = []): array {
            $response = self::handle_ability_tool_call($parameters, $tool_def + [
                'ability' => 'datamachine/comment-github-pull-request',
                'tool_name' => 'comment_github_pull_request',
            ]);
            if (!empty($response['success']) && self::is_source_pull_request($parameters)) {
                self::record_iterator_event($parameters, 'source_callback', 'pull_request_comment', self::first_url($response), $response);
            }
            return $response;
        }

        private static function error(string $tool_name, string $message): array {
            return [
                'success' => false,
                'error' => $message,
                'tool_name' => $tool_name,
            ];
        }

        private static function record(array $parameters, string $tool_name, array $response): void {
            self::$tool_results[] = [
                'tool_name' => $tool_name,
                'success' => !empty($response['success']),
                'repo' => (string) ($parameters['repo'] ?? ''),
                'url' => self::first_url($response),
            ];

            $job_id = (int) ($parameters['job_id'] ?? 0);
            if ($job_id > 0 && function_exists('datamachine_merge_engine_data')) {
                datamachine_merge_engine_data($job_id, [
                    'php_transformer_iterator' => [
                        'tool_results' => self::$tool_results,
                    ],
                ]);
            }
        }

        private static function record_iterator_event(array $parameters, string $key, string $type, string $url, array $response): void {
            $job_id = (int) ($parameters['job_id'] ?? 0);
            if ($job_id <= 0 || $url === '' || !function_exists('datamachine_merge_engine_data')) {
                return;
            }

            datamachine_merge_engine_data($job_id, [
                'php_transformer_iterator' => [
                    $key => [
                        'type' => $type,
                        'url' => $url,
                        'repo' => (string) ($parameters['repo'] ?? ''),
                        'number' => (int) ($response['pull_number'] ?? $response['issue_number'] ?? $parameters['pull_number'] ?? 0),
                    ],
                ],
            ]);
        }

        private static function is_source_pull_request(array $parameters): bool {
            $source_repo = trim((string) getenv('ITERATOR_SOURCE_REPO'));
            $source_pr = (int) getenv('ITERATOR_SOURCE_PR');
            $repo = trim((string) ($parameters['repo'] ?? ''));
            $pull_number = (int) ($parameters['pull_number'] ?? 0);

            return $source_repo !== ''
                && $source_pr > 0
                && $repo === $source_repo
                && $pull_number === $source_pr;
        }

        private static function first_url(mixed $value): string {
            if (is_string($value)) {
                return preg_match('#https://github\.com/[^\s)]+#', $value, $matches) ? $matches[0] : '';
            }
            if (!is_array($value)) {
                return '';
            }
            foreach (['html_url', 'issue_url', 'url'] as $key) {
                if (!empty($value[$key]) && is_string($value[$key]) && str_starts_with($value[$key], 'https://github.com/')) {
                    return $value[$key];
                }
            }
            foreach ($value as $child) {
                $url = self::first_url($child);
                if ($url !== '') {
                    return $url;
                }
            }
            return '';
        }
    }
}

add_filter('datamachine_resolved_tools', static function (array $tools): array {
    $workspace_tools = [
        'workspace_worktree_add' => 'datamachine/workspace-worktree-add',
        'workspace_read' => 'datamachine/workspace-read',
        'workspace_write' => 'datamachine/workspace-write',
        'workspace_edit' => 'datamachine/workspace-edit',
        'workspace_git_status' => 'datamachine/workspace-git-status',
        'workspace_git_commit' => 'datamachine/workspace-git-commit',
        'workspace_git_push' => 'datamachine/workspace-git-push',
    ];

    foreach ($workspace_tools as $tool_name => $ability_name) {
        $ability = function_exists('wp_get_ability') ? wp_get_ability($ability_name) : null;
        $schema = $ability && method_exists($ability, 'get_input_schema') ? (array) $ability->get_input_schema() : ['type' => 'object'];
        $tools[$tool_name] = [
            'class' => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
            'method' => 'handle_ability_tool_call',
            'ability' => $ability_name,
            'tool_name' => $tool_name,
            'description' => 'Execute ' . $ability_name . ' for the PR-first PHP transformer iterator.',
            'parameters' => $schema,
        ];
    }

    $github_tools = [
        'create_github_pull_request' => [
            'ability' => 'datamachine/create-github-pull-request',
            'method' => 'handle_pull_request_tool_call',
            'description' => 'Open the focused upstream transformer repair pull request after pushing the worktree branch.',
        ],
        'create_github_issue' => [
            'ability' => 'datamachine/create-github-issue',
            'method' => 'handle_issue_tool_call',
            'description' => 'Fallback only: open a focused issue when no safe upstream patch path exists.',
        ],
        'comment_github_pull_request' => [
            'ability' => 'datamachine/comment-github-pull-request',
            'method' => 'handle_comment_tool_call',
            'description' => 'Post the required callback comment on the source generated-site pull request.',
        ],
    ];

    foreach ($github_tools as $tool_name => $tool_def) {
        $ability = function_exists('wp_get_ability') ? wp_get_ability($tool_def['ability']) : null;
        $schema = $ability && method_exists($ability, 'get_input_schema') ? (array) $ability->get_input_schema() : ['type' => 'object', 'properties' => []];
        $tools[$tool_name] = [
            'class' => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
            'method' => $tool_def['method'],
            'ability' => $tool_def['ability'],
            'tool_name' => $tool_name,
            'description' => $tool_def['description'],
            'parameters' => $schema,
        ];
    }

    return $tools;
}, 100, 1);

$component_path = '/wordpress/wp-content/plugins/wc-site-generator-ci-driver';
$bundle_path = $component_path . '/bundles/php-transformer-iterator-agent';
$import_agent_slug_suffix = sanitize_title($validation_run_id !== '' ? $validation_run_id : uniqid('local-', false));
$import_agent_slug = 'php-transformer-iterator-agent-' . $import_agent_slug_suffix;
$metadata += [
    'bundle_path' => $bundle_path,
    'bundle_exists' => is_dir($bundle_path),
    'bundle_manifest_exists' => is_file($bundle_path . '/manifest.json'),
    'import_agent_slug' => $import_agent_slug,
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
    'slug' => $import_agent_slug,
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

$agent = $agents->get_by_slug($import_agent_slug);
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

$flow = null;
$all_flows = method_exists($flows, 'get_all_flows') ? $flows->get_all_flows(null, $agent_id) : [];
foreach ((array) $all_flows as $candidate_flow) {
    if (($candidate_flow['portable_slug'] ?? '') === 'php-transformer-iterator-manual-flow') {
        $flow = $candidate_flow;
        break;
    }
}
if (!$flow) {
    foreach ((array) $all_flows as $candidate_flow) {
        if (($candidate_flow['flow_name'] ?? '') === 'PHP Transformer Iterator — Manual') {
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
$iterator_result = is_array($engine_data['php_transformer_iterator'] ?? null) ? $engine_data['php_transformer_iterator'] : [];
$upstream_action = is_array($iterator_result['upstream_action'] ?? null) ? $iterator_result['upstream_action'] : [];
$source_callback = is_array($iterator_result['source_callback'] ?? null) ? $iterator_result['source_callback'] : [];
$upstream_action_url = (string) ($upstream_action['url'] ?? '');
$source_callback_url = (string) ($source_callback['url'] ?? '');
$has_upstream_action = $upstream_action_url !== '';
$has_source_callback = $source_callback_url !== '';

$metadata += [
    'agent_id' => $agent_id,
    'flow_id' => $flow_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
    'token_usage' => $token_usage,
    'iterator_result' => $iterator_result,
    'upstream_action_url' => $upstream_action_url,
    'source_callback_url' => $source_callback_url,
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
        'upstream_action_recorded' => $has_upstream_action ? 1 : 0,
        'source_callback_recorded' => $has_source_callback ? 1 : 0,
        'openai_total_tokens' => (int) ($token_usage['total_tokens'] ?? 0),
    ],
    'metadata' => $metadata,
];
