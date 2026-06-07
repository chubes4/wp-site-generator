#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const aggregatePath = args.get('--aggregate') || path.join(repoRoot, '.ci', 'homeboy-agent-task-aggregate.json');
const fixturePath = args.get('--fixture-state') || '';
const repo = args.get('--repo') || process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const validationWaitMs = Number(process.env.STATIC_VALIDATION_WAIT_MS || 15 * 60 * 1000);
const validationPollMs = Number(process.env.STATIC_VALIDATION_POLL_MS || 15 * 1000);

const requiredConceptSections = ['Recommended Concept', 'Who It Serves', 'What It Offers', 'Why It Could Work'];
const lanes = [
  {
    name: 'store',
    conceptTask: 'store-idea-agent',
    designTask: 'design-store-issue',
    staticTask: 'static-store-site',
  },
  {
    name: 'website',
    conceptTask: 'website-idea-agent',
    designTask: 'design-website-issue',
    staticTask: 'static-website-site',
  },
];

const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8'));
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;

function fail(message) {
  throw new Error(`Site generation proof failed: ${message}`);
}

function outcome(taskId) {
  const found = aggregate.outcomes?.find((item) => item.task_id === taskId);
  if (!found) {
    fail(`missing outcome for ${taskId}`);
  }
  return found;
}

function collectObjects(value, predicate, found = []) {
  if (!value || typeof value !== 'object') {
    return found;
  }
  if (predicate(value)) {
    found.push(value);
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      collectObjects(item, predicate, found);
    }
  }
  return found;
}

function publishedConcept(outcomeValue) {
  const toolCalls = collectObjects(
    outcomeValue,
    (value) => value.tool_name === 'github_issue_publish' && value.tool_parameters?.title && value.tool_parameters?.body
  );
  if (!toolCalls.length) {
    fail(`missing original github_issue_publish tool parameters for ${outcomeValue.task_id}`);
  }
  const call = toolCalls[0];
  return {
    title: call.tool_parameters.title,
    body: call.tool_parameters.body,
  };
}

function labelsOf(value) {
  return (value.labels || []).map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean);
}

