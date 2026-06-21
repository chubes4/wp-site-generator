export const wordpressRuntimeApi = Object.freeze({
	blueprintSchema: 'https://playground.wordpress.net/blueprint-schema.json',
	paths: Object.freeze({
		wpLoadPhp: '/wordpress/wp-load.php',
	}),
	settingsDescriptor: Object.freeze({
		schema: 'wpsg/wordpress-runtime-settings-descriptor/v1',
		id: 'ssi-validation-wordpress-runtime',
		settings_fields: Object.freeze({
			blueprint: 'wordpress_runtime_blueprint',
			workloads: 'wordpress_runtime_workloads',
		}),
	}),
	workloadRunTypes: Object.freeze({
		php: 'php',
	}),
	abilities: Object.freeze({
		importTheme: 'static-site-importer/import-theme',
		importWebsiteArtifact: 'static-site-importer/import-website-artifact',
	}),
});

export function wordpressRuntimeBlueprintSchema() {
	return wordpressRuntimeApi.blueprintSchema;
}

export function wordpressRuntimeSettingsDescriptor() {
	return wordpressRuntimeApi.settingsDescriptor;
}

export function wordpressRuntimeSettingsFields(descriptor = wordpressRuntimeSettingsDescriptor()) {
	return descriptor.settings_fields;
}

export function wordpressRuntimePhpStep(code) {
	return {
		type: wordpressRuntimeApi.workloadRunTypes.php,
		code,
	};
}

export function wordpressRuntimePhpFileStep(file) {
	return {
		type: wordpressRuntimeApi.workloadRunTypes.php,
		file,
	};
}

export function wordpressRuntimeRequireWpLoadPhp() {
	return `require_once '${wordpressRuntimeApi.paths.wpLoadPhp}';`;
}

export function wordpressRuntimeAbilityId(name) {
	const ability = wordpressRuntimeApi.abilities[name];
	if (!ability) {
		throw new Error(`Unknown WordPress runtime ability: ${name}`);
	}
	return ability;
}
