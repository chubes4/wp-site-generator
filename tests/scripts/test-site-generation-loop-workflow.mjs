import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');

assert.match(workflow, /name: Site Generation Loop/, 'workflow has the expected name');
assert.match(workflow, /store-idea-agent:/, 'workflow runs store idea lane');
assert.match(workflow, /website-idea-agent:/, 'workflow runs website idea lane');
assert.match(workflow, /flow_slug: store-idea-home-and-craft-flow/, 'store lane runs the home/craft idea flow');
assert.match(workflow, /flow_slug: website-idea-local-business-flow/, 'website lane runs the local business idea flow');
assert.match(workflow, /needs:\n      - store-idea-agent\n      - website-idea-agent/, 'workflow waits for both idea lanes before collecting issues');
assert.match(workflow, /matrix:\n        issue_number: \$\{\{ fromJSON\(needs\.collect-issues\.outputs\.issue_numbers\) \}\}/, 'design/static stages fan out over collected issues');
assert.match(workflow, /agent_slug: design-agent/, 'workflow runs design agent');
assert.match(workflow, /agent_slug: static-site-agent/, 'workflow runs static site agent');
assert.match(workflow, /data_machine_ref:\n        description: Data Machine ref\.[\s\S]*default: main/, 'workflow defaults Data Machine to main');
assert.match(workflow, /data_machine_code_ref:\n        description: Data Machine Code ref\.[\s\S]*default: main/, 'workflow defaults Data Machine Code to main');
assert.doesNotMatch(workflow, /feat\/|TODO|temporary|temp ref/i, 'workflow does not contain temporary refs or TODO placeholders');

console.log('site-generation-loop workflow smoke passed');
