import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createHomeboyControllerFixture(tempDir) {
	const homeboyFixturePath = path.join(tempDir, 'homeboy-controller-fixture.mjs');
	await writeFile(homeboyFixturePath, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.join(' ') === 'agent-task controller --help') {
  console.log('Create, inspect, and resume durable multi-agent loop controller state');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller from-spec --help') {
  console.log('Initialize or resume a durable loop controller from a repo-authored JSON spec');
  process.exit(0);
}
if (args.join(' ') === 'agent-task controller materialize --help') {
  console.log('Materialize a repo-authored loop spec with explicit run inputs');
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
if (args[0] === 'agent-task' && args[1] === 'controller' && args[2] === 'materialize') {
  const specPath = args[3].replace(/^@/, '');
  const inputsIndex = args.indexOf('--inputs');
  const outputIndex = args.indexOf('--output');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const runInputs = inputsIndex === -1 ? {} : JSON.parse(readFileSync(args[inputsIndex + 1].replace(/^@/, ''), 'utf8'));
  const explicitInputs = runInputs.inputs || (runInputs.metadata ? null : runInputs);
  if (explicitInputs && typeof explicitInputs === 'object') {
    for (const workflow of spec.workflows || []) {
      workflow.inputs = { ...(workflow.inputs || {}), ...explicitInputs };
    }
  }
  if (runInputs.metadata && typeof runInputs.metadata === 'object') {
    spec.metadata = { ...(spec.metadata || {}), ...runInputs.metadata };
  }
  const result = {
    schema: 'homeboy/agent-task-loop-spec-materialization/v1',
    spec,
  };
  if (outputIndex !== -1) {
    writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2) + '\\n');
  }
  console.log(JSON.stringify(result));
  process.exit(0);
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
