<?php
/**
 * Plugin Name: WP Site Generator CI Fixture
 * Description: CI-only plugin header so Homeboy/WP Codebox can mount generated static-site fixtures as a WordPress component.
 * Version: 0.0.0
 */

defined( 'ABSPATH' ) || exit;

add_action( 'wp_abilities_api_init', 'wpsg_register_packet_materializer_ability' );
add_action( 'init', 'wpsg_register_packet_materializer_tool' );

if ( function_exists( 'doing_action' ) && doing_action( 'wp_abilities_api_init' ) ) {
	wpsg_register_packet_materializer_ability();
}

if ( ( function_exists( 'doing_action' ) && doing_action( 'init' ) ) || ( function_exists( 'did_action' ) && did_action( 'init' ) ) ) {
	wpsg_register_packet_materializer_tool();
}

function wpsg_register_packet_materializer_ability(): void {
	static $registered = false;

	if ( $registered && wpsg_packet_materializer_ability_is_registered() ) {
		return;
	}

	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	if ( ! function_exists( 'doing_action' ) || ! doing_action( 'wp_abilities_api_init' ) ) {
		return;
	}

	wp_register_ability(
		'wp-site-generator/materialize-packet',
		array(
			'label'               => 'Materialize site-generation packet',
			'description'         => 'Normalizes model-provided site-generation packet fields into WPSG packet contracts.',
			'input_schema'        => wpsg_packet_materializer_schema(),
			'output_schema'       => array( 'type' => 'object' ),
			'execute_callback'    => 'wpsg_materialize_packet',
			'permission_callback' => '__return_true',
			'show_in_rest'        => false,
			'readonly'            => true,
		)
	);

	$registered = wpsg_packet_materializer_ability_is_registered();
}

function wpsg_packet_materializer_ability_is_registered(): bool {
	if ( class_exists( 'WP_Abilities_Registry' ) && method_exists( 'WP_Abilities_Registry', 'get_instance' ) ) {
		$registry = WP_Abilities_Registry::get_instance();
		if ( is_object( $registry ) && method_exists( $registry, 'is_registered' ) ) {
			return (bool) $registry->is_registered( 'wp-site-generator/materialize-packet' );
		}

		if ( is_object( $registry ) && method_exists( $registry, 'get_registered' ) ) {
			return is_object( $registry->get_registered( 'wp-site-generator/materialize-packet' ) );
		}
	}

	if ( function_exists( 'wp_get_ability' ) ) {
		$ability = wp_get_ability( 'wp-site-generator/materialize-packet' );
		return null !== $ability && false !== $ability;
	}

	return false;
}

function wpsg_register_packet_materializer_tool(): void {
	static $registered = false;

	if ( $registered ) {
		return;
	}

	if ( ! function_exists( 'datamachine_register_ability_tool' ) ) {
		return;
	}

	$registered = datamachine_register_ability_tool(
		'wpsg_materialize_packet',
		array(
			'ability'     => 'wp-site-generator/materialize-packet',
			'modes'       => array( 'pipeline' ),
			'description' => 'Record the generated WPSG ConceptPacket, DesignPacket, or StaticSiteCandidate. Use exactly once when the packet content is ready.',
			'parameters'  => wpsg_packet_materializer_schema(),
		)
	);
}

function wpsg_packet_materializer_schema(): array {
	return array(
		'type'       => 'object',
		'properties' => array(
			'packet_type'        => array(
				'type' => 'string',
				'enum' => array( 'concept_packet', 'design_packet', 'static_site_candidate' ),
			),
			'concept_kind'       => array( 'type' => 'string' ),
			'title'              => array( 'type' => 'string' ),
			'body_sections'      => array( 'type' => 'object' ),
			'labels'             => array(
				'type'  => 'array',
				'items' => array( 'type' => 'string' ),
			),
			'target_lane'        => array( 'type' => 'string' ),
			'provenance'         => array( 'type' => 'object' ),
			'source_concept_ref' => array( 'type' => 'object' ),
			'source_title'       => array( 'type' => 'string' ),
			'design_system'      => array( 'type' => 'string' ),
			'palette_kind'       => array( 'type' => 'string' ),
			'palette'            => array( 'type' => 'object' ),
			'typography_kind'    => array( 'type' => 'string' ),
			'typography'         => array( 'type' => 'object' ),
			'layout_direction'   => array( 'type' => 'string' ),
			'mood'               => array( 'type' => 'string' ),
			'accessibility_notes'        => array( 'type' => 'string' ),
			'implementation_constraints' => array( 'type' => 'string' ),
			'files'                      => array( 'type' => 'object' ),
			'metadata'                   => array( 'type' => 'object' ),
			'branch_title'               => array( 'type' => 'string' ),
			'reproduction_context'       => array( 'type' => 'object' ),
		),
		'required'   => array( 'packet_type', 'title' ),
	);
}

