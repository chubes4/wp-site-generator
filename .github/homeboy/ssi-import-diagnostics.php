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
	$fallback_diagnostics = array();
	$seen_findings = array();
	$seen_fallback_diagnostics = array();

	if ( ! is_readable( $report_path ) ) {
		return array(
			'metrics' => $metrics,
			'metadata' => array(
				'import_report_summary' => array(
					'path' => $report_path,
					'readable' => false,
					'fallback_diagnostics' => array(),
					'findings' => array(),
				),
			),
		);
	}

	$report = json_decode( file_get_contents( $report_path ), true );
	$metrics['ssi_report_readable'] = 1;
	$metrics['ssi_report_top_level_keys'] = is_array( $report ) ? count( $report ) : 0;

	$preview_value = static function ( $value, int $length = 180 ): string {
		$preview = is_scalar( $value ) ? (string) $value : wp_json_encode( $value );

		return substr( $preview ?: '', 0, $length );
	};

	$record_finding = static function ( string $kind, string $path, $value ) use ( &$findings, &$metrics, &$seen_findings, $preview_value ): void {
		$metric = 'ssi_signal_' . $kind . '_count';
		if ( isset( $metrics[ $metric ] ) ) {
			$metrics[ $metric ]++;
		}
		$metrics['ssi_signal_total_count']++;

		$preview = $preview_value( $value );
		$key = $kind . '|' . $path . '|' . $preview;
		if ( isset( $seen_findings[ $key ] ) ) {
			return;
		}
		$seen_findings[ $key ] = true;

		if ( count( $findings ) >= 25 ) {
			return;
		}

		$findings[] = array(
			'kind' => $kind,
			'path' => $path,
			'preview' => $preview,
		);
	};

	$record_fallback_diagnostic = static function ( array $diagnostic ) use ( &$fallback_diagnostics, &$seen_fallback_diagnostics, $preview_value ): void {
		$fields = array(
			'selector' => 160,
			'excerpt' => 220,
			'source_html_preview' => 220,
			'block_name' => 80,
			'converter' => 80,
			'stage' => 80,
			'reason' => 220,
		);
		$row = array();

		foreach ( $fields as $field => $length ) {
			$row[ $field ] = isset( $diagnostic[ $field ] ) ? $preview_value( $diagnostic[ $field ], $length ) : '';
		}

		$key = wp_json_encode( $row );
		if ( isset( $seen_fallback_diagnostics[ $key ] ) ) {
			return;
		}

		$seen_fallback_diagnostics[ $key ] = true;
		$fallback_diagnostics[] = $row;
	};

	$walk = static function ( $value, string $path = '$' ) use ( &$walk, $record_finding, $record_fallback_diagnostic ): void {
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
			$diagnostic_values = array();
			foreach ( array( 'type', 'block_name', 'converter', 'stage', 'reason' ) as $diagnostic_field ) {
				if ( isset( $value[ $diagnostic_field ] ) && is_scalar( $value[ $diagnostic_field ] ) ) {
					$diagnostic_values[] = (string) $value[ $diagnostic_field ];
				}
			}
			$diagnostic_haystack = strtolower( implode( ' ', $diagnostic_values ) );
			$has_fallback_fields = array_intersect_key(
				$value,
				array_flip( array( 'selector', 'excerpt', 'source_html_preview', 'block_name', 'converter', 'stage', 'reason' ) )
			);

			if (
				$has_fallback_fields
				&& (
					false !== strpos( $diagnostic_haystack, 'fallback' )
					|| false !== strpos( $diagnostic_haystack, 'unsupported_html' )
					|| false !== strpos( $diagnostic_haystack, 'core/html' )
				)
			) {
				$record_fallback_diagnostic( $value );
			}

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
				'fallback_diagnostics' => $fallback_diagnostics,
				'findings' => $findings,
			),
		),
	);
};
