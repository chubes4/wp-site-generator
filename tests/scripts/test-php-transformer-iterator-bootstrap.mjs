import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const bootstrap = await readFile(path.join(repoRoot, 'tests/playground-ci/workloads/php-transformer-iterator-bootstrap.php'), 'utf8');

assert.match(
	bootstrap,
	/WPSG_RUNTIME_PUBLISH_ABILITY/,
	'source PR callbacks resolve publish ability through a generic runtime override',
);
assert.doesNotMatch(
	bootstrap,
	/workspace_clone|workspace_worktree_add|create_github_pull_request|create_github_issue/,
	'bootstrap leaves routine workspace and upstream action tools to run-scoped ability_tools',
);
assert.match(
	bootstrap,
	/function extract_iterator_marker/,
	'bootstrap can reuse model-supplied iterator markers',
);
assert.match(
	bootstrap,
	/function build_iterator_marker/,
	'bootstrap can derive stable fallback iterator markers from job evidence',
);
assert.match(
	bootstrap,
	/\$parameters\['mode'\]\s*=\s*'update_existing'/,
	'source PR callbacks update an existing managed comment instead of posting duplicates',
);
assert.match(
	bootstrap,
	/comment_github_pull_request/,
	'agent-facing tool name remains stable for completion assertions',
);
console.log('php-transformer-iterator bootstrap smoke passed');
