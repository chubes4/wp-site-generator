<?php
/**
 * Smoke test for WPSG packet materializer ability lifecycle registration.
 *
 * Run with: php tests/scripts/packet-materializer-ability-lifecycle-smoke.php
 */

define( 'ABSPATH', sys_get_temp_dir() . '/wpsg-ability-lifecycle/' );

$GLOBALS['wpsg_lifecycle_test'] = (object) array(
	'actions'                 => array(),
	'filters'                 => array(),
	'doing'                   => array(),
	'did'                     => array(),
	'abilities'               => array(),
	'invalid_register_calls'  => 0,
	'valid_register_calls'    => 0,
);

class WP_Abilities_Registry {
	private static ?WP_Abilities_Registry $instance = null;

	public static function get_instance(): WP_Abilities_Registry {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function is_registered( string $name ): bool {
		return isset( $GLOBALS['wpsg_lifecycle_test']->abilities[ $name ] );
	}

	public function get_registered( string $name ) {
		return $GLOBALS['wpsg_lifecycle_test']->abilities[ $name ] ?? null;
	}
}

function add_action( string $hook, callable $callback ): void {
	$GLOBALS['wpsg_lifecycle_test']->actions[ $hook ][] = $callback;
}

function add_filter( string $hook, callable $callback ): void {
	$GLOBALS['wpsg_lifecycle_test']->filters[ $hook ][] = $callback;
}

function apply_filters( string $hook, $value ) {
	foreach ( $GLOBALS['wpsg_lifecycle_test']->filters[ $hook ] ?? array() as $callback ) {
		$value = $callback( $value );
	}

	return $value;
}

function do_action( string $hook ): void {
	$GLOBALS['wpsg_lifecycle_test']->doing[ $hook ] = true;
	$GLOBALS['wpsg_lifecycle_test']->did[ $hook ]   = ( $GLOBALS['wpsg_lifecycle_test']->did[ $hook ] ?? 0 ) + 1;

	foreach ( $GLOBALS['wpsg_lifecycle_test']->actions[ $hook ] ?? array() as $callback ) {
		$callback();
	}

	$GLOBALS['wpsg_lifecycle_test']->doing[ $hook ] = false;
}

function doing_action( string $hook = '' ): bool {
	return ! empty( $GLOBALS['wpsg_lifecycle_test']->doing[ $hook ] );
}

function did_action( string $hook = '' ): int {
	return (int) ( $GLOBALS['wpsg_lifecycle_test']->did[ $hook ] ?? 0 );
}

function wp_register_ability( string $name, array $args ) {
	if ( ! doing_action( 'wp_abilities_api_init' ) ) {
		++$GLOBALS['wpsg_lifecycle_test']->invalid_register_calls;
		return null;
	}

	++$GLOBALS['wpsg_lifecycle_test']->valid_register_calls;
	$GLOBALS['wpsg_lifecycle_test']->abilities[ $name ] = new WPSG_Lifecycle_Test_Ability(
		$args['label'] ?? $name,
		$args['description'] ?? '',
		$args['input_schema'] ?? array()
	);

	return $GLOBALS['wpsg_lifecycle_test']->abilities[ $name ];
}

function __return_true(): bool {
	return true;
}

function assert_wpsg_lifecycle( string $label, bool $condition ): void {
	if ( ! $condition ) {
		fwrite( STDERR, "FAIL: {$label}\n" );
		exit( 1 );
	}

	echo "ok - {$label}\n";
}

class WPSG_Lifecycle_Test_Ability {
	private string $label;
	private string $description;
	private array $input_schema;

	public function __construct( string $label, string $description, array $input_schema ) {
		$this->label        = $label;
		$this->description  = $description;
		$this->input_schema = $input_schema;
	}

	public function get_label(): string {
		return $this->label;
	}

	public function get_description(): string {
		return $this->description;
	}

