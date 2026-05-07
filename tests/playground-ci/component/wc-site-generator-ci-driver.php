<?php
/**
 * Plugin Name: wc-site-generator CI driver
 * Description: Tiny plugin shell used as the "component under test" for the
 *              Stage 1 Playground proof. Carries no behavior — exists only so
 *              the Homeboy WordPress extension's bench runner can mount this
 *              repo into wp-content/plugins and use validation_dependencies
 *              to mount Data Machine + Data Machine Code alongside.
 *
 *              Once Stage 1 confirms DM cold-boots cleanly under PHP-WASM +
 *              SQLite, later stages add bundle install + flow run + GitHub
 *              issue post.
 *
 * Refs Extra-Chill/homeboy-extensions#422
 */

if (!defined('WPINC')) {
    die;
}

// No-op. Existence is the contract.