function prNumberFromUrl(url) {
  const match = String(url || '').match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function stripLeadingEmoji(title) {
  return String(title).replace(/^[^\p{L}\p{N}#]+/u, '').trim();
}

function hasConceptSections(body) {
  return requiredConceptSections.every((section) => new RegExp(`(^|\\n)##\\s+${section}(\\n|$)`, 'i').test(body));
}

function looksLikeDesignHandoff(issue) {
  return /^\s*(design direction|unused)\s*$/i.test(issue.title || '') || /^\s*##\s+Design direction/i.test(issue.body || '');
}

async function githubJson(kind, number) {
  if (fixture) {
    const collection = kind === 'issue' ? fixture.issues : fixture.pull_requests;
    const value = collection?.[String(number)];
    if (!value) {
      fail(`fixture missing ${kind} #${number}`);
    }
    return value;
  }

  return githubApi(kind === 'issue' ? `issues/${number}` : `pulls/${number}`);
}

async function githubApi(endpoint) {
  if (!token) {
    fail('GITHUB_TOKEN or GH_TOKEN is required for live proof assertions');
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    fail(`GitHub API ${endpoint} fetch failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoRuntimeFailures() {
  assert.equal(aggregate.status, 'succeeded', 'aggregate status is succeeded');
  assert.equal(aggregate.totals?.queued, 6, 'site generation loop queues six tasks');
  assert.equal(aggregate.totals?.succeeded, 6, 'site generation loop succeeds six tasks');
  assert.equal(aggregate.totals?.failed, 0, 'site generation loop has zero failed tasks');

  for (const item of aggregate.outcomes || []) {
    assert.equal(item.status, 'succeeded', `${item.task_id} outcome succeeded`);
    const failedDiagnostics = (item.diagnostics || []).filter((diagnostic) => /agent_task_run_failed|runtime.*fail/i.test(diagnostic.class || diagnostic.message || ''));
    assert.deepEqual(failedDiagnostics, [], `${item.task_id} has no embedded runtime failure diagnostics`);
  }
}

async function assertLane(lane) {
  const conceptOutcome = outcome(lane.conceptTask);
  const designOutcome = outcome(lane.designTask);
  const staticOutcome = outcome(lane.staticTask);
  const original = publishedConcept(conceptOutcome);
  const conceptNumber = Number(conceptOutcome.outputs?.issue_number);
  const designNumber = Number(designOutcome.outputs?.design_issue_number);
  const staticPrNumber = prNumberFromUrl(staticOutcome.outputs?.static_site_pr_url || staticOutcome.outputs?.pr_url);

  if (!conceptNumber) {
    fail(`${lane.name} lane missing source concept issue_number output`);
  }
  if (!designNumber) {
    fail(`${lane.name} lane missing design_issue_number output`);
  }
  if (!staticPrNumber) {
    fail(`${lane.name} lane missing static PR output`);
  }

  const concept = await githubJson('issue', conceptNumber);
  const design = await githubJson('issue', designNumber);
  const pr = await githubJson('pull_request', staticPrNumber);
  const conceptLabels = labelsOf(concept);
  const prLabels = labelsOf(pr);
  const conceptName = stripLeadingEmoji(original.title);
  const expectedPrTitle = `🧱 ${conceptName} — static site`;

  assert.equal(concept.title, original.title, `${lane.name} concept title is preserved`);
  assert.equal(concept.body, original.body, `${lane.name} concept body is preserved`);
  assert.ok(hasConceptSections(concept.body), `${lane.name} concept body still has required concept sections`);
  assert.equal(looksLikeDesignHandoff(concept), false, `${lane.name} concept does not look like a design handoff`);
  assert.ok(conceptLabels.includes('status:design-ready'), `${lane.name} concept is design-ready`);
  assert.equal(conceptLabels.includes('status:idea-ready'), false, `${lane.name} concept left idea-ready`);

  assert.notEqual(designNumber, conceptNumber, `${lane.name} design direction is a separate issue`);
  assert.match(design.title || '', /^🎨 Design direction — /, `${lane.name} design issue title is a design handoff`);
  assert.match(design.body || '', new RegExp(`Source issue:\\s*#${conceptNumber}\\b`), `${lane.name} design issue links source issue`);
  assert.match(design.body || '', new RegExp(`Source title:\\s*${escapeRegExp(original.title)}`), `${lane.name} design issue records source title`);
  assert.match(design.body || '', /```json[\s\S]*```/, `${lane.name} design issue contains fenced design JSON`);

  assert.equal(pr.title, expectedPrTitle, `${lane.name} static PR title derives from source concept title`);
  assert.match(pr.head?.ref || pr.headRefName || '', new RegExp(`^static/issue-${conceptNumber}-`), `${lane.name} static PR branch derives from source concept issue`);
  assert.match(pr.body || '', new RegExp(`Closes #${conceptNumber}\\b`), `${lane.name} static PR closes source concept issue`);
  assert.equal((pr.body || '').includes(`Closes #${designNumber}`), false, `${lane.name} static PR does not close design issue`);
  assert.equal(prLabels.some((label) => label === 'target:wordpress' || label === 'target:woocommerce'), true, `${lane.name} static PR has target validation label`);

  return { lane: lane.name, staticPrNumber };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assertImportAndIteratorWorkflow() {
  const workflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
  assert.match(workflow, /static-site-importer import-theme/, 'static validation imports generated static sites');
  assert.match(workflow, /Build SSI finding packets/, 'static validation builds SSI finding packets');
  assert.match(workflow, /gh workflow run php-transformer-iterator\.yml/, 'static validation dispatches transformer iterator');
}

async function assertStaticValidationComments(staticPrs) {
  if (fixture) {
    return;
  }

  const pending = new Map(staticPrs.map((item) => [item.staticPrNumber, item.lane]));
  const deadline = Date.now() + validationWaitMs;

  while (pending.size > 0 && Date.now() <= deadline) {
    for (const [prNumber, laneName] of [...pending.entries()]) {
      const comments = await githubApi(`issues/${prNumber}/comments?per_page=100`);
      const validationComment = comments.find((comment) => {
        const body = String(comment.body || '');
        return body.includes('## Static site validation:') && body.includes('### SSI Signals');
      });

      if (!validationComment) {
        continue;
      }

      const body = String(validationComment.body || '');
      assert.equal(body.includes('_No bench artifact found._'), false, `${laneName} static PR validation has bench artifact`);
      assert.equal(body.includes('_SSI workload did not run._'), false, `${laneName} static PR validation ran SSI workload`);
      assert.equal(body.includes('_No SSI metrics emitted yet._'), false, `${laneName} static PR validation emitted SSI metrics`);
      assert.match(body, /\*\*Playground preview:\*\*/, `${laneName} static PR validation includes Playground preview`);
      pending.delete(prNumber);
    }

    if (pending.size > 0) {
      await sleep(validationPollMs);
    }
  }

  if (pending.size > 0) {
    fail(`static validation metrics comments missing for PR(s): ${[...pending.keys()].map((number) => `#${number}`).join(', ')}`);
  }
}

assertNoRuntimeFailures();
const staticPrs = [];
for (const lane of lanes) {
  staticPrs.push(await assertLane(lane));
}
await assertImportAndIteratorWorkflow();
await assertStaticValidationComments(staticPrs);

console.log('site generation loop semantic proof passed');
