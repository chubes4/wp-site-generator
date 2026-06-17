#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { githubApi, githubToken } from './lib/github-api.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const aggregatePath = args.get('--aggregate') || path.join(repoRoot, '.ci', 'homeboy-agent-task-aggregate.json');
const repo = args.get('--repo') || process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const ref = args.get('--ref') || 'main';
const token = githubToken(process.env, ['GITHUB_TOKEN', 'GH_TOKEN']);
const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8'));

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
  await githubApi({
    repo,
    endpoint: 'actions/workflows/static-site-validation.yml/dispatches',
    token,
    init: {
    method: 'POST',
    body: JSON.stringify({
      ref,
      inputs: {
        pr_number: String(prNumber),
      },
    }),
    },
    failMessage: (message) => `Static validation dispatch failed: ${message}`,
  });
  console.log(`dispatched static validation for PR #${prNumber}`);
}

function prNumberFromUrl(url) {
  const match = String(url || '').match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function fail(message) {
  throw new Error(`Static validation dispatch failed: ${message}`);
}
