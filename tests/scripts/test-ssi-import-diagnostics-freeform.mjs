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
assert.match(diagnostics, /array\(\s*'generated_theme',\s*'freeform_blocks'\s*\)/, 'diagnostics reads concrete generated-theme freeform blocks');
assert.match(diagnostics, /'freeform_diagnostics'\s*=>\s*\$freeform_diagnostics/, 'diagnostics exposes concrete freeform diagnostic rows');
assert.match(diagnostics, /0 === count\( \$freeform_diagnostics \)/, 'diagnostics suppresses aggregate freeform findings when concrete rows exist');
assert.match(reportRenderer, /\['ssi_freeform_block_count',\s*'freeform blocks'\]/, 'validation report displays freeform block counts with the other SSI signals');

console.log('ssi import diagnostics freeform smoke passed');
