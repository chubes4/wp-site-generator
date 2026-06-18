import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/php-transformer-iterator.yml'), 'utf8');
const iteratorFlow = await readFile(path.join(repoRoot, 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json'), 'utf8');

assert.match(workflow, /runtime-agent-ci\.yml@main/, 'iterator uses the generic Homeboy Extensions runtime agent workflow');
assert.doesNotMatch(workflow, /datamachine-agent-ci\.yml@main/, 'iterator no longer calls the quarantined Data Machine reusable workflow');
assert.match(workflow, /runtime_task: .*actions_artifact_downloads/, 'iterator passes validation artifact downloads through the runtime task payload');
assert.match(workflow, /visual_artifact_name:/, 'iterator accepts the visual parity artifact name from validation');
assert.match(workflow, /"name":"\$\{\{ inputs\.visual_artifact_name \}\}"/, 'iterator downloads the visual parity artifact in the reusable runner');
assert.match(workflow, /"dir":"\.ci\/visual-parity"/, 'iterator stores visual parity artifacts in a stable local directory');
assert.match(workflow, /app_token_repos.*chubes4\/block-artifact-compiler/, 'iterator token routing includes block-artifact-compiler');
assert.match(workflow, /execute_workflow_builder_command.*group-ssi-finding-packets\.mjs .*build-datamachine-iterator-workflow\.mjs/, 'iterator runtime task builds grouped finding workflow');
assert.match(workflow, /execute_workflow_path":"\.ci\/datamachine-iterator-workflow\.json"/, 'iterator runtime task receives the generated workflow path');
assert.match(workflow, /ability_tools: .*wp-codebox\/runner-workspace-command.*wp-codebox\/runner-workspace-publish/, 'iterator exposes workspace and PR publication tools through WP Codebox provider runtime identifiers');
assert.doesNotMatch(workflow, /datamachine-code\/workspace-|datamachine-code\/create-github-pull-request/, 'iterator workflow no longer passes Data Machine Code workspace or PR publication ability names');
assert.match(workflow, /tool_recorders.*engine_key.*php_transformer_iterator.*upstream_action_url/, 'iterator keeps legacy projection keys quarantined until upstream exposes generic evidence/output projection config');
assert.doesNotMatch(workflow, /actions_artifact_items/, 'iterator no longer fetches artifact ZIPs inside WordPress runtime');
assert.doesNotMatch(workflow, /exactly one finding packet per Data Machine child job/, 'iterator prompt must not describe raw per-packet fanout');
assert.match(iteratorFlow, /upstream pull requests as durable per source finding/, 'iterator treats upstream PRs as durable across reruns');
assert.match(iteratorFlow, /deterministic titles/, 'iterator uses stable fallback issue titles for cleanup');
assert.match(iteratorFlow, /repair_mode=issue_only/, 'iterator treats aggregate-only packets as issue-only evidence');
assert.match(iteratorFlow, /block-artifact-compiler/, 'iterator prompt includes artifact compiler routing');
assert.match(iteratorFlow, /Do not call list_github_issues/, 'iterator prompt prevents repeated issue-list loops');
assert.doesNotMatch(iteratorFlow, /"list_github_issues"/, 'iterator does not expose issue listing in the live tool path');

console.log('php-transformer-iterator workflow smoke passed');
