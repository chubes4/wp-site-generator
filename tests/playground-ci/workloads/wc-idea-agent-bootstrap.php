<?php
/**
 * Minimal bootstrap for the wc-idea-agent generic runner proof.
 */

if ( function_exists( 'wp_set_current_user' ) ) {
	wp_set_current_user( 1 );
}

$target_repo = trim( (string) getenv( 'STAGE5_GITHUB_REPO' ) );
if ( '' === $target_repo || ! str_contains( $target_repo, '/' ) ) {
	throw new RuntimeException( 'STAGE5_GITHUB_REPO must be owner/repo.' );
}

return array(
	'metrics'  => array(
		'target_repo_valid' => 1,
	),
	'metadata' => array(
		'target_repo' => $target_repo,
	),
);
