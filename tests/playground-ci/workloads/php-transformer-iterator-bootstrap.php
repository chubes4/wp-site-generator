<?php
/**
 * Repo-specific bootstrap for the generic Data Machine agent runner.
 */

if ( function_exists( 'wp_set_current_user' ) ) {
	wp_set_current_user( 1 );
}

$finding_groups_json = trim( (string) getenv( 'ITERATOR_FINDING_GROUPS_JSON' ) );
$finding_groups      = '' !== $finding_groups_json ? json_decode( $finding_groups_json, true ) : null;
if ( ! is_array( $finding_groups ) || empty( $finding_groups['groups'] ) ) {
	throw new RuntimeException( 'ITERATOR_FINDING_GROUPS_JSON must provide grouped findings JSON.' );
}

if ( ! class_exists( 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder' ) ) {
	class WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder {
		private static array $tool_results = array();

		public static function handle_ability_tool_call( array $parameters, array $tool_def = array() ): array {
			$ability_name = (string) ( $tool_def['ability'] ?? '' );
			$tool_name    = (string) ( $tool_def['tool_name'] ?? $ability_name );
			if ( '' === $ability_name || ! function_exists( 'wp_get_ability' ) ) {
				return self::error( $tool_name, 'Missing ability contract.' );
			}

			$ability = wp_get_ability( $ability_name );
			if ( ! $ability ) {
				return self::error( $tool_name, $ability_name . ' is not registered.' );
			}

			$result = $ability->execute( $parameters );
			if ( function_exists( 'is_wp_error' ) && is_wp_error( $result ) ) {
				$response = self::error( $tool_name, $result->get_error_message() );
				self::record( $parameters, $tool_name, $response );
				return $response;
			}

			$response              = is_array( $result ) ? $result : array( 'success' => true, 'data' => $result );
			$response['tool_name'] = $tool_name;
			self::record( $parameters, $tool_name, $response );
			return $response;
		}

		public static function handle_pull_request_tool_call( array $parameters, array $tool_def = array() ): array {
			$response = self::handle_ability_tool_call(
				$parameters,
				$tool_def + array(
					'ability'   => 'datamachine-code/create-github-pull-request',
					'tool_name' => 'create_github_pull_request',
				)
			);
			if ( ! empty( $response['success'] ) ) {
				self::record_iterator_event( $parameters, 'upstream_action', 'pull_request', self::first_url( $response ), $response );
			}
			return $response;
		}

		public static function handle_issue_tool_call( array $parameters, array $tool_def = array() ): array {
			$response = self::handle_ability_tool_call(
				$parameters,
				$tool_def + array(
					'ability'   => 'datamachine-code/create-github-issue',
					'tool_name' => 'create_github_issue',
				)
			);
			if ( ! empty( $response['success'] ) ) {
				self::record_iterator_event( $parameters, 'upstream_action', 'issue', self::first_url( $response ), $response );
			}
			return $response;
		}

		public static function handle_comment_tool_call( array $parameters, array $tool_def = array() ): array {
			if ( self::is_source_pull_request( $parameters ) ) {
				$parameters = self::prepare_source_callback_parameters( $parameters );
				$response   = self::handle_ability_tool_call(
					$parameters,
					$tool_def + array(
						'ability'   => 'datamachine-code/upsert-github-pull-review-comment',
						'tool_name' => 'comment_github_pull_request',
					)
				);
				if ( ! empty( $response['success'] ) ) {
					self::record_iterator_event( $parameters, 'source_callback', 'pull_request_comment', self::first_url( $response ), $response );
				}
				return $response;
			}

			$response = self::handle_ability_tool_call(
				$parameters,
				$tool_def + array(
					'ability'   => 'datamachine-code/comment-github-pull-request',
					'tool_name' => 'comment_github_pull_request',
				)
			);
			return $response;
		}

		private static function prepare_source_callback_parameters( array $parameters ): array {
			$body   = (string) ( $parameters['body'] ?? '' );
			$marker = trim( (string) ( $parameters['marker'] ?? '' ) );

			if ( '' === $marker ) {
				$marker = self::extract_iterator_marker( $body );
			}
			if ( '' === $marker ) {
				$marker = self::build_iterator_marker( $parameters );
			}

			$parameters['marker'] = $marker;
			$parameters['mode']   = 'update_existing';
			if ( '' !== $body ) {
				$parameters['body'] = self::strip_iterator_marker( $body, $marker );
			}

			return $parameters;
		}

		private static function error( string $tool_name, string $message ): array {
			return array(
				'success'   => false,
				'error'     => $message,
				'tool_name' => $tool_name,
			);
		}

		private static function record( array $parameters, string $tool_name, array $response ): void {
			self::$tool_results[] = array(
				'tool_name' => $tool_name,
				'success'   => ! empty( $response['success'] ),
				'repo'       => (string) ( $parameters['repo'] ?? '' ),
				'url'       => self::first_url( $response ),
				'error'     => (string) ( $response['error'] ?? '' ),
				'message'   => (string) ( $response['message'] ?? '' ),
			);

			$job_id = (int) ( $parameters['job_id'] ?? 0 );
			if ( $job_id > 0 && function_exists( 'datamachine_merge_engine_data' ) ) {
				datamachine_merge_engine_data(
					$job_id,
					array(
						'php_transformer_iterator' => array(
							'tool_results' => self::$tool_results,
						),
					)
				);
			}
		}

		private static function record_iterator_event( array $parameters, string $key, string $type, string $url, array $response ): void {
			$job_id = (int) ( $parameters['job_id'] ?? 0 );
			if ( $job_id <= 0 || '' === $url || ! function_exists( 'datamachine_merge_engine_data' ) ) {
				return;
			}

			datamachine_merge_engine_data(
				$job_id,
				array(
					'php_transformer_iterator' => array(
						$key => array(
							'type'   => $type,
							'url'    => $url,
							'repo'   => (string) ( $parameters['repo'] ?? '' ),
							'number' => (int) ( $response['pull_number'] ?? $response['issue_number'] ?? $parameters['pull_number'] ?? 0 ),
						),
					),
				)
			);
		}

		private static function is_source_pull_request( array $parameters ): bool {
			$source_repo = trim( (string) getenv( 'ITERATOR_SOURCE_REPO' ) );
			$source_pr   = (int) getenv( 'ITERATOR_SOURCE_PR' );
			$repo        = trim( (string) ( $parameters['repo'] ?? '' ) );
			$pull_number = (int) ( $parameters['pull_number'] ?? 0 );

			return '' !== $source_repo && $source_pr > 0 && $repo === $source_repo && $pull_number === $source_pr;
		}

		private static function extract_iterator_marker( string $body ): string {
			if ( preg_match_all( '/<!--\s*(php-transformer-iterator[^>]*)\s*-->/', $body, $matches ) ) {
				$markers = array_values( array_filter( array_map( 'trim', $matches[1] ) ) );
				return (string) end( $markers );
			}

			return '';
		}

		private static function build_iterator_marker( array $parameters ): string {
			$parts = array(
				'php-transformer-iterator-agent',
				'validation-' . trim( (string) getenv( 'ITERATOR_VALIDATION_RUN_ID' ) ),
			);

			$job_id = (int) ( $parameters['job_id'] ?? 0 );
			if ( $job_id > 0 && function_exists( 'datamachine_get_engine_data' ) ) {
				$engine_data = datamachine_get_engine_data( $job_id );
				$packet      = is_array( $engine_data['finding_packet'] ?? null ) ? $engine_data['finding_packet'] : array();
				foreach ( array( 'site', 'kind', 'path', 'selector' ) as $key ) {
					$value = trim( (string) ( $packet[ $key ] ?? '' ) );
					if ( '' !== $value ) {
						$parts[] = $value;
					}
				}
			}

			return self::sanitize_marker( implode( ':', array_filter( $parts ) ) );
		}

		private static function strip_iterator_marker( string $body, string $marker ): string {
			$quoted = preg_quote( $marker, '/' );
			$body   = preg_replace( '/\n{0,2}<!--\s*' . $quoted . '\s*-->\s*$/', '', $body );
			return rtrim( is_string( $body ) ? $body : '' );
		}

		private static function sanitize_marker( string $marker ): string {
			$marker = strtolower( $marker );
			$marker = preg_replace( '/[^a-z0-9:_\/.#-]+/', '-', $marker );
			$marker = str_replace( '--', '-', is_string( $marker ) ? $marker : '' );
			return trim( $marker, '-:' );
		}

		private static function first_url( mixed $value ): string {
			if ( is_string( $value ) ) {
				return preg_match( '#https://github\.com/[^\s)]+#', $value, $matches ) ? $matches[0] : '';
			}
			if ( ! is_array( $value ) ) {
				return '';
			}
			foreach ( array( 'html_url', 'issue_url', 'url' ) as $key ) {
				if ( ! empty( $value[ $key ] ) && is_string( $value[ $key ] ) && str_starts_with( $value[ $key ], 'https://github.com/' ) ) {
					return $value[ $key ];
				}
			}
			foreach ( $value as $child ) {
				$url = self::first_url( $child );
				if ( '' !== $url ) {
					return $url;
				}
			}
			return '';
		}
	}
}

if ( ! function_exists( 'wp_site_generator_iterator_ability_schema' ) ) {
	function wp_site_generator_iterator_ability_schema( string $ability_name ): array {
		$ability = function_exists( 'wp_get_ability' ) ? wp_get_ability( $ability_name ) : null;
		if ( $ability && method_exists( $ability, 'get_input_schema' ) ) {
			$schema = (array) $ability->get_input_schema();
			if ( ! empty( $schema['properties'] ) && is_array( $schema['properties'] ) ) {
				return $schema;
			}
		}

		return array(
			'type'       => 'object',
			'properties' => array(),
		);
	}
}

add_filter(
	'datamachine_resolved_tools',
	static function ( array $tools ): array {
		$workspace_tools = array(
			'workspace_clone'        => 'datamachine-code/workspace-clone',
			'workspace_worktree_add' => 'datamachine-code/workspace-worktree-add',
			'workspace_read'         => 'datamachine-code/workspace-read',
			'workspace_write'        => 'datamachine-code/workspace-write',
			'workspace_edit'         => 'datamachine-code/workspace-edit',
			'workspace_git_status'   => 'datamachine-code/workspace-git-status',
			'workspace_git_commit'   => 'datamachine-code/workspace-git-commit',
			'workspace_git_push'     => 'datamachine-code/workspace-git-push',
		);

		foreach ( $workspace_tools as $tool_name => $ability_name ) {
			$tools[ $tool_name ] = array(
				'class'       => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
				'method'      => 'handle_ability_tool_call',
				'ability'     => $ability_name,
				'tool_name'   => $tool_name,
				'description' => 'Execute ' . $ability_name . ' for the PR-first PHP transformer iterator.',
				'parameters'  => wp_site_generator_iterator_ability_schema( $ability_name ),
			);
		}

		$tools['create_github_pull_request'] = array(
			'class'       => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
			'method'      => 'handle_pull_request_tool_call',
			'ability'     => 'datamachine-code/create-github-pull-request',
			'tool_name'   => 'create_github_pull_request',
			'description' => 'Open the focused upstream transformer repair pull request after pushing the worktree branch.',
			'parameters'  => wp_site_generator_iterator_ability_schema( 'datamachine-code/create-github-pull-request' ),
		);
		$tools['create_github_issue']        = array(
			'class'       => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
			'method'      => 'handle_issue_tool_call',
			'ability'     => 'datamachine-code/create-github-issue',
			'tool_name'   => 'create_github_issue',
			'description' => 'Fallback only: open a focused issue when no safe upstream patch path exists.',
			'parameters'  => wp_site_generator_iterator_ability_schema( 'datamachine-code/create-github-issue' ),
		);
		$tools['comment_github_pull_request'] = array(
			'class'       => 'WC_Site_Generator_PHP_Transformer_Iterator_Tool_Recorder',
			'method'      => 'handle_comment_tool_call',
			'ability'     => 'datamachine-code/comment-github-pull-request',
			'tool_name'   => 'comment_github_pull_request',
			'description' => 'Post the required callback comment on the source generated-site pull request.',
			'parameters'  => wp_site_generator_iterator_ability_schema( 'datamachine-code/comment-github-pull-request' ),
		);

		return $tools;
	},
	100,
	1
);

update_option( 'datamachine_persist_pipeline_transcripts', true, false );

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
