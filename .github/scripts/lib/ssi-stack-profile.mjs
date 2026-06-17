import { buildSsiStackManifest, gitDirectoryResource } from './ssi-stack-manifest.mjs';

export const ssiStackProfile = {
	blueprintSchema: 'https://playground.wordpress.net/blueprint-schema.json',
	preferredVersions: { php: '8.3', wp: 'latest' },
	manifest: buildSsiStackManifest(),
	components: [
		{
			type: 'git:directory',
			manifestId: 'block_artifact_compiler',
			targetFolderName: 'block-artifact-compiler',
		},
		{
			type: 'git:directory',
			manifestId: 'block_format_bridge',
			targetFolderName: 'block-format-bridge',
		},
		{
			type: 'git:directory',
			manifestId: 'static_site_importer',
			targetFolderName: 'static-site-importer',
		},
	],
	commerceComponents: [
		{
			type: 'wordpress.org/plugins',
			slug: 'woocommerce',
			targetFolderName: 'woocommerce',
		},
	],
};

export function buildSsiStackInstallSteps(profile = ssiStackProfile, { lane = '' } = {}) {
	return getSsiStackComponents(profile, lane).map((component) => buildPluginInstallStep(component, profile.manifest));
}

export function buildSsiStackProfile(manifest = buildSsiStackManifest()) {
	return { ...ssiStackProfile, manifest };
}

export function buildSsiStackBlueprint({ steps = [], landingPage, lane = '' } = {}, profile = ssiStackProfile) {
	const blueprint = {
		$schema: profile.blueprintSchema,
	};

	if (landingPage) {
		blueprint.landingPage = landingPage;
	}

	blueprint.preferredVersions = profile.preferredVersions;
	blueprint.steps = [...buildSsiStackInstallSteps(profile, { lane }), ...steps];

	return blueprint;
}

export function getSsiStackComponents(profile = ssiStackProfile, lane = '') {
	return requiresCommerceStack(lane) ? [...profile.commerceComponents, ...profile.components] : [...profile.components];
}

export function requiresCommerceStack(lane = '') {
	const normalized = String(lane).toLowerCase().replace(/^target:/, '');
	return normalized === 'woocommerce' || normalized === 'commerce' || normalized === 'store';
}

export function buildSsiImportWorkload(siteSlug, { htmlPath = '' } = {}) {
	const sourceHtmlPath = htmlPath || `/wordpress/wp-content/plugins/wp-site-generator/static-sites/${siteSlug}/index.html`;
	return {
		id: 'ssi-import',
		label: `Static Site Importer: ${siteSlug}`,
		run: [
			{
				type: 'php',
				code: buildSsiImportAbilityPhp({
					htmlPath: sourceHtmlPath,
					siteSlug,
					includeOpeningTag: false,
				}),
			},
			{
				type: 'php',
				file: '.github/homeboy/ssi-import-diagnostics.php',
			},
		],
		artifacts: {
			import_report: {
				path: `wp-content/themes/${siteSlug}/import-report.json`,
				kind: 'json',
				label: 'Static Site Importer report',
			},
		},
	};
}

export function buildSsiImportAbilityPhp({ htmlPath, siteSlug, markerPath, assertActiveTheme = false, trailingNewline = false, includeOpeningTag = true }) {
	const lines = [
		"require_once '/wordpress/wp-load.php';",
		'wp_set_current_user( 1 );',
		"if ( ! function_exists( 'wp_get_ability' ) ) {",
		"\tthrow new RuntimeException( 'WordPress Abilities API is not available.' );",
		'}',
		"$ability = wp_get_ability( 'static-site-importer/import-theme' );",
		'if ( ! $ability ) {',
		"\tthrow new RuntimeException( 'Static Site Importer import ability is not registered.' );",
		'}',
		'$ability_result = $ability->execute( array(',
		`\t'html_path' => ${phpString(htmlPath)},`,
		`\t'slug' => ${phpString(siteSlug)},`,
		"\t'activate' => true,",
		"\t'overwrite' => true,",
		"\t'keep_source' => true,",
		') );',
		'if ( is_wp_error( $ability_result ) ) {',
		"\tthrow new RuntimeException( $ability_result->get_error_message() );",
		'}',
		"if ( empty( $ability_result['success'] ) ) {",
		"\t$error = isset( $ability_result['error'] ) && is_array( $ability_result['error'] ) ? $ability_result['error'] : array();",
		"\tthrow new RuntimeException( isset( $error['message'] ) ? (string) $error['message'] : 'Static site import failed.' );",
		'}',
	];

	if (assertActiveTheme || markerPath) {
		lines.push('$theme = wp_get_theme();');
	}

	if (assertActiveTheme) {
		lines.push(
			`if ( $theme->get_stylesheet() !== ${phpString(siteSlug)} ) {`,
			`\tthrow new RuntimeException( 'Expected active theme ${siteSlug}, got ' . $theme->get_stylesheet() );`,
			'}'
		);
	}

	if (markerPath) {
		lines.push(
			'$payload = array(',
			`\t'site' => ${phpString(siteSlug)},`,
			"\t'theme' => $theme->get_stylesheet(),",
			"\t'theme_name' => $theme->get( 'Name' ),",
			"\t'active_plugins' => get_option( 'active_plugins' ),",
			"\t'woocommerce_loaded' => class_exists( 'WooCommerce' ),",
			"\t'import_result' => isset( $ability_result['result'] ) ? $ability_result['result'] : null,",
			"\t'time' => time(),",
			');',
			`file_put_contents( ${phpString(markerPath)}, wp_json_encode( $payload ) );`
		);
	}

	const php = includeOpeningTag ? ['<?php', ...lines] : lines;
	return `${php.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function buildPluginInstallStep(component, manifest = ssiStackProfile.manifest) {
	const pluginData = component.type === 'wordpress.org/plugins'
		? { resource: component.type, slug: component.slug }
		: gitDirectoryResource(manifest, component.manifestId);

	return {
		step: 'installPlugin',
		pluginData,
		options: {
			activate: true,
			targetFolderName: component.targetFolderName,
		},
	};
}

function phpString(value) {
	return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
