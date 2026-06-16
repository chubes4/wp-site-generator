<?php
/**
 * Smoke test for WPSG packet materializer ability lifecycle registration.
 *
 * Run with: php tests/scripts/packet-materializer-ability-lifecycle-smoke.php
 */

define( 'ABSPATH', sys_get_temp_dir() . '/wpsg-ability-lifecycle/' );

$GLOBALS['wpsg_lifecycle_test'] = (object) array(
	'actions'                 => array(),
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

require dirname( __DIR__, 2 ) . '/wp-site-generator.php';

assert_wpsg_lifecycle(
	'plugin hooks packet materializer ability to wp_abilities_api_init',
	isset( $GLOBALS['wpsg_lifecycle_test']->actions['wp_abilities_api_init'] )
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

assert_wpsg_lifecycle(
	'init before wp_abilities_api_init does not register the WPSG ability early',
	empty( $GLOBALS['wpsg_lifecycle_test']->abilities )
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
$registered_ability = $GLOBALS['wpsg_lifecycle_test']->abilities['wp-site-generator/materialize-packet'];
$input_schema       = $registered_ability->get_input_schema();
assert_wpsg_lifecycle(
	'WPSG ability exposes the packet materializer schema',
	isset( $input_schema['properties']['packet_type'] )
);

echo "WPSG packet materializer ability lifecycle smoke passed.\n";
