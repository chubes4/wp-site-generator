import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/php-transformer-iterator.yml'), 'utf8');
const iteratorFlow = await readFile(path.join(repoRoot, 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json'), 'utf8');

assert.match(workflow, /actions_artifact_downloads:/, 'iterator downloads validation artifacts in the reusable runner');
assert.match(workflow, /build-datamachine-iterator-workflow\.mjs \.ci\/finding-packets\/finding-packets\.json \.ci\/datamachine-iterator-workflow\.json/, 'iterator builds an execute-workflow payload from downloaded packets');
assert.match(workflow, /execute_workflow_path: \.ci\/datamachine-iterator-workflow\.json/, 'iterator executes the generated workflow payload');
assert.doesNotMatch(workflow, /actions_artifact_items/, 'iterator no longer fetches artifact ZIPs inside WordPress runtime');
assert.match(iteratorFlow, /fallback issues as durable per source finding/, 'iterator treats fallback issues as durable across reruns');
assert.match(iteratorFlow, /new validation_run_id or newly worded title is not enough/, 'iterator does not create duplicate issues for new validation runs');

console.log('php-transformer-iterator workflow smoke passed');
