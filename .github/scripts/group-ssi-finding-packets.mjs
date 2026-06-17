#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { routeCandidateRepo, routeReason, routeRepairMode } from './lib/finding-routing.mjs';
import { groupFindingPackets } from './lib/ssi-finding-packets.mjs';

const inputPaths = (process.env.FINDING_PACKET_PATHS || process.argv.slice(2).join(','))
	.split(',')
	.map((item) => item.trim())
	.filter(Boolean);
const outputPath = process.env.FINDING_GROUPS_PATH || 'php-transformer-iterator-input.json';

if (inputPaths.length === 0) {
	throw new Error('Provide finding packet JSON paths as args or FINDING_PACKET_PATHS.');
}

const packets = [];
for (const inputPath of inputPaths) {
	const data = JSON.parse(await readFile(inputPath, 'utf8'));
	packets.push(...(Array.isArray(data) ? data : data.packets || []));
}

const grouped = groupFindingPackets(packets, { routeCandidateRepo, routeRepairMode, routeReason });
await writeFile(outputPath, `${JSON.stringify(grouped, null, 2)}\n`);
