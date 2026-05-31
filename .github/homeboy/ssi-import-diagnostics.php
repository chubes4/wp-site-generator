<?php

return static function (): array {
	$site = function_exists( 'wp_get_theme' ) ? wp_get_theme()->get_stylesheet() : '';
	$report_path = WP_CONTENT_DIR . '/themes/' . $site . '/import-report.json';
	if ( ! is_readable( $report_path ) ) {
		$report_candidates = glob( WP_CONTENT_DIR . '/themes/*/import-report.json' );
		if ( is_array( $report_candidates ) ) {
			$report_candidates = array_values( array_filter( $report_candidates, 'is_readable' ) );
			usort(
				$report_candidates,
				static fn ( string $left, string $right ): int => filemtime( $right ) <=> filemtime( $left )
			);
			if ( ! empty( $report_candidates ) ) {
				$report_path = $report_candidates[0];
			}
		}
	}
	$metrics = array(
		'ssi_report_readable' => 0,
		'ssi_report_top_level_keys' => 0,
		'ssi_signal_total_count' => 0,
		'ssi_ignored_region_count' => 0,
		'ssi_unassigned_region_count' => 0,
		'ssi_product_candidate_rejected_count' => 0,
		'ssi_fallback_count' => 0,
		'ssi_core_html_count' => 0,
		'ssi_freeform_block_count' => 0,
		'ssi_invalid_block_count' => 0,
		'ssi_manifest_error_count' => 0,
	);
	$diagnostics = array();
	$seen_diagnostics = array();

	if ( ! is_readable( $report_path ) ) {
		return array(
			'metrics' => $metrics,
			'metadata' => array(
					'import_report_summary' => array(
						'path' => $report_path,
						'readable' => false,
						'diagnostics' => array(),
						'asset_map' => array(),
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

	$first_scalar_path = static function ( array $value, array $paths ): string {
		foreach ( $paths as $path ) {
			$cursor = $value;
			foreach ( $path as $key ) {
				if ( ! is_array( $cursor ) || ! array_key_exists( $key, $cursor ) ) {
					continue 2;
				}
				$cursor = $cursor[ $key ];
			}

			if ( is_scalar( $cursor ) && '' !== (string) $cursor ) {
				return (string) $cursor;
			}
		}

		return '';
	};

	$modern_diagnostic_row = static function ( array $diagnostic ) use ( $preview_value, $first_scalar_path ): array {
		$row = array(
			'diagnostic_id' => $first_scalar_path( $diagnostic, array( array( 'id' ), array( 'diagnostic_id' ) ) ),
			'type' => $first_scalar_path( $diagnostic, array( array( 'type' ), array( 'code' ) ) ),
			'severity' => $first_scalar_path( $diagnostic, array( array( 'severity' ) ) ),
			'category' => $first_scalar_path( $diagnostic, array( array( 'category' ) ) ),
			'reason_code' => $first_scalar_path( $diagnostic, array( array( 'reason_code' ), array( 'reason' ), array( 'error_code' ), array( 'code' ) ) ),
			'suggested_repair_class' => $first_scalar_path( $diagnostic, array( array( 'suggested_repair_class' ) ) ),
			'source_path' => $first_scalar_path( $diagnostic, array( array( 'source_path' ), array( 'path' ), array( 'source' ), array( 'scope', 'source_id' ), array( 'details', 'scope', 'source_id' ) ) ),
			'selector' => $first_scalar_path( $diagnostic, array( array( 'selector' ), array( 'source_selector' ), array( 'scope', 'source_selector' ), array( 'details', 'scope', 'source_selector' ) ) ),
			'stage' => $first_scalar_path( $diagnostic, array( array( 'stage' ) ) ),
			'converter' => $first_scalar_path( $diagnostic, array( array( 'converter' ) ) ),
			'block_name' => $first_scalar_path( $diagnostic, array( array( 'block_name' ), array( 'context', 'block_name' ) ) ),
			'block_path' => $first_scalar_path( $diagnostic, array( array( 'block_path' ), array( 'context', 'block_path' ) ) ),
			'source_html_preview' => $first_scalar_path( $diagnostic, array( array( 'source_html_preview' ), array( 'html_excerpt' ), array( 'source_html' ), array( 'context', 'source_html_preview' ), array( 'context', 'html_excerpt' ) ) ),
			'excerpt' => $first_scalar_path( $diagnostic, array( array( 'excerpt' ), array( 'html_excerpt' ), array( 'message' ), array( 'context', 'excerpt' ) ) ),
			'message' => $first_scalar_path( $diagnostic, array( array( 'message' ), array( 'error_message' ), array( 'context', 'error_message' ) ) ),
			'emitted_block_preview' => $first_scalar_path( $diagnostic, array( array( 'emitted_block_preview' ), array( 'emitted_block' ) ) ),
		);

		foreach ( $row as $field => $value ) {
			$row[ $field ] = $preview_value( $value, in_array( $field, array( 'source_html_preview', 'excerpt', 'message', 'emitted_block_preview' ), true ) ? 400 : 180 );
		}

		$diagnostic_refs = array();
		if ( ! empty( $diagnostic['diagnostic_refs'] ) && is_array( $diagnostic['diagnostic_refs'] ) ) {
			$diagnostic_refs = $diagnostic['diagnostic_refs'];
		}
		$row['diagnostic_refs'] = $diagnostic_refs;

		$asset_map_refs = array();
		foreach ( array( 'asset_map_ref', 'asset_map_refs' ) as $field ) {
			if ( isset( $diagnostic[ $field ] ) ) {
				$asset_map_refs = is_array( $diagnostic[ $field ] ) ? $diagnostic[ $field ] : array( $diagnostic[ $field ] );
			}
		}
		foreach ( array( 'url', 'href', 'src', 'key' ) as $field ) {
			if ( isset( $diagnostic[ $field ] ) && is_scalar( $diagnostic[ $field ] ) ) {
				$asset_map_refs[ $field ] = (string) $diagnostic[ $field ];
			}
		}
		$row['asset_map_refs'] = $asset_map_refs;

		return $row;
	};

	$record_modern_diagnostic = static function ( array $diagnostic ) use ( &$diagnostics, &$seen_diagnostics, $modern_diagnostic_row ): void {
		$row = $modern_diagnostic_row( $diagnostic );
		$key = wp_json_encode( $row );
		if ( isset( $seen_diagnostics[ $key ] ) ) {
			return;
		}

		$seen_diagnostics[ $key ] = true;
		$diagnostics[] = $row;
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

	$set_metric = static function ( string $metric, $value, ?int $count = null ) use ( &$metrics, $count_value ): void {
		$count = null === $count ? $count_value( $value ) : $count;
		if ( $count <= 0 ) {
			return;
		}

		$metrics[ $metric ] += $count;
		if ( 'ssi_ignored_region_count' !== $metric ) {
			$metrics['ssi_signal_total_count'] += $count;
		}
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

	$collect_modern_diagnostics = static function ( array $report ) use ( $get_path, $record_modern_diagnostic ): void {
		$diagnostics = $get_path( $report, array( 'diagnostics' ) );
		if ( ! is_array( $diagnostics ) ) {
			return;
		}

		foreach ( $diagnostics as $diagnostic ) {
			if ( ! is_array( $diagnostic ) ) {
				continue;
			}
			$record_modern_diagnostic( $diagnostic );
		}
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
				$set_metric( 'ssi_manifest_error_count', $child );
			}
			$find_manifest_errors( $child, $child_path );
		}
	};

	if ( is_array( $report ) ) {
		$collect_modern_diagnostics( $report );

		$ignored_regions = $get_path( $report, array( 'source_region_selection', 'intentionally_ignored_regions' ) );
		$set_metric( 'ssi_ignored_region_count', $ignored_regions );

		$unassigned_regions = $get_path( $report, array( 'source_region_selection', 'unassigned_regions' ) );
		$set_metric( 'ssi_unassigned_region_count', $unassigned_regions );

		foreach ( array( 'rejected_candidates', 'rejected_product_candidates', 'candidate_rejections', 'product_candidate_rejections' ) as $key ) {
			$rejections = $get_path( $report, array( 'commerce_product_inference', $key ) );
			$set_metric( 'ssi_product_candidate_rejected_count', $rejections );
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
		$set_metric( 'ssi_fallback_count', $fallback_count );

		$core_html_count = $count_diagnostics(
			$report,
			static fn ( array $diagnostic ): bool => isset( $diagnostic['block_name'] ) && 'core/html' === strtolower( (string) $diagnostic['block_name'] )
		);
		$set_metric( 'ssi_core_html_count', $core_html_count );

		$freeform_block_count = $get_path( $report, array( 'quality', 'freeform_block_count' ) );
		if ( null === $freeform_block_count ) {
			$documents = $get_path( $report, array( 'generated_theme', 'block_documents' ) );
			$freeform_block_count = is_array( $documents ) ? $sum_named_counts( $documents, 'freeform_block_count' ) : 0;
		}
		$set_metric( 'ssi_freeform_block_count', $freeform_block_count );

		$invalid_block_count = $get_path( $report, array( 'quality', 'invalid_block_count' ) );
		if ( null === $invalid_block_count ) {
			$documents = $get_path( $report, array( 'generated_theme', 'block_documents' ) );
			$invalid_block_count = is_array( $documents ) ? $sum_named_counts( $documents, 'invalid_block_count' ) : 0;
		}
		$set_metric( 'ssi_invalid_block_count', $invalid_block_count );

		$find_manifest_errors( $report );
	}

	return array(
		'metrics' => $metrics,
		'metadata' => array(
			'import_report_summary' => array(
				'path' => $report_path,
				'readable' => true,
				'top_level_keys' => is_array( $report ) ? array_keys( $report ) : array(),
				'diagnostics' => $diagnostics,
				'asset_map' => is_array( $get_path( $report, array( 'asset_map' ) ) ) ? $get_path( $report, array( 'asset_map' ) ) : array(),
			),
		),
	);
};
