#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { evaluateStaticSitePublishGate } from './evaluate-static-site-publish-gate.mjs';
import { writeJsonFile } from './lib/ci-runtime-utils.mjs';

const inputPath = requiredEnv('HOMEBOY_LOOP_ACTION_INPUT');
const outputPath = requiredEnv('HOMEBOY_LOOP_ACTION_OUTPUT');
const commandInput = JSON.parse(await readFile(inputPath, 'utf8'));
const artifacts = commandInput?.request?.inputs?.artifacts || {};
const validation = artifacts.import_validation_result?.payload || artifacts.import_validation_result || {};
const visualParity = artifacts.visual_parity_artifact?.payload || artifacts.visual_parity_artifact || {};
const gate = evaluateStaticSitePublishGate({ validation, visualParity });

await writeJsonFile(outputPath, {
	artifacts: {
		static_site_publish_gate: {
			schema: 'wp-site-generator/StaticSitePublishGate/v1',
			...gate,
			artifact_url: outputPath,
		},
	},
});

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}
