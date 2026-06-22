#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(repoRoot, 'tests/fixtures/codebox-provider-runtime-contract.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const contractConstants = collectStrings(fixture).filter((value) => value.includes('wp-codebox/') || value.includes('wp-codebox.'));
const violations = [];

for (const filePath of await walk(repoRoot)) {
	if (filePath === fixturePath || filePath.includes(`${path.sep}.git${path.sep}`)) {
		continue;
	}
	const content = await readFile(filePath, 'utf8');
	for (const value of contractConstants) {
		if (content.includes(value)) {
			violations.push(`${path.relative(repoRoot, filePath)} duplicates ${value}`);
		}
	}
}

assert.deepEqual(violations, [], 'Codebox ability/schema constants stay isolated to the adapter fixture');

console.log('Codebox contract constant boundary passed');

function collectStrings(value) {
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap(collectStrings);
	}
	if (value && typeof value === 'object') {
		return Object.values(value).flatMap(collectStrings);
	}
	return [];
}

async function walk(root) {
	const entries = await readdir(root, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const filePath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			if (['node_modules', '.git'].includes(entry.name)) {
				continue;
			}
			files.push(...await walk(filePath));
			continue;
		}
		if (entry.isFile()) {
			files.push(filePath);
		}
	}
	return files;
}
