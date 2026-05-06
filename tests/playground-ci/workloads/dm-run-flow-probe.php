<?php
/**
 * Stage 3 run-flow probe.
 *
 * Imports the wc-idea-agent bundle, creates a CI-safe one-step fetch flow, runs
 * it through `datamachine/run-flow`, and drains the queued Action Scheduler
 * work through `datamachine/drain-job`. The flow intentionally returns no
 * items, so it proves the execution loop without AI token spend or GitHub I/O.
 */

use DataMachine\Core\Database\Flows\Flows;
use DataMachine\Core\Database\Jobs\Jobs;
use DataMachine\Core\Database\Pipelines\Pipelines;

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

$metadata = [];
$required_abilities = [
    'datamachine/import-agent',
    'datamachine/run-flow',
    'datamachine/drain-job',
];

foreach ($required_abilities as $ability_name) {
    if (!wp_get_ability($ability_name)) {
        return [
            'metrics' => ['required_abilities_resolved' => 0],
            'metadata' => ['error' => $ability_name . ' not registered'],
        ];
    }
}

$component_path = '/wordpress/wp-content/plugins/wc-store-blueprints-ci-driver';
$bundle_path = $component_path . '/bundles/wc-idea-agent';

$metadata['bundle_path'] = $bundle_path;
$metadata['bundle_exists'] = is_dir($bundle_path);
$metadata['bundle_manifest_exists'] = is_file($bundle_path . '/manifest.json');

if (!$metadata['bundle_exists'] || !$metadata['bundle_manifest_exists']) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'bundle_exists' => $metadata['bundle_exists'] ? 1 : 0,
        ],
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
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 0,
            'import_elapsed_ms' => $import_elapsed_ms,
        ],
        'metadata' => $metadata + ['error' => 'datamachine/import-agent failed'],
    ];
}

if (!class_exists(Pipelines::class) || !class_exists(Flows::class) || !class_exists(Jobs::class)) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 1,
            'database_repositories_available' => 0,
        ],
        'metadata' => $metadata + ['error' => 'Data Machine database repositories not available'],
    ];
}

$pipelines = new Pipelines();
$flows = new Flows();
$jobs = new Jobs();

$pipeline_config = [
    'stage3_fetch' => [
        'pipeline_step_id' => 'stage3_fetch',
        'step_type' => 'fetch',
        'execution_order' => 0,
        'label' => 'Stage 3 no-op fetch',
    ],
];

$pipeline_id = $pipelines->create_pipeline([
    'pipeline_name' => 'Stage 3 Playground no-op pipeline',
    'pipeline_config' => $pipeline_config,
    'user_id' => 1,
]);

if (!$pipeline_id) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 1,
            'pipeline_created' => 0,
        ],
        'metadata' => $metadata + ['error' => 'Failed to create CI-safe pipeline'],
    ];
}

$flow_id = $flows->create_flow([
    'pipeline_id' => (int) $pipeline_id,
    'flow_name' => 'Stage 3 Playground no-op flow',
    'flow_config' => [],
    'scheduling_config' => ['interval' => 'manual', 'enabled' => true],
    'user_id' => 1,
]);

if (!$flow_id) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 1,
            'pipeline_created' => 1,
            'flow_created' => 0,
        ],
        'metadata' => $metadata + [
            'pipeline_id' => (int) $pipeline_id,
            'error' => 'Failed to create CI-safe flow',
        ],
    ];
}

$flow_step_id = 'stage3_fetch_' . (int) $flow_id;
$flow_config = [
    $flow_step_id => [
        'flow_step_id' => $flow_step_id,
        'pipeline_step_id' => 'stage3_fetch',
        'pipeline_id' => (int) $pipeline_id,
        'flow_id' => (int) $flow_id,
        'step_type' => 'fetch',
        'execution_order' => 0,
        'label' => 'Stage 3 no-op fetch',
        'handler_slug' => 'webhook_payload',
        'handler_config' => [
            'title_path' => 'title',
            'content_path' => 'content',
            'ignore_missing_paths' => true,
        ],
        'queue_mode' => 'static',
    ],
];

$flow_updated = $flows->update_flow((int) $flow_id, ['flow_config' => $flow_config]);
if (!$flow_updated) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 1,
            'pipeline_created' => 1,
            'flow_created' => 1,
            'flow_configured' => 0,
        ],
        'metadata' => $metadata + [
            'pipeline_id' => (int) $pipeline_id,
            'flow_id' => (int) $flow_id,
            'error' => 'Failed to configure CI-safe flow',
        ],
    ];
}

$run_start_ns = hrtime(true);
$run_result = wp_get_ability('datamachine/run-flow')->execute([
    'flow_id' => (int) $flow_id,
]);
$run_elapsed_ms = (hrtime(true) - $run_start_ns) / 1_000_000;
$metadata['run_result'] = $run_result;

$job_id = is_array($run_result) ? (int) ($run_result['job_id'] ?? 0) : 0;
if (!is_array($run_result) || empty($run_result['success']) || $job_id <= 0) {
    return [
        'metrics' => [
            'required_abilities_resolved' => 1,
            'import_succeeded' => 1,
            'pipeline_created' => 1,
            'flow_created' => 1,
            'flow_configured' => 1,
            'run_flow_succeeded' => 0,
            'run_elapsed_ms' => $run_elapsed_ms,
        ],
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
    'time_budget_ms' => 30000,
]);
$drain_elapsed_ms = (hrtime(true) - $drain_start_ns) / 1_000_000;
$metadata['drain_result'] = $drain_result;

$job = $jobs->get_job($job_id);
$job_status = is_array($job) ? (string) ($job['status'] ?? '') : '';
$terminal_state = is_array($drain_result) ? (string) ($drain_result['terminal_state'] ?? '') : '';
$drain_succeeded = is_array($drain_result) && !empty($drain_result['success']);
$expected_terminal = in_array($terminal_state, ['completed', 'completed_no_items'], true);
$job_reached_expected_status = in_array($job_status, ['completed', 'completed_no_items'], true);

$metadata += [
    'pipeline_id' => (int) $pipeline_id,
    'flow_id' => (int) $flow_id,
    'flow_step_id' => $flow_step_id,
    'job_id' => $job_id,
    'job_status' => $job_status,
];

return [
    'metrics' => [
        'required_abilities_resolved' => 1,
        'import_succeeded' => 1,
        'import_elapsed_ms' => $import_elapsed_ms,
        'pipeline_created' => 1,
        'flow_created' => 1,
        'flow_configured' => 1,
        'run_flow_succeeded' => 1,
        'run_elapsed_ms' => $run_elapsed_ms,
        'drain_succeeded' => $drain_succeeded ? 1 : 0,
        'drain_elapsed_ms' => $drain_elapsed_ms,
        'actions_drained' => is_array($drain_result) ? (int) ($drain_result['actions_drained'] ?? 0) : 0,
        'expected_terminal_state' => $expected_terminal ? 1 : 0,
        'job_reached_expected_status' => $job_reached_expected_status ? 1 : 0,
    ],
    'metadata' => $metadata,
];
