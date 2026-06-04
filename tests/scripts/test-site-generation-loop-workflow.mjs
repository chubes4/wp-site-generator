import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');

assert.match(workflow, /name: Site Generation Loop/, 'workflow has the expected name');
assert.match(workflow, /run-site-generation-loop:/, 'workflow runs one Homeboy-owned orchestration job');
assert.match(workflow, /HOMEBOY_PLAN_PATH:/, 'workflow writes an explicit Homeboy plan artifact');
assert.match(workflow, /Build Homeboy agent-task plan/, 'workflow builds the Homeboy agent-task plan');
assert.match(workflow, /node \.github\/scripts\/build-homeboy-site-generation-plan\.mjs/, 'workflow delegates plan shape to the plan builder');
assert.match(workflow, /homeboy agent-task run-plan --plan "@\$\{\{ steps\.plan\.outputs\.path \}\}"/, 'workflow runs the generated Homeboy agent-task plan');
assert.match(workflow, /HOMEBOY_ARTIFACT_ROOT:/, 'workflow captures Homeboy task artifacts');
assert.match(workflow, /site-generation-loop-homeboy-\$\{\{ github\.run_id \}\}/, 'workflow uploads Homeboy artifacts for review');
assert.doesNotMatch(workflow, /collect-store-issue:/, 'workflow no longer has bespoke store issue collection');
assert.doesNotMatch(workflow, /collect-website-issue:/, 'workflow no longer has bespoke website issue collection');
assert.doesNotMatch(workflow, /needs\.collect-/, 'workflow does not bind downstream tasks through GitHub Actions collect jobs');
assert.match(workflow, /data_machine_ref:\n        description: Data Machine ref\.[\s\S]*default: main/, 'workflow defaults Data Machine to main');
assert.match(workflow, /data_machine_code_ref:\n        description: Data Machine Code ref\.[\s\S]*default: main/, 'workflow defaults Data Machine Code to main');
assert.match(workflow, /homeboy_extensions_ref:[\s\S]*default: main/, 'workflow defaults Homeboy Extensions to main');
assert.match(workflow, /wp_codebox_ref:[\s\S]*default: main/, 'workflow defaults WP Codebox to main');
assert.doesNotMatch(workflow, /feat\/|TODO|temporary|temp ref/i, 'workflow does not contain temporary refs or TODO placeholders');

console.log('site-generation-loop workflow smoke passed');
