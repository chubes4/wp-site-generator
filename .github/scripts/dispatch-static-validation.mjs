#!/usr/bin/env node
import { dispatchWorkflow, githubToken, prNumberFromUrl } from './lib/github-api.mjs';
import { parseArgs, readJsonFile, repoPathResolver } from './lib/ci-runtime-utils.mjs';

const args = parseArgs(process.argv.slice(2));

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const repoPath = repoPathResolver(repoRoot);
const aggregatePath = args.get('--aggregate') || repoPath('.ci', 'homeboy-agent-task-aggregate.json');
const repo = args.get('--repo') || process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const ref = args.get('--ref') || 'main';
const token = githubToken(process.env, ['GITHUB_TOKEN', 'GH_TOKEN']);
const aggregate = await readJsonFile(aggregatePath);

if (!token) {
  fail('GITHUB_TOKEN or GH_TOKEN is required to dispatch static validation');
}

const staticPrs = [...new Set((aggregate.outcomes || [])
  .filter((outcome) => String(outcome.task_id || '').startsWith('static-'))
  .map((outcome) => prNumberFromUrl(outcome.outputs?.static_site_pr_url || outcome.outputs?.pr_url))
  .filter(Boolean))];

if (staticPrs.length === 0) {
  fail('no static PR outputs found in aggregate');
}

for (const prNumber of staticPrs) {
  await dispatchWorkflow({
    repo,
    workflow: 'static-site-validation.yml',
    ref,
    inputs: {
      pr_number: String(prNumber),
    },
    token,
    failMessage: (message) => `Static validation dispatch failed: ${message}`,
  });
  console.log(`dispatched static validation for PR #${prNumber}`);
}

function fail(message) {
  throw new Error(`Static validation dispatch failed: ${message}`);
}
