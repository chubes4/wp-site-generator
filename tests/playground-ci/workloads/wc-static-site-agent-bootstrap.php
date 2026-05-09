<?php
/**
 * Validates static-site-agent CI inputs before the generic runner runs.
 */

if ( function_exists( 'wp_set_current_user' ) ) {
	wp_set_current_user( 1 );
}

$issue_number = (int) getenv( 'STATIC_SITE_AGENT_ISSUE_NUMBER' );
if ( $issue_number <= 0 ) {
	throw new RuntimeException( 'STATIC_SITE_AGENT_ISSUE_NUMBER must be a positive integer.' );
}

update_option( 'datamachine_persist_pipeline_transcripts', true, false );

return array(
	'metrics'  => array(
		'issue_number_valid' => 1,
	),
	'metadata' => array(
		'issue_number' => $issue_number,
		'target_repo'  => trim( (string) getenv( 'STATIC_SITE_AGENT_TARGET_REPO' ) ),
	),
);
