import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const lifecycle = await readFile(path.join(repoRoot, '.github/workflows/idea-lifecycle-labels.yml'), 'utf8');
const staticFlow = await readFile(path.join(repoRoot, 'bundles/static-site-agent/flows/static-site-manual-flow.json'), 'utf8');
const staticPipeline = await readFile(path.join(repoRoot, 'bundles/static-site-agent/pipelines/static-site-pipeline.json'), 'utf8');
const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

for (const source of [lifecycle, staticFlow, staticPipeline, readme]) {
  assert.doesNotMatch(source, /target:static-site/, 'legacy target:static-site label is not referenced');
}

assert.match(lifecycle, /target:wordpress/, 'lifecycle recognizes the WordPress target lane');
assert.match(lifecycle, /target:woocommerce/, 'lifecycle recognizes the WooCommerce target lane');
assert.match(lifecycle, /github\.event\.label\.name == 'target:wordpress'/, 'lifecycle accepts target:wordpress labeled events');
assert.match(lifecycle, /github\.event\.label\.name == 'target:woocommerce'/, 'lifecycle accepts target:woocommerce labeled events');
assert.match(staticFlow, /commerce:woocommerce[\s\S]*target:woocommerce/, 'static agent maps commerce issues to WooCommerce PRs');
assert.match(staticFlow, /commerce:none[\s\S]*target:wordpress/, 'static agent maps content issues to WordPress PRs');
assert.match(staticPipeline, /labels set to \[\\"target:woocommerce\\"\]/, 'publish call labels WooCommerce PRs');
assert.match(staticPipeline, /otherwise \[\\"target:wordpress\\"\]/, 'publish call labels WordPress PRs');
assert.doesNotMatch(staticPipeline, /products\.json|product catalog beside a storefront/, 'static agent does not nudge products.json generation');

console.log('target lane label smoke passed');
