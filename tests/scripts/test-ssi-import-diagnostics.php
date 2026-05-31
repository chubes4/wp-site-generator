<?php

declare( strict_types=1 );

$repo_root = dirname( __DIR__, 2 );
$tmp_dir   = sys_get_temp_dir() . '/ssi-import-diagnostics-' . bin2hex( random_bytes( 4 ) );
$theme_dir = $tmp_dir . '/wp-content/themes/demo-theme';

register_shutdown_function(
	static function () use ( $tmp_dir ): void {
		if ( ! is_dir( $tmp_dir ) ) {
			return;
		}

		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $tmp_dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ( $iterator as $item ) {
			$item->isDir() ? rmdir( $item->getPathname() ) : unlink( $item->getPathname() );
		}
		rmdir( $tmp_dir );
	}
);

if ( ! mkdir( $theme_dir, 0777, true ) && ! is_dir( $theme_dir ) ) {
	throw new RuntimeException( 'Failed to create fixture theme directory.' );
}

define( 'WP_CONTENT_DIR', $tmp_dir . '/wp-content' );

function wp_get_theme() {
	return new class() {
		public function get_stylesheet(): string {
			return 'demo-theme';
		}
	};
}

function wp_json_encode( $value, $flags = 0 ) {
	return json_encode( $value, $flags );
}

$report = array(
	'quality'     => array(
		'fallback_count' => 1,
	),
	'diagnostics' => array(
		array(
			'type'         => 'unsupported_html_fallback',
			'source'       => 'main:index.html',
			'reason'       => 'unsupported_custom_element',
			'tag_name'     => 'fancy-card',
			'block_name'   => 'core/html',
			'html_excerpt' => '<fancy-card><h2>Chef special</h2></fancy-card>',
		),
	),
);

file_put_contents( $theme_dir . '/import-report.json', json_encode( $report ) );

$diagnostics = require $repo_root . '/.github/homeboy/ssi-import-diagnostics.php';
$result      = $diagnostics();
$summary     = $result['metadata']['import_report_summary'] ?? array();
$modern_rows = $summary['diagnostics'] ?? array();
$rows        = $summary['fallback_diagnostics'] ?? array();
$findings    = $summary['findings'] ?? array();

assert_same( 1, $result['metrics']['ssi_fallback_count'] ?? null, 'fallback metric' );
assert_same( 1, $result['metrics']['ssi_core_html_count'] ?? null, 'core/html metric' );
assert_same( 1, count( $modern_rows ), 'modern diagnostic row count' );
assert_same( 1, count( $rows ), 'fallback diagnostic row count' );

$modern_row = $modern_rows[0];
assert_same( 'unsupported_html_fallback', $modern_row['type'] ?? null, 'modern diagnostic type' );
assert_same( 'unsupported_custom_element', $modern_row['reason_code'] ?? null, 'modern diagnostic reason code' );
assert_same( 'main:index.html', $modern_row['source_path'] ?? null, 'modern diagnostic source path' );
assert_same( 'core/html', $modern_row['block_name'] ?? null, 'modern diagnostic block name' );

$row = $rows[0];
assert_same( 'main:index.html', $row['path'] ?? null, 'diagnostic path' );
assert_same( 'core/html', $row['block_name'] ?? null, 'diagnostic block name' );
assert_same( 'unsupported_custom_element', $row['reason'] ?? null, 'diagnostic reason' );
assert_same( 'static-site-importer', $row['converter'] ?? null, 'diagnostic converter fallback' );
assert_contains( 'fancy-card', $row['excerpt'] ?? '', 'diagnostic excerpt' );
assert_contains( 'fancy-card', $row['source_html_preview'] ?? '', 'diagnostic source preview' );

foreach ( $findings as $finding ) {
	if ( in_array( $finding['kind'] ?? '', array( 'fallback', 'core_html' ), true ) ) {
		throw new RuntimeException( 'Concrete fallback diagnostics should suppress aggregate fallback/core_html findings.' );
	}
}

function assert_same( $expected, $actual, string $label ): void {
	if ( $expected !== $actual ) {
		throw new RuntimeException( sprintf( '%s: expected %s, got %s', $label, var_export( $expected, true ), var_export( $actual, true ) ) );
	}
}

function assert_contains( string $needle, string $haystack, string $label ): void {
	if ( false === strpos( $haystack, $needle ) ) {
		throw new RuntimeException( sprintf( '%s: expected %s to contain %s', $label, var_export( $haystack, true ), var_export( $needle, true ) ) );
	}
}
