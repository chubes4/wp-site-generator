<?php
/**
 * Stage 4 GitHub issue publish probe.
 *
 * Runs a one-step Data Machine flow that performs a real GitHub issue publish
 * through Data Machine Code's GitHub Issue publish handler, then returns the
 * resulting issue URL as workload metadata.
 */

use DataMachine\Core\DataPacket;
use DataMachine\Core\Database\Flows\Flows;
use DataMachine\Core\Database\Jobs\Jobs;
use DataMachine\Core\Database\Pipelines\Pipelines;
use DataMachine\Core\PluginSettings;
use DataMachine\Core\Steps\Step;
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
$target_repo = trim((string) (getenv('STAGE4_GITHUB_REPO') ?: 'chubes4/wp-site-generator'));

$metadata = [
    'target_repo' => $target_repo,
    'github_token_present' => $github_token !== '',
];

if ($github_token === '') {
    return [
        'metrics' => ['github_token_present' => 0],
        'metadata' => $metadata + ['error' => 'GITHUB_TOKEN or GH_TOKEN is required for the real GitHub issue publish proof'],
    ];
}

if ($target_repo === '' || !str_contains($target_repo, '/')) {
    return [
        'metrics' => ['github_token_present' => 1, 'target_repo_valid' => 0],
        'metadata' => $metadata + ['error' => 'STAGE4_GITHUB_REPO must be owner/repo'],
    ];
}

// Seed the ephemeral Playground site's GitHub settings from process env. The
// token is intentionally never returned in workload metadata.
$settings = function_exists('get_option') ? (array) get_option('datamachine_settings', []) : [];
$settings['github_credential_profiles'] = [
    [
        'id' => 'stage4-ci',
        'label' => 'Stage 4 CI token',
        'mode' => 'pat',
        'pat' => $github_token,
        'default_repo' => $target_repo,
        'allowed_repos' => [$target_repo],
    ],
];
$settings['github_default_profile_id'] = 'stage4-ci';
$settings['github_default_repo'] = $target_repo;
update_option('datamachine_settings', $settings, false);

// Reset PluginSettings' private cache after writing the ephemeral settings.
$plugin_settings_reflection = new ReflectionClass(PluginSettings::class);
$cache_property = $plugin_settings_reflection->getProperty('cache');
$cache_property->setAccessible(true);
$cache_property->setValue(null, null);

