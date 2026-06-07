import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-proof-'));

const storeTitle = '🛒 Plinth & Patch — Restoration kits for old wooden furniture';
const websiteTitle = '📍 Mossbank Board Game Café — Table planning for neighborhood play';
const conceptBody = `## Recommended Concept
The concept is specific and buildable.

## Who It Serves
It serves a clear audience.

## What It Offers
It offers a concrete product or service.

## Why It Could Work
It has a clear reason to exist.`;

function conceptOutcome(taskId, issueNumber, title) {
  return {
    task_id: taskId,
    status: 'succeeded',
    diagnostics: [],
    outputs: {
      issue_number: issueNumber,
      issue_url: `https://github.com/chubes4/wp-site-generator/issues/${issueNumber}`,
    },
    metadata: {
      tool_trace: [
        {
          tool_name: 'github_issue_publish',
          tool_parameters: {
            title,
            body: conceptBody,
          },
        },
      ],
    },
  };
}

function designOutcome(taskId, designIssueNumber) {
  return {
    task_id: taskId,
    status: 'succeeded',
    diagnostics: [],
    outputs: {
      design_issue_number: designIssueNumber,
      design_issue_url: `https://github.com/chubes4/wp-site-generator/issues/${designIssueNumber}`,
    },
  };
}

function staticOutcome(taskId, prNumber) {
  return {
    task_id: taskId,
    status: 'succeeded',
    diagnostics: [],
    outputs: {
      static_site_pr_url: `https://github.com/chubes4/wp-site-generator/pull/${prNumber}`,
    },
  };
}

function aggregate(overrides = {}) {
  const value = {
    schema: 'homeboy/agent-task-aggregate/v1',
    status: 'succeeded',
    totals: {
      queued: 6,
      succeeded: 6,
      failed: 0,
    },
    outcomes: [
      conceptOutcome('store-idea-agent', 487, storeTitle),
      conceptOutcome('website-idea-agent', 488, websiteTitle),
      designOutcome('design-store-issue', 601),
      designOutcome('design-website-issue', 602),
      staticOutcome('static-store-site', 701),
      staticOutcome('static-website-site', 702),
    ],
  };
  return overrides.aggregate ? overrides.aggregate(value) : value;
}

function designBody(issueNumber, title) {
  return `## Source concept

- Source issue: #${issueNumber}
- Source title: ${title}

## Design direction

\`\`\`json
{"schema_version":1,"source_issue_number":${issueNumber},"source_title":${JSON.stringify(title)}}
\`\`\``;
}

function fixture(overrides = {}) {
  const value = {
    issues: {
      487: {
        number: 487,
        title: storeTitle,
        body: conceptBody,
        labels: [{ name: 'status:design-ready' }, { name: 'site-kind:commerce' }],
      },
      488: {
        number: 488,
        title: websiteTitle,
        body: conceptBody,
        labels: [{ name: 'status:design-ready' }, { name: 'site-kind:content' }],
      },
      601: {
        number: 601,
        title: '🎨 Design direction — Plinth & Patch — Restoration kits for old wooden furniture',
        body: designBody(487, storeTitle),
        labels: [],
      },
      602: {
        number: 602,
        title: '🎨 Design direction — Mossbank Board Game Café — Table planning for neighborhood play',
        body: designBody(488, websiteTitle),
        labels: [],
      },
    },
    pull_requests: {
      701: {
        number: 701,
        title: '🧱 Plinth & Patch — Restoration kits for old wooden furniture — static site',
        body: '## Generated Files\n\n## Design Intent\n\n## AI Assistance\n\nCloses #487',
        head: { ref: 'static/issue-487-plinth-patch' },
        labels: [{ name: 'target:woocommerce' }],
      },
      702: {
        number: 702,
        title: '🧱 Mossbank Board Game Café — Table planning for neighborhood play — static site',
        body: '## Generated Files\n\n## Design Intent\n\n## AI Assistance\n\nCloses #488',
        head: { ref: 'static/issue-488-mossbank-board-game-cafe' },
        labels: [{ name: 'target:wordpress' }],
      },
    },
  };
  return overrides.fixture ? overrides.fixture(value) : value;
}

async function runCase(name, aggregateValue, fixtureValue) {
  const aggregatePath = path.join(tempDir, `${name}.aggregate.json`);
  const fixturePath = path.join(tempDir, `${name}.fixture.json`);
  await writeFile(aggregatePath, `${JSON.stringify(aggregateValue, null, 2)}\n`);
  await writeFile(fixturePath, `${JSON.stringify(fixtureValue, null, 2)}\n`);
  return spawnSync(process.execPath, ['.github/scripts/assert-site-generation-loop-proof.mjs', '--aggregate', aggregatePath, '--fixture-state', fixturePath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

try {
  const passing = await runCase('passing', aggregate(), fixture());
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /semantic proof passed/);

  const corruptedConcept = await runCase(
    'corrupted-concept',
    aggregate(),
    fixture({
      fixture: (value) => {
        value.issues['487'].title = 'Design direction';
        value.issues['487'].body = '## Design direction\n\n```json\n{}\n```';
        return value;
      },
    })
  );
  assert.notEqual(corruptedConcept.status, 0, 'concept mutation fails proof');
  assert.match(corruptedConcept.stderr, /concept title is preserved|concept body is preserved|design handoff/);

  const designTitlePr = await runCase(
    'design-title-pr',
    aggregate(),
    fixture({
      fixture: (value) => {
        value.pull_requests['701'].title = '🧱 Design direction — static site';
        return value;
      },
    })
  );
  assert.notEqual(designTitlePr.status, 0, 'design-title static PR fails proof');
  assert.match(designTitlePr.stderr, /static PR title derives from source concept title/);

  const missingDesignOutput = await runCase(
    'missing-design-output',
    aggregate({
      aggregate: (value) => {
        delete value.outcomes.find((item) => item.task_id === 'design-store-issue').outputs.design_issue_number;
        return value;
      },
    }),
    fixture()
  );
  assert.notEqual(missingDesignOutput.status, 0, 'missing design issue output fails proof');
  assert.match(missingDesignOutput.stderr, /missing design_issue_number output/);

  const runtimeFailure = await runCase(
    'runtime-failure',
    aggregate({
      aggregate: (value) => {
        value.outcomes[0].diagnostics.push({ class: 'wp-codebox.agent_task_run_failed', message: 'runtime failed' });
        return value;
      },
    }),
    fixture()
  );
  assert.notEqual(runtimeFailure.status, 0, 'embedded runtime failure fails proof');
  assert.match(runtimeFailure.stderr, /embedded runtime failure diagnostics/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('site generation loop proof assertion tests passed');
