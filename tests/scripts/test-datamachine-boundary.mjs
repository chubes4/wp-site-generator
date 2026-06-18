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

const boundaryDoc = await readFile(path.join(repoRoot, 'docs/datamachine-boundary.md'), 'utf8');
assert.match(boundaryDoc, /Extra-Chill\/homeboy-extensions#1538/, 'boundary docs record the merged generic runtime-agent-ci upstream primitive');
assert.match(boundaryDoc, /no upstream PR for that materializer was found/i, 'boundary docs record that generic workspace preload materialization is still blocked upstream');

const manifestFiles = candidateFiles.filter((file) => file.startsWith('bundles/') && file.endsWith('/manifest.json'));
for (const file of manifestFiles) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
  assert.equal(manifest.exported_by, 'wp-site-generator', `${file} uses neutral exporter metadata`);
  assert.equal(manifest.agent_package?.slug, manifest.bundle_slug, `${file} declares a matching generic package slug`);
  assert.equal(manifest.agent_package?.version, manifest.bundle_version, `${file} declares a matching generic package version`);
  assert.equal(manifest.agent_package?.meta?.source_type, 'runtime-agent-package', `${file} declares generic package source type`);
  assert.equal(manifest.agent_package?.meta?.exported_by, 'wp-site-generator', `${file} declares neutral package exporter metadata`);
  assert.doesNotMatch(manifest.exported_by, /data-machine|datamachine/i, `${file} exporter metadata does not name Data Machine`);
}

for (const file of manifestFiles.filter((file) => file.includes('php-transformer-iterator-agent') || file.includes('ssi-stack-reviewer-agent'))) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
  const artifacts = manifest.agent_package?.artifacts || [];
  assert.equal(artifacts.length, 1, `${file} declares its workspace preload as a package artifact`);
  assert.equal(artifacts[0].type, 'agent-runtime/workspace-preload', `${file} uses generic workspace preload package vocabulary`);
  assert.deepEqual(artifacts[0].requires, ['agent-runtime/workspace-preload'], `${file} declares workspace preload capability need`);
  assert.equal(artifacts[0].meta?.compatibility_adapter?.type, 'datamachine-code/workspace_preload', `${file} quarantines the current workspace preload adapter`);
  assert.equal(quarantined[file]?.category, 'blocked_upstream_preload_dependency', `${file} is classified as blocked on the upstream generic preload materializer`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
