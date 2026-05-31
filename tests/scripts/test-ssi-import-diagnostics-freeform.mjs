#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const diagnostics = await readFile(path.join(repoRoot, '.github/homeboy/ssi-import-diagnostics.php'), 'utf8');
const reportRenderer = await readFile(path.join(repoRoot, '.github/scripts/render-ssi-validation-report.mjs'), 'utf8');

assert.match(diagnostics, /'ssi_freeform_block_count'\s*=>\s*0/, 'diagnostics initializes a freeform block metric');
assert.match(diagnostics, /array\(\s*'quality',\s*'freeform_block_count'\s*\)/, 'diagnostics reads quality.freeform_block_count');
assert.match(diagnostics, /'freeform_block_count'\s*\)/, 'diagnostics falls back to generated document freeform counts');
assert.match(diagnostics, /'diagnostics'\s*=>\s*\$diagnostics/, 'diagnostics exposes modern diagnostic rows');
assert.match(diagnostics, /'ssi_bac_available'\s*=>\s*0/, 'diagnostics initializes BAC availability metric');
assert.match(diagnostics, /'block_artifact_compiler'\s*=>\s*is_array\( \$report \) \? \$bac_summary\( \$report \)/, 'diagnostics exposes BAC import report summary');
assert.doesNotMatch(diagnostics, /freeform_diagnostics/, 'diagnostics does not expose legacy freeform diagnostic rows');
assert.doesNotMatch(diagnostics, /fallback_diagnostics/, 'diagnostics does not expose legacy fallback diagnostic rows');
assert.doesNotMatch(diagnostics, /'findings'/, 'diagnostics does not expose legacy finding rows');
assert.match(reportRenderer, /\['ssi_freeform_block_count',\s*'freeform blocks'\]/, 'validation report displays freeform block counts with the other SSI signals');
assert.match(reportRenderer, /Block Artifact Compiler/, 'validation report displays BAC status');
assert.match(reportRenderer, /Website Artifact Summary/, 'validation report displays BAC website artifact summary');
assert.match(reportRenderer, /Reason Code/, 'validation report displays modern diagnostic fields');

console.log('ssi import diagnostics freeform smoke passed');
