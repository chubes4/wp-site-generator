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
const ref = argValue('--ref', 'main');
const output = argValue('--output', 'ssi-validation-report.md');

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function playgroundUrl(site) {
  const blueprint = {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    landingPage: '/',
    preferredVersions: {
      php: '8.3',
      wp: 'latest',
    },
    steps: [
      {
        step: 'installPlugin',
        pluginData: {
          resource: 'git:directory',
          url: 'https://github.com/chubes4/static-site-importer',
          ref: 'main',
          refType: 'branch',
        },
        options: {
          activate: true,
          targetFolderName: 'static-site-importer',
        },
      },
      {
        step: 'writeFiles',
        writeToPath: '/tmp/static-site',
        filesTree: {
          resource: 'git:directory',
          url: 'https://github.com/chubes4/wc-store-blueprints',
          ref,
          refType: 'branch',
          path: `static-sites/${site}`,
        },
      },
      {
        step: 'wp-cli',
        command: `wp static-site-importer import-theme /tmp/static-site/index.html --slug=${site} --name='${titleFromSlug(site).replaceAll("'", "'\\''")}' --activate --overwrite --keep-source --format=json`,
      },
      {
        step: 'login',
        username: 'admin',
        password: 'password',
      },
    ],
  };

  const encoded = encodeURIComponent(JSON.stringify(blueprint));
  return `https://playground.wordpress.net/#${encoded}`;
}

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
  '### Playground preview',
  '',
  ...sites.flatMap((site) => [`- [Open ${titleFromSlug(site)} in Playground](${playgroundUrl(site)})`]),
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