function wpsg_materialize_packet( array $input ): array {
	$type = sanitize_key( (string) ( $input['packet_type'] ?? '' ) );
	if ( ! in_array( $type, array( 'concept_packet', 'design_packet', 'static_site_candidate' ), true ) ) {
		return array(
			'success' => false,
			'error'   => 'Unsupported packet_type.',
		);
	}

	$title = trim( (string) ( $input['title'] ?? $input['source_title'] ?? '' ) );
	if ( '' === $title ) {
		return array(
			'success' => false,
			'error'   => 'Packet title is required.',
		);
	}

	$packet = array_filter(
		array(
			'schema_version'             => '1',
			'packet_type'                => $type,
			'concept_kind'               => sanitize_key( (string) ( $input['concept_kind'] ?? '' ) ),
			'title'                      => $title,
			'body_sections'              => wpsg_packet_object( $input['body_sections'] ?? array() ),
			'labels'                     => wpsg_packet_string_list( $input['labels'] ?? array() ),
			'target_lane'                => sanitize_text_field( (string) ( $input['target_lane'] ?? '' ) ),
			'provenance'                 => wpsg_packet_object( $input['provenance'] ?? array() ),
			'source_concept_ref'         => wpsg_packet_object( $input['source_concept_ref'] ?? array() ),
			'source_title'               => sanitize_text_field( (string) ( $input['source_title'] ?? '' ) ),
			'design_system'              => sanitize_text_field( (string) ( $input['design_system'] ?? '' ) ),
			'palette_kind'               => sanitize_text_field( (string) ( $input['palette_kind'] ?? '' ) ),
			'palette'                    => wpsg_packet_object( $input['palette'] ?? array() ),
			'typography_kind'            => sanitize_text_field( (string) ( $input['typography_kind'] ?? '' ) ),
			'typography'                 => wpsg_packet_object( $input['typography'] ?? array() ),
			'layout_direction'           => sanitize_text_field( (string) ( $input['layout_direction'] ?? '' ) ),
			'mood'                       => sanitize_text_field( (string) ( $input['mood'] ?? '' ) ),
			'accessibility_notes'        => sanitize_textarea_field( (string) ( $input['accessibility_notes'] ?? '' ) ),
			'implementation_constraints' => sanitize_textarea_field( (string) ( $input['implementation_constraints'] ?? '' ) ),
			'files'                      => wpsg_packet_object( $input['files'] ?? array() ),
			'metadata'                   => wpsg_packet_object( $input['metadata'] ?? array() ),
			'branch_title'               => sanitize_text_field( (string) ( $input['branch_title'] ?? '' ) ),
			'reproduction_context'       => wpsg_packet_object( $input['reproduction_context'] ?? array() ),
		),
		static fn( $value ): bool => '' !== $value && array() !== $value && null !== $value
	);

	return array(
		'success'   => true,
		'tool_name' => 'wpsg_materialize_packet',
		'data'      => array(
			$type => $packet,
		),
	);
}

function wpsg_packet_object( $value ): array {
	return is_array( $value ) ? $value : array();
}

function wpsg_packet_string_list( $value ): array {
	if ( ! is_array( $value ) ) {
		return array();
	}

	return array_values(
		array_filter(
			array_map( static fn( $item ): string => sanitize_text_field( (string) $item ), $value ),
			static fn( string $item ): bool => '' !== $item
		)
	);
}
