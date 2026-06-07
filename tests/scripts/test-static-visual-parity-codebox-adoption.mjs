import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const script = await readFile(path.join(repoRoot, '.github/scripts/static-visual-parity.mjs'), 'utf8');
const workflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');

assert.match(script, /command:\s*'wordpress\.visual-compare'/, 'visual parity uses the generic WP Codebox visual compare command');
assert.match(script, /copyFile\(path\.join\(codeboxVisualDir, 'candidate\.png'\), importedPath\)/, 'candidate screenshot is normalized to the existing imported.png artifact');
assert.doesNotMatch(script, /from 'playwright'/, 'WPSG no longer owns browser screenshot capture');
assert.doesNotMatch(script, /from 'pixelmatch'/, 'WPSG no longer owns low-level PNG diffing');
assert.doesNotMatch(script, /from 'pngjs'/, 'WPSG no longer owns PNG normalization');

assert.match(workflow, /repository: Automattic\/wp-codebox/, 'validation workflow checks out WP Codebox');
assert.match(workflow, /npm run build/, 'validation workflow builds the WP Codebox CLI before visual compare');
assert.doesNotMatch(workflow, /npm install --no-save --prefix "\$PWD"[^\n]*(?:playwright|pixelmatch|pngjs)/, 'validation workflow no longer installs duplicated visual diff libraries');

console.log('static visual parity WP Codebox adoption smoke passed');
