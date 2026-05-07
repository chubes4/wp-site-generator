<?php
/**
 * Stage 2 import-agent probe.
 *
 * Imports the wc-idea-agent bundle through the canonical Abilities API surface
 * (`datamachine/import-agent`) and verifies the agent is registered by calling
 * `datamachine/get-agent`. Returns the canonical { metrics, artifacts, metadata }
 * shape so the Playground bench runner folds the result into BenchResults.
 *
 * Authentication note:
 * The Playground bench runner runs under `WP_INSTALLING=true` after wp-phpunit
 * boots WordPress and there is no logged-in user. `datamachine/import-agent`
 * requires `PermissionHelper::can_manage()`, so we set the current user to
 * the canonical admin (user 1) before resolving the ability. This is the same
 * shape PR #421's `ability` step type's `user:` field handles for repos that
 * declare it through settings; we replicate it here at the workload level
 * because the boot probe path doesn't go through that field.
 */

// Set the canonical admin user. wp-phpunit's installer creates user 1 with
// admin caps. If that ever changes upstream, this probe will surface it as a
// permission error in the result, which is the right failure mode.
if (function_exists('wp_set_current_user')) {
    wp_set_current_user(1);
}

if (!function_exists('did_action') || !function_exists('do_action')) {
    return [
        'metrics' => ['has_actions_api' => 0],
        'metadata' => ['error' => 'WordPress action API not available'],
    ];
}

// Prime the Abilities API actions exactly the way the runner's `ability` step
// does. The bench runner only fires these for ability-typed steps; this is a
// php-typed step, so we own the priming here.
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

$import_ability = wp_get_ability('datamachine/import-agent');
if (!$import_ability) {
    return [
        'metrics' => ['import_ability_resolved' => 0],
        'metadata' => [
            'error' => 'datamachine/import-agent not registered',
            'registered_categories' => function_exists('wp_get_ability_categories')
                ? array_map(static function ($cat) { return is_object($cat) && isset($cat->slug) ? $cat->slug : null; }, wp_get_ability_categories())
                : null,
        ],
    ];
}

// The bundle lives in the repo at bundles/wc-idea-agent. The driver script
// copies it into the component dir before the run so it's reachable inside
// Playground at the canonical mount path.
$component_path = '/wordpress/wp-content/plugins/wc-site-generator-ci-driver';
$bundle_path = $component_path . '/bundles/wc-idea-agent';

$metadata = [
    'bundle_path' => $bundle_path,
    'bundle_exists' => is_dir($bundle_path),
    'bundle_manifest_exists' => is_file($bundle_path . '/manifest.json'),
];

if (!$metadata['bundle_exists'] || !$metadata['bundle_manifest_exists']) {
    return [
        'metrics' => [
            'import_ability_resolved' => 1,
            'bundle_exists' => $metadata['bundle_exists'] ? 1 : 0,
        ],
        'metadata' => $metadata + ['error' => 'Bundle directory missing or incomplete'],
    ];
}

// Capture pre-import agent count so we can detect "imported vs already there".
$pre_count = 0;
$list_ability = wp_get_ability('datamachine/list-agents');
if ($list_ability) {
    $listed = $list_ability->execute([]);
    if (is_array($listed) && isset($listed['agents']) && is_array($listed['agents'])) {
        $pre_count = count($listed['agents']);
    }
}

$import_start_ns = hrtime(true);
$import_result = $import_ability->execute([
    'source' => $bundle_path,
    'on_conflict' => 'skip',
]);
$import_elapsed_ms = (hrtime(true) - $import_start_ns) / 1_000_000;

if (function_exists('is_wp_error') && is_wp_error($import_result)) {
    return [
        'metrics' => [
            'import_ability_resolved' => 1,
            'import_succeeded' => 0,
            'import_elapsed_ms' => $import_elapsed_ms,
        ],
        'metadata' => $metadata + [
            'error' => 'datamachine/import-agent returned WP_Error: ' . $import_result->get_error_message(),
        ],
    ];
}

$metadata['import_result'] = $import_result;

$agent_slug = $import_result['agent_slug'] ?? 'wc-idea-agent';

// Verify the agent is actually queryable through datamachine/get-agent — same
// path any consumer would use.
$get_agent_result = null;
$get_agent_ability = wp_get_ability('datamachine/get-agent');
if ($get_agent_ability) {
    $get_agent_result = $get_agent_ability->execute([
        'agent_slug' => $agent_slug,
    ]);
    $metadata['get_agent_result'] = $get_agent_result;
}

// Post-import flows + pipelines visible through the canonical abilities.
$post_flows = null;
$flows_ability = wp_get_ability('datamachine/get-flows');
if ($flows_ability) {
    $post_flows = $flows_ability->execute([]);
    $metadata['post_flows_count'] = is_array($post_flows) && isset($post_flows['flows'])
        ? count($post_flows['flows'])
        : null;
}

// Post-import agent count.
$post_count = $pre_count;
if ($list_ability) {
    $listed = $list_ability->execute([]);
    if (is_array($listed) && isset($listed['agents']) && is_array($listed['agents'])) {
        $post_count = count($listed['agents']);
    }
}
$metadata['pre_agent_count'] = $pre_count;
$metadata['post_agent_count'] = $post_count;

$import_succeeded = is_array($import_result) && !empty($import_result['success']);
$agent_resolved = is_array($get_agent_result) && !empty($get_agent_result['success']);

return [
    'metrics' => [
        'import_ability_resolved' => 1,
        'bundle_exists' => 1,
        'import_succeeded' => $import_succeeded ? 1 : 0,
        'import_elapsed_ms' => $import_elapsed_ms,
        'agent_resolved' => $agent_resolved ? 1 : 0,
        'pre_agent_count' => $pre_count,
        'post_agent_count' => $post_count,
        'agents_added' => max(0, $post_count - $pre_count),
        'post_flows_count' => $metadata['post_flows_count'] ?? 0,
    ],
    'metadata' => $metadata,
];
