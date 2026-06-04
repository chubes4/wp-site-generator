import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-homeboy-plan-'));
const planPath = path.join(tempDir, 'plan.json');

try {
  const result = spawnSync(process.execPath, ['.github/scripts/build-homeboy-site-generation-plan.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_RUN_ID: '409',
      HOMEBOY_PLAN_PATH: planPath,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const serialized = JSON.stringify(plan);

  assert.equal(plan.schema, 'homeboy/agent-task-plan/v1');
  assert.doesNotMatch(serialized, /metadata\/codebox\/datamachine/);
  assert.doesNotMatch(serialized, /scenarios\/0/);

  for (const taskId of ['design-store-issue', 'design-website-issue', 'static-store-site', 'static-website-site']) {
    assert.equal(
      plan.output_dependencies[taskId].bindings.issue_number.path,
      '/outputs/issue_number',
      `${taskId} binds to semantic issue_number output`
    );
  }

  assert.equal(plan.output_dependencies['static-store-site'].depends_on[0], 'design-store-issue');
  assert.equal(plan.output_dependencies['static-website-site'].depends_on[0], 'design-website-issue');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation plan smoke passed');
