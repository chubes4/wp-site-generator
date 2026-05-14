import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');

assert.match(workflow, /Refresh validation harness from main/, 'static validation refreshes harness scripts from main');
assert.match(workflow, /git fetch --depth=1 origin main/, 'static validation fetches current main');
assert.match(workflow, /git checkout origin\/main -- \.github\/scripts \.github\/homeboy/, 'static validation overlays scripts and Homeboy diagnostics from main');
assert.match(workflow, /validation-harness-main-sha\.txt/, 'static validation records the harness ref used in artifacts');

console.log('static validation harness main smoke passed');
