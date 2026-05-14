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
		'ssi_freeform_block_count' => 0,
		'ssi_invalid_block_count' => 0,
		'ssi_manifest_error_count' => 0,
	);
	$findings = array();
	$fallback_diagnostics = array();
	$freeform_diagnostics = array();
	$seen_findings = array();
	$seen_fallback_diagnostics = array();
	$seen_freeform_diagnostics = array();

	if ( ! is_readable( $report_path ) ) {
		return array(
			'metrics' => $metrics,
			'metadata' => array(
				'import_report_summary' => array(
					'path' => $report_path,
					'readable' => false,
					'fallback_diagnostics' => array(),
					'freeform_diagnostics' => array(),
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

	$record_finding = static function ( string $kind, string $path, $value ) use ( &$findings, &$seen_findings, $preview_value ): void {
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

	$diagnostic_row = static function ( array $diagnostic ) use ( $preview_value, $first_scalar_path ): array {
		$row = array(
			'path' => $first_scalar_path(
				$diagnostic,
				array( array( 'path' ), array( 'source' ), array( 'scope', 'source_id' ), array( 'details', 'scope', 'source_id' ) )
			),
			'selector' => $first_scalar_path(
				$diagnostic,
				array( array( 'selector' ), array( 'source_selector' ), array( 'scope', 'source_selector' ), array( 'details', 'scope', 'source_selector' ) )
			),
			'excerpt' => $first_scalar_path(
				$diagnostic,
				array( array( 'excerpt' ), array( 'html_excerpt' ), array( 'message' ) )
			),
			'source_html_preview' => $first_scalar_path(
				$diagnostic,
				array( array( 'source_html_preview' ), array( 'html_excerpt' ), array( 'source_html' ) )
			),
			'block_name' => $first_scalar_path( $diagnostic, array( array( 'block_name' ) ) ),
			'converter' => $first_scalar_path( $diagnostic, array( array( 'converter' ) ) ),
			'stage' => $first_scalar_path( $diagnostic, array( array( 'stage' ), array( 'type' ), array( 'code' ) ) ),
			'reason' => $first_scalar_path( $diagnostic, array( array( 'reason' ), array( 'type' ), array( 'code' ), array( 'message' ) ) ),
			'emitted_block_preview' => $first_scalar_path( $diagnostic, array( array( 'emitted_block_preview' ), array( 'emitted_block' ) ) ),
		);

		foreach ( $row as $field => $value ) {
			$row[ $field ] = $preview_value( $value, in_array( $field, array( 'excerpt', 'source_html_preview', 'reason', 'emitted_block_preview' ), true ) ? 220 : 160 );
		}
		if ( '' === $row['converter'] ) {
			$row['converter'] = 'static-site-importer';
		}

		return $row;
	};

	$record_fallback_diagnostic = static function ( array $diagnostic ) use ( &$fallback_diagnostics, &$seen_fallback_diagnostics, $diagnostic_row ): void {
		$row = $diagnostic_row( $diagnostic );

		$key = wp_json_encode( $row );
		if ( isset( $seen_fallback_diagnostics[ $key ] ) ) {
			return;
		}

		$seen_fallback_diagnostics[ $key ] = true;
		$fallback_diagnostics[] = $row;
	};

	$record_freeform_diagnostic = static function ( array $diagnostic ) use ( &$freeform_diagnostics, &$seen_freeform_diagnostics, $diagnostic_row, $preview_value, $first_scalar_path ): void {
		$row = $diagnostic_row( $diagnostic );
		$row['block_path'] = $preview_value( $first_scalar_path( $diagnostic, array( array( 'block_path' ) ) ), 120 );
		$row['malformed'] = ! empty( $diagnostic['malformed'] );

		$key = wp_json_encode( $row );
		if ( isset( $seen_freeform_diagnostics[ $key ] ) ) {
			return;
		}

		$seen_freeform_diagnostics[ $key ] = true;
		$freeform_diagnostics[] = $row;
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

	$set_metric = static function ( string $metric, string $kind, string $path, $value, ?int $count = null, bool $record = true ) use ( &$metrics, $count_value, $record_finding ): void {
		$count = null === $count ? $count_value( $value ) : $count;
		if ( $count <= 0 ) {
			return;
		}

		$metrics[ $metric ] += $count;
		if ( 'ssi_ignored_region_count' !== $metric ) {
			$metrics['ssi_signal_total_count'] += $count;
		}
		if ( $record ) {
			$record_finding( $kind, $path, $value );
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

	$collect_fallback_diagnostics = static function ( array $report ) use ( $get_path, $record_fallback_diagnostic ): void {
		$diagnostics = $get_path( $report, array( 'diagnostics' ) );
		if ( ! is_array( $diagnostics ) ) {
			return;
		}

		$fallback_fields = array(
			'selector',
			'source_selector',
			'excerpt',
			'html_excerpt',
			'source_html_preview',
			'source_html',
			'block_name',
			'converter',
			'stage',
			'reason',
			'type',
			'code',
		);
		foreach ( $diagnostics as $diagnostic ) {
			if ( ! is_array( $diagnostic ) || ! array_intersect_key( $diagnostic, array_flip( $fallback_fields ) ) ) {
				continue;
			}

			$diagnostic_values = array();
			foreach ( array( 'type', 'code', 'message', 'block_name', 'converter', 'stage', 'reason' ) as $field ) {
				if ( isset( $diagnostic[ $field ] ) && is_scalar( $diagnostic[ $field ] ) ) {
					$diagnostic_values[] = (string) $diagnostic[ $field ];
				}
			}
			$haystack = strtolower( implode( ' ', $diagnostic_values ) );

			if (
				false !== strpos( $haystack, 'fallback' )
				|| false !== strpos( $haystack, 'unsupported_html' )
				|| false !== strpos( $haystack, 'core/html' )
			) {
				$record_fallback_diagnostic( $diagnostic );
			}
		}
	};

	$collect_freeform_diagnostics = static function ( array $report ) use ( $get_path, $record_freeform_diagnostic ): void {
		$theme_freeform_blocks = $get_path( $report, array( 'generated_theme', 'freeform_blocks' ) );
		if ( is_array( $theme_freeform_blocks ) ) {
			foreach ( $theme_freeform_blocks as $diagnostic ) {
				if ( is_array( $diagnostic ) ) {
					$record_freeform_diagnostic( $diagnostic );
				}
			}
		}

		$diagnostics = $get_path( $report, array( 'diagnostics' ) );
		if ( ! is_array( $diagnostics ) ) {
			return;
		}

		foreach ( $diagnostics as $diagnostic ) {
			if ( is_array( $diagnostic ) && 'freeform_block' === strtolower( (string) ( $diagnostic['type'] ?? '' ) ) ) {
				$record_freeform_diagnostic( $diagnostic );
			}
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
				$set_metric( 'ssi_manifest_error_count', 'manifest_error', $child_path, $child );
			}
			$find_manifest_errors( $child, $child_path );
		}
	};

	if ( is_array( $report ) ) {
		$collect_fallback_diagnostics( $report );
		$collect_freeform_diagnostics( $report );

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
		$set_metric( 'ssi_fallback_count', 'fallback', '$.quality.fallback_count', $fallback_count, null, 0 === count( $fallback_diagnostics ) );

		$core_html_count = $count_diagnostics(
			$report,
			static fn ( array $diagnostic ): bool => isset( $diagnostic['block_name'] ) && 'core/html' === strtolower( (string) $diagnostic['block_name'] )
		);
		$set_metric( 'ssi_core_html_count', 'core_html', '$.diagnostics[*].block_name', $core_html_count, null, 0 === count( $fallback_diagnostics ) );

		$freeform_block_count = $get_path( $report, array( 'quality', 'freeform_block_count' ) );
		if ( null === $freeform_block_count ) {
			$documents = $get_path( $report, array( 'generated_theme', 'block_documents' ) );
			$freeform_block_count = is_array( $documents ) ? $sum_named_counts( $documents, 'freeform_block_count' ) : 0;
		}
		$set_metric( 'ssi_freeform_block_count', 'freeform_block', '$.quality.freeform_block_count', $freeform_block_count, null, 0 === count( $freeform_diagnostics ) );

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
				'fallback_diagnostics' => $fallback_diagnostics,
				'freeform_diagnostics' => $freeform_diagnostics,
				'findings' => $findings,
			),
		),
	);
};
