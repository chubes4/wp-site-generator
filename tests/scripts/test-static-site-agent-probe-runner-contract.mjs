import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const probe = await readFile(path.join(repoRoot, 'tests/playground-ci/workloads/dm-static-site-agent-probe.php'), 'utf8');

assert.match(probe, /datamachine\/run-agent-bundle/, 'static-site probe runs through Data Machine run-agent-bundle');
assert.match(probe, /'wait_for_completion'\s*=>\s*true/, 'static-site probe lets the bundle runner drain synchronously');
assert.match(probe, /'flow_step_patches'\s*=>/, 'static-site probe patches WPSG fetch and publish settings at run scope');
assert.match(probe, /'tool_recorders'\s*=>/, 'static-site probe captures PR publication through Data Machine tool_recorders');
assert.match(probe, /'engine_data_outputs'\s*=>/, 'static-site probe projects semantic runner outputs');
assert.match(probe, /'required_outputs'\s*=>\s*\['static_site_pr_url'\]/, 'static-site probe fails closed without a recorded PR URL');
assert.doesNotMatch(probe, /datamachine\/import-agent|datamachine\/run-flow|datamachine\/drain-job/, 'static-site probe does not use legacy import/run/drain abilities');
assert.doesNotMatch(probe, /new Agents\(|new Pipelines\(|new Flows\(|new Jobs\(/, 'static-site probe does not resolve imported database records manually');
assert.doesNotMatch(probe, /GitHubPullRequestPublish|Static_Site_Agent_Publish_Recorder/, 'static-site probe does not wrap the PR publish handler');

console.log('static-site agent probe runner contract passed');
