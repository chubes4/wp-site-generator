import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validationSettings = await readFile('.github/scripts/build-static-validation-settings.mjs', 'utf8');

assert.match(
	validationSettings,
	/command: `static-site-importer import-theme \/wordpress\/wp-content\/plugins\/wp-site-generator\/static-sites\//,
	'static validation bench workload should pass the WP-CLI subcommand to WP_CLI::runcommand()'
);

assert.doesNotMatch(
	validationSettings,
	/command: `wp static-site-importer import-theme/,
	'static validation bench workload must not include the wp binary prefix'
);
