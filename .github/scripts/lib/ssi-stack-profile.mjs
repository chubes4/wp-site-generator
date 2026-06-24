import { buildSsiStackManifest, gitDirectoryResource } from './ssi-stack-manifest.mjs';
import {
	wordpressRuntimeAbilityId,
	wordpressRuntimeBlueprintSchema,
	wordpressRuntimePhpFileStep,
	wordpressRuntimePhpStep,
	wordpressRuntimeRequireWpLoadPhp,
} from './wordpress-runtime-api.mjs';

export const ssiStackProfile = {
	blueprintSchema: wordpressRuntimeBlueprintSchema(),
	preferredVersions: { php: '8.3', wp: 'latest' },
	manifest: buildSsiStackManifest(),
	components: [
		{
			type: 'git:directory',
			manifestId: 'blocks_engine_php_transformer',
			targetFolderName: 'blocks-engine-php-transformer',
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

export function buildSsiImportWorkload(siteSlug, { websiteArtifact = null } = {}) {
	return {
		id: 'ssi-import',
		label: `Static Site Importer: ${siteSlug}`,
		run: [
			wordpressRuntimePhpStep(buildBlocksEnginePhpTransformerProbePhp({ includeOpeningTag: false })),
			wordpressRuntimePhpStep(buildSsiImportWebsiteArtifactPhp({
				artifact: websiteArtifact,
				siteSlug,
				includeOpeningTag: false,
			})),
			wordpressRuntimePhpFileStep('.github/homeboy/ssi-import-diagnostics.php'),
		],
	};
}

export function buildBlocksEnginePhpTransformerProbePhp({ trailingNewline = false, includeOpeningTag = true } = {}) {
	const lines = [
		wordpressRuntimeRequireWpLoadPhp(),
		"$has_helper = function_exists( 'blocks_engine_php_transformer_compile_artifact' ) || function_exists( 'blocks_engine_php_transformer_transform_html' );",
		"$has_class = class_exists( 'Automattic\\\\BlocksEngine\\\\PhpTransformer\\\\ArtifactCompiler\\\\ArtifactCompiler' ) || class_exists( 'Automattic\\\\BlocksEngine\\\\PhpTransformer\\\\HtmlToBlocks\\\\HtmlTransformer' );",
		'if ( ! $has_helper && ! $has_class ) {',
		"\tthrow new RuntimeException( 'Blocks Engine PHP Transformer plugin/classes are not available.' );",
		'}',
	];

	const php = includeOpeningTag ? ['<?php', ...lines] : lines;
	return `${php.join('\n')}${trailingNewline ? '\n' : ''}`;
}

export function buildSsiImportWebsiteArtifactPhp({ artifact, siteSlug, markerPath, assertActiveTheme = false, trailingNewline = false, includeOpeningTag = true }) {
	if (!artifact || typeof artifact !== 'object') {
		throw new Error('websiteArtifact is required for SSI import validation.');
	}
	const artifactJson = Buffer.from(JSON.stringify(artifact)).toString('base64');
	const lines = [
		wordpressRuntimeRequireWpLoadPhp(),
		...blocksEnginePhpTransformerProbeLines('has_transformer'),
		'wp_set_current_user( 1 );',
		"if ( ! function_exists( 'wp_get_ability' ) ) {",
		"\tthrow new RuntimeException( 'WordPress Abilities API is not available.' );",
		'}',
		`$ability = wp_get_ability( ${phpString(wordpressRuntimeAbilityId('importWebsiteArtifact'))} );`,
		'if ( ! $ability ) {',
		"\tthrow new RuntimeException( 'Static Site Importer website artifact ability is not registered.' );",
		'}',
		`$artifact = json_decode( base64_decode( ${phpString(artifactJson)} ), true );`,
		'if ( ! is_array( $artifact ) ) {',
		"\tthrow new RuntimeException( 'Static Site Importer website artifact payload is invalid.' );",
		'}',
		'$ability_result = $ability->execute( array(',
		"\t'artifact' => $artifact,",
		`\t'slug' => ${phpString(siteSlug)},`,
		"\t'activate' => true,",
		"\t'overwrite' => true,",
		"\t'fail_on_quality' => true,",
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

export function buildSsiImportWebsiteArtifactFromDirectoryPhp({ sourceDirectory, siteSlug, markerPath, assertActiveTheme = false, trailingNewline = false, includeOpeningTag = true }) {
	const lines = [
		wordpressRuntimeRequireWpLoadPhp(),
		...blocksEnginePhpTransformerProbeLines('has_transformer'),
		'wp_set_current_user( 1 );',
		"if ( ! function_exists( 'wp_get_ability' ) ) {",
		"\tthrow new RuntimeException( 'WordPress Abilities API is not available.' );",
		'}',
		`$ability = wp_get_ability( ${phpString(wordpressRuntimeAbilityId('importWebsiteArtifact'))} );`,
		'if ( ! $ability ) {',
		"\tthrow new RuntimeException( 'Static Site Importer website artifact ability is not registered.' );",
		'}',
		`$source_directory = ${phpString(sourceDirectory)};`,
		"if ( ! is_dir( $source_directory ) || ! file_exists( $source_directory . '/index.html' ) ) {",
		"\tthrow new RuntimeException( 'Static site source directory must include index.html.' );",
		'}',
		'$files = array();',
		'$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $source_directory, FilesystemIterator::SKIP_DOTS ) );',
		'foreach ( $iterator as $file ) {',
		"\tif ( ! $file->isFile() ) {",
		'\t\tcontinue;',
		'\t}',
		"\t$relative_path = str_replace( DIRECTORY_SEPARATOR, '/', substr( $file->getPathname(), strlen( $source_directory ) + 1 ) );",
		"\t$files[] = array( 'path' => 'website/' . $relative_path, 'content' => file_get_contents( $file->getPathname() ) );",
		'}',
		'$artifact = array(',
		"\t'schema' => 'blocks-engine/php-transformer/site-artifact/v1',",
		"\t'files' => $files,",
		`\t'metadata' => array( 'source' => 'wp-site-generator/static-site-preview', 'site' => ${phpString(siteSlug)} ),`,
		');',
		'$ability_result = $ability->execute( array(',
		"\t'artifact' => $artifact,",
		`\t'slug' => ${phpString(siteSlug)},`,
		"\t'activate' => true,",
		"\t'overwrite' => true,",
		"\t'fail_on_quality' => true,",
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

function blocksEnginePhpTransformerProbeLines(prefix) {
	return [
		`$${prefix}_helper = function_exists( 'blocks_engine_php_transformer_compile_artifact' ) || function_exists( 'blocks_engine_php_transformer_transform_html' );`,
		`$${prefix}_class = class_exists( 'Automattic\\\\BlocksEngine\\\\PhpTransformer\\\\ArtifactCompiler\\\\ArtifactCompiler' ) || class_exists( 'Automattic\\\\BlocksEngine\\\\PhpTransformer\\\\HtmlToBlocks\\\\HtmlTransformer' );`,
		`if ( ! $${prefix}_helper && ! $${prefix}_class ) {`,
		"\tthrow new RuntimeException( 'Blocks Engine PHP Transformer plugin/classes are not available.' );",
		'}',
	];
}

function phpString(value) {
	return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
