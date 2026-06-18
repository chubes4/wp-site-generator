import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const configPath = path.join(repoRoot, '.github/datamachine-boundary-quarantine.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const candidateFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => !file.startsWith('.claude/') && !file.startsWith('.datamachine/') && file !== 'AGENTS.md');

const termPattern = new RegExp(config.terms.map(escapeRegExp).join('|'));
const matches = [];
for (const file of candidateFiles) {
  const body = await readFile(path.join(repoRoot, file), 'utf8');
  if (termPattern.test(body)) {
    matches.push(file);
  }
}

const quarantined = config.quarantine || {};
const unclassified = matches.filter((file) => !quarantined[file]);
const stale = Object.keys(quarantined).filter((file) => !matches.includes(file));
const byCategory = matches.reduce((accumulator, file) => {
  const category = quarantined[file]?.category || 'unclassified';
  accumulator[category] = (accumulator[category] || 0) + 1;
  return accumulator;
}, {});

console.log('Data Machine boundary report');
console.log(`- scanned files: ${candidateFiles.length}`);
console.log(`- files with boundary terms: ${matches.length}`);
for (const [category, count] of Object.entries(byCategory).sort()) {
  console.log(`- ${category}: ${count}`);
}

if (unclassified.length > 0) {
  console.error('\nUnclassified Data Machine references:');
  for (const file of unclassified) {
    console.error(`- ${file}`);
  }
}

if (stale.length > 0) {
  console.error('\nStale quarantine entries with no matching reference:');
  for (const file of stale) {
    console.error(`- ${file}`);
  }
}

assert.deepEqual(unclassified, [], 'new Data Machine references must be removed or explicitly classified in .github/datamachine-boundary-quarantine.json');
assert.deepEqual(stale, [], 'remove stale Data Machine quarantine entries when references are cleaned up');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
