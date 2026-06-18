import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/php-transformer-iterator.yml'), 'utf8');
const iteratorFlow = await readFile(path.join(repoRoot, 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json'), 'utf8');

assert.match(workflow, /runtime-agent-ci\.yml@main/, 'iterator uses the generic Homeboy Extensions runtime agent workflow');
assert.doesNotMatch(workflow, /datamachine-agent-ci\.yml@main/, 'iterator no longer calls the quarantined Data Machine reusable workflow');
assert.match(workflow, /runtime_execution: .*actions_artifact_downloads/, 'iterator passes validation artifact downloads through the runtime execution payload');
assert.match(workflow, /agents\/run-runtime-package/, 'iterator uses the generic Agents API runtime package ability');
assert.doesNotMatch(workflow, /datamachine\/run-agent-bundle/, 'iterator no longer passes the Data Machine bundle ability');
assert.match(workflow, /visual_artifact_name:/, 'iterator accepts the visual parity artifact name from validation');
assert.match(workflow, /"name":"\$\{\{ inputs\.visual_artifact_name \}\}"/, 'iterator downloads the visual parity artifact in the reusable runner');
assert.match(workflow, /"dir":"\.ci\/visual-parity"/, 'iterator stores visual parity artifacts in a stable local directory');
assert.match(workflow, /app_token_repos.*chubes4\/block-artifact-compiler/, 'iterator token routing includes block-artifact-compiler');
assert.match(workflow, /execute_workflow_builder_command.*group-ssi-finding-packets\.mjs .*build-agent-iterator-workflow\.mjs/, 'iterator runtime task builds grouped finding workflow');
assert.match(workflow, /execute_workflow_path":"\.ci\/agent-iterator-workflow\.json"/, 'iterator runtime task receives the generated workflow path');
assert.match(workflow, /ability_tools: .*wp-codebox\/runner-workspace-command.*wp-codebox\/runner-workspace-publish/, 'iterator exposes workspace and PR publication tools through WP Codebox provider runtime identifiers');
assert.doesNotMatch(workflow, /datamachine-code\//, 'iterator workflow no longer passes Data Machine Code ability names');
assert.match(workflow, /runtime_output_projections.*source_callback_url/, 'iterator declares generic runtime output projections');
assert.match(workflow, /evidence_projections.*create_github_pull_request.*upstream_action_url/, 'iterator records upstream action evidence through generic evidence projections');
assert.doesNotMatch(workflow, /engine_data_outputs|tool_recorders|engine_key/, 'iterator does not use legacy Data Machine-named projection config keys');
assert.doesNotMatch(workflow, /actions_artifact_items/, 'iterator no longer fetches artifact ZIPs inside WordPress runtime');
assert.doesNotMatch(workflow, /exactly one finding packet per Data Machine child job/, 'iterator prompt must not describe raw per-packet fanout');
assert.match(iteratorFlow, /upstream pull requests as durable per source finding/, 'iterator treats upstream PRs as durable across reruns');
assert.match(iteratorFlow, /deterministic titles/, 'iterator uses stable fallback issue titles for cleanup');
assert.match(iteratorFlow, /repair_mode=issue_only/, 'iterator treats aggregate-only packets as issue-only evidence');
assert.match(iteratorFlow, /block-artifact-compiler/, 'iterator prompt includes artifact compiler routing');
assert.match(iteratorFlow, /Do not call list_github_issues/, 'iterator prompt prevents repeated issue-list loops');
assert.doesNotMatch(iteratorFlow, /"list_github_issues"/, 'iterator does not expose issue listing in the live tool path');

console.log('php-transformer-iterator workflow smoke passed');