	public function get_input_schema(): array {
		return $this->input_schema;
	}
}

function wpsg_lifecycle_resolve_ability_tools( array $modes ): array {
	$registry = WP_Abilities_Registry::get_instance();
	$tools    = array();

	foreach ( apply_filters( 'datamachine_ability_tool_projections', array() ) as $tool_name => $declaration ) {
		$ability_slug = is_array( $declaration ) && is_string( $declaration['ability'] ?? null ) ? $declaration['ability'] : '';
		if ( '' === $ability_slug || ! $registry->is_registered( $ability_slug ) ) {
			continue;
		}

		$tool_modes = is_array( $declaration['modes'] ?? null ) ? $declaration['modes'] : array( 'chat' );
		if ( empty( array_intersect( $tool_modes, $modes ) ) ) {
			continue;
		}

		$ability            = $registry->get_registered( $ability_slug );
		$tools[ $tool_name ] = array_merge(
			array(
				'ability'           => $ability_slug,
				'execution_ability' => $ability_slug,
				'label'             => $ability->get_label(),
				'description'       => $ability->get_description(),
				'parameters'        => $ability->get_input_schema(),
			),
			$declaration
		);
	}

	return $tools;
}

require dirname( __DIR__, 2 ) . '/wp-site-generator.php';

assert_wpsg_lifecycle(
	'plugin hooks packet materializer ability to wp_abilities_api_init',
	isset( $GLOBALS['wpsg_lifecycle_test']->actions['wp_abilities_api_init'] )
);
assert_wpsg_lifecycle(
	'plugin registers packet materializer projection filter before Data Machine helper exists',
	isset( $GLOBALS['wpsg_lifecycle_test']->filters['datamachine_ability_tool_projections'] )
);

wpsg_register_packet_materializer_ability();

assert_wpsg_lifecycle(
	'early direct call outside wp_abilities_api_init does not call wp_register_ability',
	0 === $GLOBALS['wpsg_lifecycle_test']->invalid_register_calls
);
assert_wpsg_lifecycle(
	'early direct call does not mark the packet materializer registered',
	empty( $GLOBALS['wpsg_lifecycle_test']->abilities )
);
do_action( 'init' );

$early_tools = apply_filters( 'datamachine_ability_tool_projections', array() );
assert_wpsg_lifecycle(
	'init before wp_abilities_api_init keeps Data Machine projection available',
	isset( $early_tools['wpsg_materialize_packet'] )
		&& 'wp-site-generator/materialize-packet' === $early_tools['wpsg_materialize_packet']['ability']
);

do_action( 'wp_abilities_api_init' );

assert_wpsg_lifecycle(
	'valid lifecycle call registers the WPSG packet materializer ability after the early call',
	isset( $GLOBALS['wpsg_lifecycle_test']->abilities['wp-site-generator/materialize-packet'] )
);
assert_wpsg_lifecycle(
	'valid lifecycle registration calls wp_register_ability exactly once',
	1 === $GLOBALS['wpsg_lifecycle_test']->valid_register_calls
);

$tools = apply_filters( 'datamachine_ability_tool_projections', array() );
assert_wpsg_lifecycle(
	'Data Machine projection exposes wpsg_materialize_packet in pipeline mode',
	isset( $tools['wpsg_materialize_packet'] )
		&& 'wp-site-generator/materialize-packet' === $tools['wpsg_materialize_packet']['ability']
		&& array( 'pipeline' ) === $tools['wpsg_materialize_packet']['modes']
);

$resolved_tools = wpsg_lifecycle_resolve_ability_tools( array( 'pipeline' ) );
assert_wpsg_lifecycle(
	'AbilityToolSource resolution can expose wpsg_materialize_packet after ability registration',
	isset( $resolved_tools['wpsg_materialize_packet'] )
		&& 'wp-site-generator/materialize-packet' === $resolved_tools['wpsg_materialize_packet']['execution_ability']
		&& isset( $resolved_tools['wpsg_materialize_packet']['parameters']['properties']['packet_type'] )
);

echo "WPSG packet materializer ability lifecycle smoke passed.\n";
