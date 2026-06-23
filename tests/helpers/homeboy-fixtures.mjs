import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createHomeboyControllerContractFixture(tempDir) {
	const homeboyFixturePath = path.join(tempDir, 'homeboy-controller-fixture.mjs');
	await writeFile(homeboyFixturePath, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
let runner = '';
const args = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === '--runner') {
    runner = rawArgs[index + 1] || '';
    index += 1;
    continue;
  }
  args.push(rawArgs[index]);
}
if (process.env.HOMEBOY_FIXTURE_EXPECT_RUNNER && runner !== process.env.HOMEBOY_FIXTURE_EXPECT_RUNNER) {
  console.error('expected runner ' + process.env.HOMEBOY_FIXTURE_EXPECT_RUNNER + ', got ' + runner);
  process.exit(64);
}
if (args.join(' ') === 'agent-task controller --help') {
  console.log('Create, inspect, and resume durable multi-agent loop controller state');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller from-spec --help') {
  console.log('Initialize or resume a durable loop controller from a repo-authored JSON spec');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller run-from-spec --help') {
  console.log('Materialize, initialize, and run a bounded controller loop from a repo-authored JSON spec\\n--output <PATH> Write structured result JSON to PATH');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller materialize --help') {
  console.log('Materialize a repo-authored loop spec with explicit run inputs');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller validate-proof --help') {
  console.log('Validate a proof, materialized spec, or controller record');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller resume --help') {
  console.log('Execute pending controller actions until no executable action remains');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller events --help') {
  console.log('Apply a generic external controller event');
  process.exit(0);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'from-spec') {
  const specPath = args[3].replace(/^@/, '');
  const outputIndex = args.indexOf('--output');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const loopId = String(spec.loop_id || 'wp-site-generator/static-site-generation-loop').replaceAll('/', '_');
  const result = {
    schema: 'homeboy/agent-task-loop-controller-from-spec-result/v1',
    loop_id: loopId,
    initialized: true,
    controller: {
      schema: 'homeboy/agent-task-loop-controller/v1',
      loop_id: loopId,
      source_loop_id: spec.loop_id,
      state: 'running',
      spec,
      pending_actions: (spec.workflows || []).map((workflow, index) => ({
        action_id: 'action-' + (index + 1),
        dedupe_key: 'workflow:' + workflow.workflow_id,
        status: 'pending',
      })),
    },
  };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'run-from-spec') {
  const specPath = args[3].replace(/^@/, '');
  const inputsIndex = args.indexOf('--inputs');
  const outputIndex = args.indexOf('--output');
  if (process.env.HOMEBOY_FIXTURE_REQUIRE_OUTPUT === '1' && outputIndex === -1) {
    console.error('run-from-spec fixture requires --output');
    process.exit(64);
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const runInputs = inputsIndex === -1 ? {} : JSON.parse(readFileSync(args[inputsIndex + 1].replace(/^@/, ''), 'utf8'));
  const explicitInputs = runInputs.inputs || (runInputs.metadata ? null : runInputs);
  if (explicitInputs && typeof explicitInputs === 'object') {
    if (explicitInputs.loop_id) {
      spec.loop_id = explicitInputs.loop_id;
    }
    for (const workflow of spec.workflows || []) {
      workflow.inputs = { ...(workflow.inputs || {}), ...explicitInputs };
    }
  }
  if (runInputs.metadata && typeof runInputs.metadata === 'object') {
    spec.metadata = { ...(spec.metadata || {}), ...runInputs.metadata };
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--policy-result') {
      continue;
    }
    const policyResult = JSON.parse(readFileSync(args[index + 1].replace(/^@/, ''), 'utf8'));
    const policyId = policyResult.policy_id;
    for (const workflow of spec.workflows || []) {
      workflow.inputs = { ...(workflow.inputs || {}) };
      if (policyResult.policy_inputs) {
        workflow.inputs.policy_inputs = { ...(workflow.inputs.policy_inputs || {}), [policyId]: policyResult.policy_inputs };
      }
      if (policyResult.policy_results) {
        workflow.inputs.policy_results = { ...(workflow.inputs.policy_results || {}), [policyId]: policyResult.policy_results };
      }
    }
    spec.metadata = { ...(spec.metadata || {}) };
    spec.metadata.policy_materialization = {
      ...(spec.metadata.policy_materialization || {}),
      [policyId]: {
        policy_inputs: policyResult.policy_inputs || {},
        policy_results: policyResult.policy_results || {},
        provenance: policyResult.provenance || {},
      },
    };
  }
  const loopId = String(spec.loop_id || 'wp-site-generator/static-site-generation-loop').replaceAll('/', '_');
  const materialization = {
    schema: 'homeboy/agent-task-loop-spec-materialization/v1',
    spec,
  };
  const result = {
    schema: 'homeboy/agent-task-loop-controller-run-from-spec-result/v1',
    loop_id: loopId,
    max_actions: Number(args[args.indexOf('--max-actions') + 1] || 1),
    stopped_reason: 'idle',
    materialization,
    from_spec: {
      schema: 'homeboy/agent-task-loop-controller-from-spec-result/v1',
      loop_id: loopId,
      initialized: true,
    },
    results: [],
    status: {
      schema: 'homeboy/agent-task-loop-controller-status/v1',
      loop_id: loopId,
      state: 'waiting',
    },
  };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  if (process.env.HOMEBOY_FIXTURE_GIANT_STDOUT === '1') {
    console.log('not-json:' + 'x'.repeat(1024 * 1024 + 1));
  } else {
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'materialize') {
  const specPath = args[3].replace(/^@/, '');
  const inputsIndex = args.indexOf('--inputs');
  const outputIndex = args.indexOf('--output');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const runInputs = inputsIndex === -1 ? {} : JSON.parse(readFileSync(args[inputsIndex + 1].replace(/^@/, ''), 'utf8'));
  const explicitInputs = runInputs.inputs || (runInputs.metadata ? null : runInputs);
  if (explicitInputs && typeof explicitInputs === 'object') {
    if (explicitInputs.loop_id) {
      spec.loop_id = explicitInputs.loop_id;
    }
    for (const workflow of spec.workflows || []) {
      workflow.inputs = { ...(workflow.inputs || {}), ...explicitInputs };
    }
  }
  if (runInputs.metadata && typeof runInputs.metadata === 'object') {
    spec.metadata = { ...(spec.metadata || {}), ...runInputs.metadata };
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--policy-result') {
      continue;
    }
    const policyResult = JSON.parse(readFileSync(args[index + 1].replace(/^@/, ''), 'utf8'));
    const policyId = policyResult.policy_id;
    for (const workflow of spec.workflows || []) {
      workflow.inputs = { ...(workflow.inputs || {}) };
      if (policyResult.policy_inputs) {
        workflow.inputs.policy_inputs = { ...(workflow.inputs.policy_inputs || {}), [policyId]: policyResult.policy_inputs };
      }
      if (policyResult.policy_results) {
        workflow.inputs.policy_results = { ...(workflow.inputs.policy_results || {}), [policyId]: policyResult.policy_results };
      }
    }
    spec.metadata = { ...(spec.metadata || {}) };
    spec.metadata.policy_materialization = {
      ...(spec.metadata.policy_materialization || {}),
      [policyId]: {
        policy_inputs: policyResult.policy_inputs || {},
        policy_results: policyResult.policy_results || {},
        provenance: policyResult.provenance || {},
      },
    };
  }
  const materialization = {
    schema: 'homeboy/agent-task-loop-spec-materialization/v1',
    spec,
  };
  const result = {
    success: true,
    data: materialization,
  };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'validate-proof') {
  const value = JSON.parse(readFileSync(args[3].replace(/^@/, ''), 'utf8'));
  const diagnostics = [];
  if (value.schema !== 'homeboy/agent-task-loop-spec-materialization/v1' || !value.spec) {
    diagnostics.push({ code: 'materialized_spec_missing', message: 'proof validation input must be an unwrapped materialized controller spec' });
  }
  const result = { schema: 'homeboy/proof-validation/v1', valid: diagnostics.length === 0, diagnostics };
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'resume') {
  const outputIndex = args.indexOf('--output');
  const result = { schema: 'homeboy/agent-task-loop-controller-resume-result/v1', loop_id: args[3], state: 'waiting', executed_actions: [] };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'events') {
  const outputIndex = args.indexOf('--output');
  const eventTypeIndex = args.indexOf('--event-type');
  const result = { schema: 'homeboy/agent-task-loop-controller-event-result/v1', loop_id: args[3], event_type: args[eventTypeIndex + 1], applied: true };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}
console.error('unsupported fixture command: ' + args.join(' '));
process.exit(64);
`);
	await chmod(homeboyFixturePath, 0o755);
	return homeboyFixturePath;
}
