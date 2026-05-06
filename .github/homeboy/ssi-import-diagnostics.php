<?php

return static function (): array {
	$site = function_exists( 'wp_get_theme' ) ? wp_get_theme()->get_stylesheet() : '';
	$report_path = WP_CONTENT_DIR . '/themes/' . $site . '/import-report.json';
	$metrics = array(
		'ssi_report_readable' => 0,
		'ssi_report_top_level_keys' => 0,
		'ssi_signal_total_count' => 0,
		'ssi_signal_error_count' => 0,
		'ssi_signal_warning_count' => 0,
		'ssi_signal_fallback_count' => 0,
		'ssi_signal_core_html_count' => 0,
		'ssi_signal_invalid_count' => 0,
		'ssi_signal_skipped_count' => 0,
		'ssi_signal_dropped_count' => 0,
	);
	$findings = array();

	if ( ! is_readable( $report_path ) ) {
		return array(
			'metrics' => $metrics,
			'metadata' => array(
				'import_report_summary' => array(
					'path' => $report_path,
					'readable' => false,
					'findings' => array(),
				),
			),
		);
	}

	$report = json_decode( file_get_contents( $report_path ), true );
	$metrics['ssi_report_readable'] = 1;
	$metrics['ssi_report_top_level_keys'] = is_array( $report ) ? count( $report ) : 0;

	$record_finding = static function ( string $kind, string $path, $value ) use ( &$findings, &$metrics ): void {
		$metric = 'ssi_signal_' . $kind . '_count';
		if ( isset( $metrics[ $metric ] ) ) {
			$metrics[ $metric ]++;
		}
		$metrics['ssi_signal_total_count']++;

		if ( count( $findings ) >= 25 ) {
			return;
		}

		$preview = is_scalar( $value ) ? (string) $value : wp_json_encode( $value );
		$findings[] = array(
			'kind' => $kind,
			'path' => $path,
			'preview' => substr( $preview ?: '', 0, 180 ),
		);
	};

	$walk = static function ( $value, string $path = '$' ) use ( &$walk, $record_finding ): void {
		$needles_by_kind = array(
			'error' => array( 'error', 'exception', 'fatal' ),
			'warning' => array( 'warning', 'notice' ),
			'fallback' => array( 'fallback' ),
			'core_html' => array( 'core/html', 'core html' ),
			'invalid' => array( 'invalid' ),
			'skipped' => array( 'skipped', 'skip' ),
			'dropped' => array( 'dropped', 'missing' ),
		);

		if ( is_array( $value ) ) {
			foreach ( $value as $key => $child ) {
				$child_path = $path . '.' . (string) $key;
				$haystack = strtolower( (string) $key . ' ' . ( is_scalar( $child ) ? (string) $child : '' ) );
				foreach ( $needles_by_kind as $kind => $needles ) {
					foreach ( $needles as $needle ) {
						if ( false !== strpos( $haystack, $needle ) ) {
							$record_finding( $kind, $child_path, $child );
							break;
						}
					}
				}
				$walk( $child, $child_path );
			}
			return;
		}

		if ( is_string( $value ) ) {
			$haystack = strtolower( $value );
			foreach ( $needles_by_kind as $kind => $needles ) {
				foreach ( $needles as $needle ) {
					if ( false !== strpos( $haystack, $needle ) ) {
						$record_finding( $kind, $path, $value );
						break;
					}
				}
			}
		}
	};
	$walk( $report );

	return array(
		'metrics' => $metrics,
		'metadata' => array(
			'import_report_summary' => array(
				'path' => $report_path,
				'readable' => true,
				'top_level_keys' => is_array( $report ) ? array_keys( $report ) : array(),
				'findings' => $findings,
			),
		),
	);
};
