<?php
/**
 * Stage 1 boot probe.
 *
 * Asserts that Data Machine and Data Machine Code loaded cleanly inside the
 * Playground PHP-WASM process under SQLite, with no deferred-action errors and
 * no fatal NOTICEs that would block bundle install / flow run later.
 *
 * Returns the canonical { metrics, artifacts, metadata } shape so the
 * Playground bench runner folds the result into the BenchResults envelope.
 */

$metrics = [];
$metadata = [
    'wp_version' => function_exists('get_bloginfo') ? get_bloginfo('version') : null,
    'php_version' => PHP_VERSION,
    'is_sqlite' => defined('DB_NAME') && DB_NAME === ':memory:',
];

// Plugin presence (loaded into the same process via the bench runner's
// load_deps + load_component stages).
$metadata['data_machine_loaded'] = defined('DATAMACHINE_VERSION') || defined('DM_VERSION') || class_exists('DataMachine\\Core\\Plugin') || class_exists('DataMachine\\Plugin');
$metadata['data_machine_code_loaded'] = defined('DATAMACHINE_CODE_VERSION') || class_exists('DataMachine\\Code\\Plugin');

// Active plugins as wp-settings.php sees them (informational; bench runner
// loads dependencies directly without inserting into the active_plugins option).
$metadata['active_plugins'] = function_exists('get_option') ? (array) get_option('active_plugins', []) : [];

// Abilities API surface (in WP core 6.9+).
$metadata['abilities_api_available'] = function_exists('wp_get_ability') && function_exists('wp_register_ability');

// Action Scheduler — DM relies on it heavily; if AS missed boot, async work
// won't run and DM's --drain helper has nothing to drain.
$metadata['action_scheduler_loaded'] = class_exists('ActionScheduler') || class_exists('ActionScheduler_Versions');

if (function_exists('wp_get_active_and_valid_plugins')) {
    $metadata['active_and_valid_count'] = count(wp_get_active_and_valid_plugins());
}

// DM-specific surfaces. None of these are public API contracts; they're just
// "if this is true, DM came up". Future stages narrow this to ability
// resolution.
$metadata['datamachine_command_registered'] = class_exists('WP_CLI') && method_exists('WP_CLI', 'has_command') && WP_CLI::has_command('datamachine');

$metadata['datamachine_classes_seen'] = array_values(array_filter([
    class_exists('DataMachine\\Core\\Plugin') ? 'DataMachine\\Core\\Plugin' : null,
    class_exists('DataMachine\\Plugin') ? 'DataMachine\\Plugin' : null,
    class_exists('DataMachine\\Core\\Database\\Chat\\Chat') ? 'DataMachine\\Core\\Database\\Chat\\Chat' : null,
    class_exists('DataMachine\\Code\\Plugin') ? 'DataMachine\\Code\\Plugin' : null,
]));

$metrics['dm_classes_seen'] = count($metadata['datamachine_classes_seen']);
$metrics['active_plugin_count'] = count($metadata['active_plugins']);
$metrics['has_dm'] = $metadata['data_machine_loaded'] ? 1 : 0;
$metrics['has_dmc'] = $metadata['data_machine_code_loaded'] ? 1 : 0;
$metrics['has_abilities'] = $metadata['abilities_api_available'] ? 1 : 0;
$metrics['has_action_scheduler'] = $metadata['action_scheduler_loaded'] ? 1 : 0;

return [
    'metrics' => $metrics,
    'metadata' => $metadata,
];
