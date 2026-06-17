#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readJsonOrNull } from './lib/ci-runtime-utils.mjs';
import { evaluateStaticSitePublishGateContract } from './lib/ssi-metrics.mjs';

export function evaluateStaticSitePublishGate({ validation = {}, visualParity = {} } = {}) {
	return evaluateStaticSitePublishGateContract({ validation, visualParity });
}

async function cli() {
	const validationPath = process.env.IMPORT_VALIDATION_RESULT_PATH || process.argv[2];
	const visualParityPath = process.env.VISUAL_PARITY_ARTIFACT_PATH || process.argv[3];
	const outputPath = process.env.STATIC_SITE_PUBLISH_GATE_PATH || process.argv[4];
	const validation = await readJsonOrNull(validationPath) || {};
	const visualParity = await readJsonOrNull(visualParityPath) || {};
	const result = evaluateStaticSitePublishGate({ validation, visualParity });
	const json = `${JSON.stringify(result, null, 2)}\n`;

	if (outputPath) {
		await writeFile(outputPath, json);
		return;
	}

	process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	cli().catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exit(1);
	});
}