$required_abilities = [
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

if (!class_exists(Pipelines::class) || !class_exists(Flows::class) || !class_exists(Jobs::class) || !class_exists(GitHubIssuePublish::class)) {
    return [
        'metrics' => [
            'github_token_present' => 1,
            'required_classes_available' => 0,
        ],
        'metadata' => $metadata + ['error' => 'Required Data Machine/Data Machine Code classes are not available'],
    ];
}

if (!class_exists('WC_Site_Generator_Stage4_GitHub_Issue_Step')) {
    class WC_Site_Generator_Stage4_GitHub_Issue_Step extends Step {
        public function __construct() {
            parent::__construct('stage4_github_issue_publish');
        }

        protected function validateStepConfiguration(): bool {
            return true;
        }

        protected function executeStep(): array {
            $repo = (string) ($this->flow_step_config['target_repo'] ?? 'chubes4/wp-site-generator');
            $run_id = (string) ($this->flow_step_config['stage4_run_id'] ?? gmdate('YmdHis'));
            $title = '[Playground proof] Stage 4 GitHub issue publish ' . $run_id;
            $body = implode("\n\n", [
                'This issue was created by the Data Machine Playground Stage 4 proof.',
                '- Flow path: `datamachine/run-flow` -> Action Scheduler -> `datamachine/drain-job`',
                '- Publish path: Data Machine Code `github_issue` publish handler',
                '- Proof branch: https://github.com/chubes4/wp-site-generator/tree/feat/playground-ci-proof',
                '- Tracking issue: https://github.com/Extra-Chill/homeboy-extensions/issues/422',
                'This is expected CI proof output and can be closed after verification.',
            ]);

            $handler = new GitHubIssuePublish();
            $result = $handler->handle_tool_call(
                [
                    'job_id' => $this->job_id,
                    'repo' => $repo,
                    'title' => $title,
                    'body' => $body,
                ],
                [
                    'handler' => 'github_issue',
                    'handler_config' => [
                        'repo' => $repo,
                    ],
                ]
            );

            $success = is_array($result) && !empty($result['success']);
            $data = is_array($result['data'] ?? null) ? $result['data'] : [];
            datamachine_merge_engine_data($this->job_id, [
                'stage4_github_issue_publish' => [
                    'success' => $success,
                    'repo' => $repo,
                    'issue_url' => (string) ($data['issue_url'] ?? ''),
                    'html_url' => (string) ($data['html_url'] ?? ''),
                    'issue_number' => (int) ($data['issue_number'] ?? 0),
                    'title' => $title,
                    'error' => $success ? null : (string) ($result['error'] ?? 'GitHub issue publish failed'),
                ],
            ]);

            return (new DataPacket(
                [
                    'title' => $success ? 'GitHub Issue Published' : 'GitHub Issue Publish Failed',
                    'body' => wp_json_encode($result),
                ],
                [
                    'success' => $success,
                    'source_type' => 'stage4_github_issue_publish',
                    'result' => $data,
                ],
                'stage4_github_issue_publish'
            ))->addTo($this->dataPackets);
        }
    }
}

add_filter('datamachine_step_types', static function (array $steps): array {
    $steps['stage4_github_issue_publish'] = [
        'label' => 'Stage 4 GitHub Issue Publish',
        'description' => 'CI proof step that creates a GitHub issue through DMC.',
        'class' => 'WC_Site_Generator_Stage4_GitHub_Issue_Step',
        'position' => 99,
        'uses_handler' => false,
        'multi_handler' => false,
        'has_pipeline_config' => false,
        'consume_all_packets' => false,
        'show_settings_display' => false,
    ];
    return $steps;
});
if (class_exists('\DataMachine\Abilities\StepTypeAbilities')) {
    \DataMachine\Abilities\StepTypeAbilities::clearCache();
}

$pipelines = new Pipelines();
$flows = new Flows();
$jobs = new Jobs();
$run_id = gmdate('YmdHis') . '-' . substr(md5((string) microtime(true)), 0, 6);

$pipeline_config = [
    'stage4_publish' => [
        'pipeline_step_id' => 'stage4_publish',
        'step_type' => 'stage4_github_issue_publish',
        'execution_order' => 0,
        'label' => 'Stage 4 GitHub issue publish',
    ],
];

$pipeline_id = $pipelines->create_pipeline([
    'pipeline_name' => 'Stage 4 Playground GitHub issue pipeline',
    'pipeline_config' => $pipeline_config,
    'user_id' => 1,
]);
if (!$pipeline_id) {
    return [
        'metrics' => ['pipeline_created' => 0],
        'metadata' => $metadata + ['error' => 'Failed to create Stage 4 pipeline'],
    ];
}

$flow_id = $flows->create_flow([
    'pipeline_id' => (int) $pipeline_id,
    'flow_name' => 'Stage 4 Playground GitHub issue flow',
    'flow_config' => [],
    'scheduling_config' => ['interval' => 'manual', 'enabled' => true],
    'user_id' => 1,
]);
if (!$flow_id) {
    return [
        'metrics' => ['pipeline_created' => 1, 'flow_created' => 0],
        'metadata' => $metadata + [
            'pipeline_id' => (int) $pipeline_id,
            'error' => 'Failed to create Stage 4 flow',
        ],
    ];
}

$flow_step_id = 'stage4_publish_' . (int) $flow_id;
$flow_config = [
    $flow_step_id => [
        'flow_step_id' => $flow_step_id,
        'pipeline_step_id' => 'stage4_publish',
        'pipeline_id' => (int) $pipeline_id,
        'flow_id' => (int) $flow_id,
        'step_type' => 'stage4_github_issue_publish',
        'execution_order' => 0,
        'label' => 'Stage 4 GitHub issue publish',
        'target_repo' => $target_repo,
        'stage4_run_id' => $run_id,
    ],
];

if (!$flows->update_flow((int) $flow_id, ['flow_config' => $flow_config])) {
    return [
        'metrics' => ['pipeline_created' => 1, 'flow_created' => 1, 'flow_configured' => 0],
        'metadata' => $metadata + [
            'pipeline_id' => (int) $pipeline_id,
            'flow_id' => (int) $flow_id,
            'error' => 'Failed to configure Stage 4 flow',
        ],
    ];
}

$run_start_ns = hrtime(true);
$run_result = wp_get_ability('datamachine/run-flow')->execute(['flow_id' => (int) $flow_id]);
$run_elapsed_ms = (hrtime(true) - $run_start_ns) / 1_000_000;
$metadata['run_result'] = $run_result;

$job_id = is_array($run_result) ? (int) ($run_result['job_id'] ?? 0) : 0;
if (!is_array($run_result) || empty($run_result['success']) || $job_id <= 0) {
    return [
        'metrics' => ['run_flow_succeeded' => 0, 'run_elapsed_ms' => $run_elapsed_ms],
        'metadata' => $metadata + [
            'pipeline_id' => (int) $pipeline_id,
            'flow_id' => (int) $flow_id,
            'flow_step_id' => $flow_step_id,
            'error' => 'datamachine/run-flow failed or returned no job_id',
        ],
    ];
}

$drain_start_ns = hrtime(true);
$drain_result = wp_get_ability('datamachine/drain-job')->execute([
    'job_id' => $job_id,
    'step_budget' => 5,
    'time_budget_ms' => 60000,
]);
$drain_elapsed_ms = (hrtime(true) - $drain_start_ns) / 1_000_000;
$metadata['drain_result'] = $drain_result;

$job = $jobs->get_job($job_id);
$job_status = is_array($job) ? (string) ($job['status'] ?? '') : '';
$engine_data = datamachine_get_engine_data($job_id);
$publish_result = is_array($engine_data['stage4_github_issue_publish'] ?? null) ? $engine_data['stage4_github_issue_publish'] : [];

$issue_url = (string) ($publish_result['html_url'] ?: ($publish_result['issue_url'] ?? ''));
$publish_succeeded = !empty($publish_result['success']) && $issue_url !== '';
$drain_succeeded = is_array($drain_result) && !empty($drain_result['success']);
$job_completed = in_array($job_status, ['completed', 'completed_no_items'], true);

$metadata += [
    'pipeline_id' => (int) $pipeline_id,
    'flow_id' => (int) $flow_id,
    'flow_step_id' => $flow_step_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
    'publish_result' => $publish_result,
    'issue_url' => $issue_url,
];

return [
    'metrics' => [
        'github_token_present' => 1,
        'target_repo_valid' => 1,
        'required_abilities_resolved' => 1,
        'pipeline_created' => 1,
        'flow_created' => 1,
        'flow_configured' => 1,
        'run_flow_succeeded' => 1,
        'run_elapsed_ms' => $run_elapsed_ms,
        'drain_succeeded' => $drain_succeeded ? 1 : 0,
        'drain_elapsed_ms' => $drain_elapsed_ms,
        'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
        'publish_succeeded' => $publish_succeeded ? 1 : 0,
        'job_completed' => $job_completed ? 1 : 0,
    ],
    'metadata' => $metadata,
];
