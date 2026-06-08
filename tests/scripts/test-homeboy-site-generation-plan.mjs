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

  assert.equal(
    plan.output_dependencies['static-store-site'].bindings.design_issue_number.path,
    '/outputs/design_issue_number',
    'static store task binds to design issue output'
  );
  assert.equal(
    plan.output_dependencies['static-store-site'].bindings.design_issue_number.task_id,
    'design-store-issue',
    'static store task receives design issue from design task'
  );
  assert.equal(
    plan.output_dependencies['static-website-site'].bindings.design_issue_number.path,
    '/outputs/design_issue_number',
    'static website task binds to design issue output'
  );
  assert.equal(
    plan.output_dependencies['static-website-site'].bindings.design_issue_number.task_id,
    'design-website-issue',
    'static website task receives design issue from design task'
  );

  const designFlow = JSON.parse(await readFile(path.join(repoRoot, 'bundles/design-agent/flows/design-manual-flow.json'), 'utf8'));
  const designAiStep = designFlow.steps.find((step) => step.step_type === 'ai');
  const designSystemTaskStep = designFlow.steps.find((step) => step.step_type === 'system_task');
  assert.deepEqual(designAiStep.enabled_tools, ['create_github_issue'], 'design AI can only create the design handoff issue');
  assert.deepEqual(designAiStep.completion_assertions.complete_when_any[0].tools, [{ name: 'create_github_issue', success: true }], 'design AI completion only requires handoff issue creation');
  assert.equal(designSystemTaskStep.flow_step_settings.task_type, 'github_update_issue_labels', 'design flow uses deterministic label update task');
  assert.deepEqual(designSystemTaskStep.flow_step_settings.params.remove_labels, ['status:idea-ready'], 'design flow removes idea-ready deterministically');
  assert.deepEqual(designSystemTaskStep.flow_step_settings.params.add_labels, ['status:design-ready'], 'design flow adds design-ready deterministically');

  for (const taskId of ['design-store-issue', 'design-website-issue']) {
    const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
    assert.deepEqual(config.success_completion_outcomes, ['design_issue'], `${taskId} requires design issue completion`);
    assert.match(config.prompt, /create_github_issue/, `${taskId} creates a separate design issue with the direct GitHub issue tool`);
    assert.doesNotMatch(config.prompt, /add_label_to_issue|remove_label_from_issue/, `${taskId} does not ask the AI to mutate labels`);
    assert.equal(config.tool_recorders[0].tool, 'create_github_issue', `${taskId} records direct GitHub issue creation`);
    assert.equal(config.tool_recorders[0].record.fields.issue_number, 'tool_result_data.issue_number', `${taskId} records issue number from non-handler tool result data`);
    assert.equal(config.tool_recorders[0].record.fields.issue_url, 'tool_result_data.issue_url', `${taskId} records issue URL from non-handler tool result data`);
    assert.equal(config.engine_data_outputs.design_issue_number, 'metadata.engine_data.design_agent.issue_number');
    const systemTaskPatch = config.flow_step_patches.find((patch) => patch.step_type === 'system_task');
    assert.equal(systemTaskPatch.merge.flow_step_settings.params.issue_number, '{{outputs.issue_number}}', `${taskId} patches deterministic label task with the source issue number`);
  }

  for (const taskId of ['static-store-site', 'static-website-site']) {
    const config = plan.tasks.find((task) => task.task_id === taskId).executor.config;
    assert.match(config.prompt, /design-direction issue #\{\{outputs\.design_issue_number\}\}/, `${taskId} receives design issue number`);
    assert.match(config.prompt, /PR title, branch, static-sites directory, and Closes reference must derive from concept issue/, `${taskId} protects source concept identity`);
    assert.match(config.prompt, /PR title must preserve the full source concept title after removing only one leading emoji\/icon marker/, `${taskId} preserves full source concept title for PR title`);
    assert.match(config.prompt, /missing the concept sections Recommended Concept, Who It Serves, What It Offers, and Why It Could Work/, `${taskId} rejects corrupted concepts`);
  }

  const staticPipeline = JSON.parse(await readFile(path.join(repoRoot, 'bundles/static-site-agent/pipelines/static-site-pipeline.json'), 'utf8'));
  const staticAiStep = staticPipeline.steps.find((step) => step.step_type === 'ai');
  assert.match(staticAiStep.step_config.system_prompt, /preserve the remaining title text verbatim/, 'static agent preserves full source concept title text');
  assert.match(staticAiStep.step_config.system_prompt, /full source concept title without its leading emoji\/icon marker/, 'static agent PR title formula keeps full source concept title');

  const loopWorkflow = await readFile(path.join(repoRoot, '.github/workflows/site-generation-loop.yml'), 'utf8');
  assert.match(loopWorkflow, /actions:\s+write/, 'site generation loop can dispatch validation workflows');
  assert.match(loopWorkflow, /dispatch-static-validation\.mjs/, 'site generation loop dispatches static validation for generated PRs');

  const validationWorkflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
  assert.match(validationWorkflow, /workflow_dispatch:[\s\S]*pr_number:/, 'static validation supports explicit PR dispatch');
  assert.match(validationWorkflow, /gh pr diff "\$PR_NUMBER"/, 'static validation detects changed sites from dispatched PR number');
  assert.match(validationWorkflow, /build-static-validation-settings\.mjs/, 'static validation delegates Homeboy settings to the shared adapter');

  const validationSettings = await readFile(path.join(repoRoot, '.github/scripts/build-static-validation-settings.mjs'), 'utf8');
  assert.match(validationSettings, /block-artifact-compiler[\s\S]*block-format-bridge[\s\S]*static-site-importer/, 'static validation installs BAC, BFB, then SSI');
  assert.match(validationSettings, /block-format-bridge/, 'static validation installs Block Format Bridge before Static Site Importer');

  const visualParity = await readFile(path.join(repoRoot, '.github/scripts/static-visual-parity.mjs'), 'utf8');
  assert.match(visualParity, /block-artifact-compiler[\s\S]*block-format-bridge[\s\S]*static-site-importer/, 'visual parity recipe installs BAC, BFB, then SSI');
  assert.match(visualParity, /block-format-bridge/, 'visual parity recipe installs Block Format Bridge before Static Site Importer');

  const pluginShim = await readFile(path.join(repoRoot, 'wp-site-generator.php'), 'utf8');
  assert.match(pluginShim, /Plugin Name:\s*WP Site Generator CI Fixture/, 'repo exposes a plugin header for Homeboy bench component mounting');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('homeboy site generation plan smoke passed');
