import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createHomeboyCompileLoopFixture(tempDir) {
	const homeboyFixturePath = path.join(tempDir, 'homeboy-compile-loop-fixture.mjs');
	await writeFile(homeboyFixturePath, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.join(' ') === 'agent-task compile-loop --help') {
  console.log('Compile a declarative loop definition into an agent-task plan.');
  process.exit(0);
}
const definitionArgIndex = args.indexOf('--definition');
if (args[0] !== 'agent-task' || args[1] !== 'compile-loop' || definitionArgIndex === -1) {
  console.error('unsupported fixture command: ' + args.join(' '));
  process.exit(64);
}
const definitionPath = args[definitionArgIndex + 1].replace(/^@/, '');
const definition = JSON.parse(readFileSync(definitionPath, 'utf8'));
const output_dependencies = {};
for (const task of definition.tasks || []) {
  if ((task.depends_on || []).length > 0 || Object.keys(task.bindings || {}).length > 0) {
    output_dependencies[task.task_id] = {
      depends_on: task.depends_on || [],
      bindings: task.bindings || {},
    };
  }
}
console.log(JSON.stringify({
  schema: 'homeboy/agent-task-plan/v1',
  plan_id: definition.plan_id || definition.loop_id,
  group_key: definition.group_key,
  tasks: (definition.tasks || []).map((task) => task.request),
  output_dependencies,
  options: definition.options || {},
  metadata: {
    ...(definition.metadata || {}),
    source_schema: definition.schema,
    loop_id: definition.loop_id,
  },
}));
`);
	await chmod(homeboyFixturePath, 0o755);
	return homeboyFixturePath;
}
