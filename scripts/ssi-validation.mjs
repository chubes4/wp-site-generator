#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

const sites = argValue('--sites')
  .split(',')
  .map((site) => site.trim())
  .filter(Boolean);
const output = argValue('--output', 'ssi-validation-report.md');

const metrics = {
  importer_core_html_block_count: 'pending',
  importer_freeform_block_count: 'pending',
  importer_fallback_count: 'pending',
  importer_invalid_block_count: 'pending',
  editor_validation_invalid_blocks: 'pending',
  visual_editor_vs_source_pixel_diff_ratio: 'pending',
  visual_editor_vs_frontend_pixel_diff_ratio: 'pending',
  semantic_mismatch_count: 'pending',
};

const lines = [
  '## SSI validation',
  '',
  'Static-site lane detected. This scaffold is wired to run only for PRs labeled `target:static-site` with `static-sites/**` changes.',
  '',
  `Changed static sites: ${sites.length ? sites.map((site) => `\`${site}\``).join(', ') : '_none_'}`,
  '',
  '### Telemetry contract',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  ...Object.entries(metrics).map(([key, value]) => `| \`${key}\` | ${value} |`),
  '',
  '### Next implementation step',
  '',
  'Replace this scaffold with the Homeboy WordPress SSI runner that imports each changed `static-sites/<slug>/` directory through Static Site Importer, packages the imported WordPress site for Playground, uploads artifacts, and posts the replayable Playground link plus metrics here.',
];

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${lines.join('\n')}\n`);
console.log(`Wrote ${output}`);
