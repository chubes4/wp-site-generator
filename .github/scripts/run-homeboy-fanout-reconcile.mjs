#!/usr/bin/env node

import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseArgs } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const configPath = args.get('--config') || process.env.FANOUT_CONFIG_PATH;
const outputPath = args.get('--output') || process.env.FANOUT_PLAN_PATH || '.ci/finding-packets/php-transformer-iterator-fanout-plan.json';

if (!configPath) {
	throw new Error('Fanout reconcile config path is required. Pass --config or FANOUT_CONFIG_PATH.');
}

const stableCommand = process.env.HOMEBOY_FANOUT_RECONCILE_COMMAND || '';
if (stableCommand) {
	run(stableCommand, [configPath, outputPath]);
	process.exit(0);
}

const adapterPath = await resolveHomeboyExtensionsAdapter();
if (!adapterPath) {
	throw new Error([
		'Homeboy fanout reconcile is required but no stable HOMEBOY_FANOUT_RECONCILE_COMMAND or Homeboy Extensions adapter was found.',
		'Set HOMEBOY_FANOUT_RECONCILE_COMMAND when Homeboy exposes a public primitive, or provide HOMEBOY_EXTENSIONS_PATH containing wordpress/scripts/agent/homeboy-generic-fanout-reconcile.cjs.',
	].join(' '));
}

run(process.execPath, [adapterPath, configPath, outputPath]);

async function resolveHomeboyExtensionsAdapter() {
	const candidates = [
		process.env.HOMEBOY_EXTENSIONS_FANOUT_RECONCILE_SCRIPT,
		process.env.HOMEBOY_EXTENSIONS_PATH ? path.join(process.env.HOMEBOY_EXTENSIONS_PATH, 'wordpress/scripts/agent/homeboy-generic-fanout-reconcile.cjs') : '',
		path.join(process.cwd(), '.ci/homeboy-extensions/wordpress/scripts/agent/homeboy-generic-fanout-reconcile.cjs'),
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	return '';
}

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: command.includes(' ') });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`Fanout reconcile failed with exit code ${result.status}.`);
	}
}
