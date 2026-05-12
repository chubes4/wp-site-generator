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
assert.match(workflow, /collect-store-issue:[\s\S]*needs: store-idea-agent[\s\S]*if: always\(\)/, 'store issue collection runs even when the store idea job fails');
assert.match(workflow, /collect-website-issue:[\s\S]*needs: website-idea-agent[\s\S]*if: always\(\)/, 'website issue collection runs even when the website idea job fails');
assert.doesNotMatch(workflow, /collect-issues:/, 'workflow has no shared issue collection gate');
assert.doesNotMatch(workflow, /needs:\n      - store-idea-agent\n      - website-idea-agent/, 'workflow does not couple lanes behind both idea jobs');
assert.match(workflow, /agent_slug: design-agent/, 'workflow runs design agent');
assert.match(workflow, /agent_slug: static-site-agent/, 'workflow runs static site agent');
assert.match(workflow, /design-store-issue:[\s\S]*needs: collect-store-issue/, 'store design depends only on store issue collection');
assert.match(workflow, /design-website-issue:[\s\S]*needs: collect-website-issue/, 'website design depends only on website issue collection');
assert.match(workflow, /static-store-site:[\s\S]*needs:[\s\S]*collect-store-issue[\s\S]*design-store-issue/, 'store static build depends only on store lane');
assert.match(workflow, /static-website-site:[\s\S]*needs:[\s\S]*collect-website-issue[\s\S]*design-website-issue/, 'website static build depends only on website lane');
assert.match(workflow, /data_machine_ref:\n        description: Data Machine ref\.[\s\S]*default: main/, 'workflow defaults Data Machine to main');
assert.match(workflow, /data_machine_code_ref:\n        description: Data Machine Code ref\.[\s\S]*default: main/, 'workflow defaults Data Machine Code to main');
assert.doesNotMatch(workflow, /feat\/|TODO|temporary|temp ref/i, 'workflow does not contain temporary refs or TODO placeholders');

console.log('site-generation-loop workflow smoke passed');
