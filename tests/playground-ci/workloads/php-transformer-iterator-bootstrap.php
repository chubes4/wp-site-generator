<?php
/**
 * Validates iterator-specific input before the generic Data Machine runner runs.
 */

if ( function_exists( 'wp_set_current_user' ) ) {
	wp_set_current_user( 1 );
}

$finding_groups_json = trim( (string) getenv( 'ITERATOR_FINDING_GROUPS_JSON' ) );
$finding_groups      = '' !== $finding_groups_json ? json_decode( $finding_groups_json, true ) : null;
if ( ! is_array( $finding_groups ) || empty( $finding_groups['groups'] ) ) {
	throw new RuntimeException( 'ITERATOR_FINDING_GROUPS_JSON must provide grouped findings JSON.' );
}

return array(
	'metrics'  => array(
		'finding_groups_valid' => 1,
		'finding_group_count'  => (int) ( $finding_groups['group_count'] ?? 0 ),
	),
	'metadata' => array(
		'source_repo'             => trim( (string) getenv( 'ITERATOR_SOURCE_REPO' ) ),
		'source_pr'               => trim( (string) getenv( 'ITERATOR_SOURCE_PR' ) ),
		'source_head_sha'         => trim( (string) getenv( 'ITERATOR_SOURCE_HEAD_SHA' ) ),
		'validation_run_id'       => trim( (string) getenv( 'ITERATOR_VALIDATION_RUN_ID' ) ),
		'finding_groups_source'   => 'json',
		'finding_groups_json_len' => strlen( $finding_groups_json ),
	),
);
