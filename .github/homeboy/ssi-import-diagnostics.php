<?php

return static function (): array {
	$site = function_exists( 'wp_get_theme' ) ? wp_get_theme()->get_stylesheet() : '';
	$report_path = WP_CONTENT_DIR . '/themes/' . $site . '/import-report.json';
	$metrics = array(
		'ssi_report_readable' => 0,
		'ssi_report_top_level_keys' => 0,
		'ssi_signal_total_count' => 0,
		'ssi_ignored_region_count' => 0,
		'ssi_unassigned_region_count' => 0,
		'ssi_product_candidate_rejected_count' => 0,
		'ssi_fallback_count' => 0,
		'ssi_core_html_count' => 0,
		'ssi_invalid_block_count' => 0,
		'ssi_manifest_error_count' => 0,
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

	$record_finding = static function ( string $kind, string $path, $value ) use ( &$findings ): void {
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

	$get_path = static function ( array $value, array $keys ) {
		foreach ( $keys as $key ) {
			if ( ! is_array( $value ) || ! array_key_exists( $key, $value ) ) {
				return null;
			}
			$value = $value[ $key ];
		}

		return $value;
	};

	$count_value = static function ( $value ): int {
		if ( is_array( $value ) ) {
			return count( $value );
		}
		if ( is_numeric( $value ) ) {
			return max( 0, (int) $value );
		}

		return empty( $value ) ? 0 : 1;
	};

	$set_metric = static function ( string $metric, string $kind, string $path, $value, ?int $count = null ) use ( &$metrics, $count_value, $record_finding ): void {
		$count = null === $count ? $count_value( $value ) : $count;
		if ( $count <= 0 ) {
			return;
		}

		$metrics[ $metric ] += $count;
		if ( 'ssi_ignored_region_count' !== $metric ) {
			$metrics['ssi_signal_total_count'] += $count;
		}
		$record_finding( $kind, $path, $value );
	};

	$sum_named_counts = static function ( array $value, string $key ): int {
		$total = 0;
		foreach ( $value as $child ) {
			if ( is_array( $child ) && isset( $child[ $key ] ) && is_numeric( $child[ $key ] ) ) {
				$total += max( 0, (int) $child[ $key ] );
			}
		}

		return $total;
	};

	$count_diagnostics = static function ( array $report, callable $matches ) use ( $get_path ): int {
		$diagnostics = $get_path( $report, array( 'diagnostics' ) );
		if ( ! is_array( $diagnostics ) ) {
			return 0;
		}

		$count = 0;
		foreach ( $diagnostics as $diagnostic ) {
			if ( is_array( $diagnostic ) && $matches( $diagnostic ) ) {
				$count++;
			}
		}

		return $count;
	};

	$find_manifest_errors = static function ( $value, string $path = '$' ) use ( &$find_manifest_errors, $set_metric ): void {
		if ( ! is_array( $value ) ) {
			return;
		}

		foreach ( $value as $key => $child ) {
			$child_path = $path . '.' . (string) $key;
			$child_path_text = strtolower( $child_path );
			$key_text = strtolower( (string) $key );
			if ( false !== strpos( $child_path_text, 'manifest' ) && false !== strpos( $key_text, 'error' ) ) {
				$set_metric( 'ssi_manifest_error_count', 'manifest_error', $child_path, $child );
			}
			$find_manifest_errors( $child, $child_path );
		}
	};

	if ( is_array( $report ) ) {
		$ignored_regions = $get_path( $report, array( 'source_region_selection', 'intentionally_ignored_regions' ) );
		$set_metric( 'ssi_ignored_region_count', 'ignored_region', '$.source_region_selection.intentionally_ignored_regions', $ignored_regions );

		$unassigned_regions = $get_path( $report, array( 'source_region_selection', 'unassigned_regions' ) );
		$set_metric( 'ssi_unassigned_region_count', 'unassigned_region', '$.source_region_selection.unassigned_regions', $unassigned_regions );

		foreach ( array( 'rejected_candidates', 'rejected_product_candidates', 'candidate_rejections', 'product_candidate_rejections' ) as $key ) {
			$rejections = $get_path( $report, array( 'commerce_product_inference', $key ) );
			$set_metric( 'ssi_product_candidate_rejected_count', 'product_candidate_rejected', '$.commerce_product_inference.' . $key, $rejections );
		}

		$fallback_count = $get_path( $report, array( 'quality', 'fallback_count' ) );
		if ( null === $fallback_count ) {
			$fragments = $get_path( $report, array( 'conversion_fragments' ) );
			$fallback_count = is_array( $fragments ) ? $sum_named_counts( $fragments, 'fallback_count' ) : 0;
		}
		if ( 0 === $count_value( $fallback_count ) ) {
			$fallback_count = $count_diagnostics(
				$report,
				static fn ( array $diagnostic ): bool => isset( $diagnostic['type'] ) && false !== strpos( strtolower( (string) $diagnostic['type'] ), 'fallback' )
			);
		}
		$set_metric( 'ssi_fallback_count', 'fallback', '$.quality.fallback_count', $fallback_count );

		$core_html_count = $count_diagnostics(
			$report,
			static fn ( array $diagnostic ): bool => isset( $diagnostic['block_name'] ) && 'core/html' === strtolower( (string) $diagnostic['block_name'] )
		);
		$set_metric( 'ssi_core_html_count', 'core_html', '$.diagnostics[*].block_name', $core_html_count );

		$invalid_block_count = $get_path( $report, array( 'quality', 'invalid_block_count' ) );
		if ( null === $invalid_block_count ) {
			$documents = $get_path( $report, array( 'generated_theme', 'block_documents' ) );
			$invalid_block_count = is_array( $documents ) ? $sum_named_counts( $documents, 'invalid_block_count' ) : 0;
		}
		$set_metric( 'ssi_invalid_block_count', 'invalid_block', '$.quality.invalid_block_count', $invalid_block_count );

		$find_manifest_errors( $report );
	}

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
