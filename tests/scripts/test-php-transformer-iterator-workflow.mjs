import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/php-transformer-iterator.yml'), 'utf8');
const iteratorFlow = await readFile(path.join(repoRoot, 'bundles/php-transformer-iterator-agent/flows/php-transformer-iterator-manual-flow.json'), 'utf8');

assert.match(workflow, /actions_artifact_downloads:/, 'iterator downloads validation artifacts in the reusable runner');
assert.match(workflow, /visual_artifact_name:/, 'iterator accepts the visual parity artifact name from validation');
assert.match(workflow, /"name":"\$\{\{ inputs\.visual_artifact_name \}\}"/, 'iterator downloads the visual parity artifact in the reusable runner');
assert.match(workflow, /"dir":"\.ci\/visual-parity"/, 'iterator stores visual parity artifacts in a stable local directory');
assert.match(workflow, /group-ssi-finding-packets\.mjs \.ci\/finding-packets\/finding-packets\.json/, 'iterator groups downloaded packets before Data Machine fanout');
assert.match(workflow, /VISUAL_ARTIFACT_DIR=\.ci\/visual-parity node \.github\/scripts\/build-datamachine-iterator-workflow\.mjs \.ci\/finding-packets\/grouped-finding-packets\.json \.ci\/datamachine-iterator-workflow\.json/, 'iterator builds DataPackets with visual artifact context');
assert.match(workflow, /execute_workflow_path: \.ci\/datamachine-iterator-workflow\.json/, 'iterator executes the generated workflow payload');
assert.match(workflow, /extra_required_abilities: '\["datamachine\/upsert-github-pull-review-comment"\]'/, 'iterator requires the managed PR comment upsert ability');
assert.match(workflow, /app_token_repos: .*chubes4\/block-artifact-compiler/, 'iterator token routing includes block-artifact-compiler');
assert.match(workflow, /success_requires_pr: false/, 'issue-only and existing-issue completion paths do not require a new PR');
assert.match(workflow, /success_completion_outcomes: '\["pull_request_path","issue_fallback_path","existing_issue_path","no_actionable_findings"\]'/, 'iterator accepts every explicit completion outcome');
assert.doesNotMatch(workflow, /actions_artifact_items/, 'iterator no longer fetches artifact ZIPs inside WordPress runtime');
assert.doesNotMatch(workflow, /exactly one finding packet per Data Machine child job/, 'iterator prompt must not describe raw per-packet fanout');
assert.match(iteratorFlow, /fallback issues as durable per source finding/, 'iterator treats fallback issues as durable across reruns');
assert.match(iteratorFlow, /new validation_run_id or newly worded title is not enough/, 'iterator does not create duplicate issues for new validation runs');
assert.match(iteratorFlow, /repair_mode=issue_only/, 'iterator treats aggregate-only packets as issue-only evidence');
assert.match(iteratorFlow, /block-artifact-compiler/, 'iterator prompt includes artifact compiler routing');
assert.match(iteratorFlow, /make the completion decision immediately/, 'iterator prompt prevents repeated issue-list loops');
assert.match(iteratorFlow, /iterator-existing-issue-decision/, 'iterator enforces a terminal action after issue lookup');

console.log('php-transformer-iterator workflow smoke passed');
