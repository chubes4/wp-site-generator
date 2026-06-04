#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const repository = process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const outputPath = process.env.HOMEBOY_PLAN_PATH || path.join(root, '.ci', 'site-generation-loop.agent-task-plan.json');

const ci = (name) => path.join(root, '.ci', name);
const wpCodeboxBin = process.env.HOMEBOY_WP_CODEBOX_BIN || path.join(ci('wp-codebox'), 'packages', 'cli', 'dist', 'index.js');
const artifactsRoot = process.env.HOMEBOY_ARTIFACT_ROOT || path.join(root, '.ci', 'homeboy-agent-task-artifacts');

function engineDataPath(engineKey, field) {
  return `/metadata/codebox/datamachine/workload/scenarios/0/metadata/engine_data/${engineKey}/${field}`;
}

function datamachineConfig({
  bundle,
  agent,
  pipeline,
  flow,
  prompt = '',
  successRequiresPr = false,
  successCompletionOutcomes = [],
  maxTurns,
  stepBudget,
  timeBudgetMs,
  flowStepPatches = [],
  toolRecorders = [],
  engineDataOutputs = {},
  transcriptArtifactName,
}) {
  const config = {
    execution_kind: 'datamachine_bundle',
    provider: 'openai',
    model,
    provider_plugin_paths: [ci('ai-provider-for-openai')],
    agents_api: ci('agents-api'),
    data_machine: ci('data-machine'),
    data_machine_code: ci('data-machine-code'),
    homeboy_extensions: path.join(ci('homeboy-extensions'), 'wordpress'),
    wp_codebox_bin: wpCodeboxBin,
    bundle_host_path: path.join(root, bundle),
    bundle_path: `/workspace/wp-site-generator/${bundle}`,
    agent_slug: agent,
    pipeline_slug: pipeline,
    flow_slug: flow,
    target_repo: repository,
    prompt,
    success_requires_pr: successRequiresPr,
    success_completion_outcomes: successCompletionOutcomes,
    flow_step_patches: flowStepPatches,
    tool_recorders: toolRecorders,
    engine_data_outputs: engineDataOutputs,
    transcript_artifact_name: transcriptArtifactName,
    secret_env: ['OPENAI_API_KEY', 'GITHUB_TOKEN'],
    artifacts: path.join(artifactsRoot, agent, transcriptArtifactName || flow),
  };

  if (maxTurns) {
    config.max_turns = maxTurns;
  }
  if (stepBudget) {
    config.step_budget = stepBudget;
  }
  if (timeBudgetMs) {
    config.time_budget_ms = timeBudgetMs;
    config.task_timeout_seconds = Math.ceil(timeBudgetMs / 1000) + 300;
  }

  return config;
}

function task({ id, title, config, instructions, expectedArtifacts = ['datamachine-transcript'] }) {
  return {
    schema: 'homeboy/agent-task-request/v1',
    task_id: id,
    group_key: 'site-generation-loop',
    parent_plan_id: `site-generation-loop-${runId}`,
    executor: {
      backend: 'codebox',
      model,
      config,
    },
    instructions,
    inputs: { title },
    limits: {
      task_timeout_seconds: config.task_timeout_seconds || 900,
    },
    expected_artifacts: expectedArtifacts,
  };
}

function issueFetchPatch(issueNumberTemplate) {
  return [
    {
      step_type: 'fetch',
      merge: {
        handler_configs: {
          github: {
            issue_number: issueNumberTemplate,
            max_items: 1,
          },
        },
      },
    },
  ];
}

const issueRecorder = (engineKey) => [
  {
    tool: 'github_issue_publish',
    record: {
      engine_key: engineKey,
      fields: {
        issue_url: 'data.issue_url',
        issue_number: 'data.issue_number',
      },
    },
  },
];

const prRecorder = [
  {
    tool: 'github_pull_request_publish',
    record: {
      tool_results_key: 'github_tool_results',
      engine_key: 'static_site_agent',
      fields: {
        pr_url: 'data.html_url',
        branch: 'data.head',
        slug: {
          paths: ['data.head'],
          strip_prefix: 'static/',
        },
      },
    },
  },
];

const plan = {
  schema: 'homeboy/agent-task-plan/v1',
  plan_id: `site-generation-loop-${runId}`,
  tasks: [
    task({
      id: 'store-idea-agent',
      title: 'Generate store idea',
      instructions: 'Generate one store concept issue for the site-generation loop.',
      config: datamachineConfig({
        bundle: 'bundles/store-idea-agent',
        agent: 'store-idea-agent',
        pipeline: 'store-idea-pipeline',
        flow: 'store-idea-home-and-craft-flow',
        prompt: ' ',
        successRequiresPr: false,
        maxTurns: 6,
        stepBudget: 8,
        timeBudgetMs: 180000,
        toolRecorders: issueRecorder('store_idea_agent'),
        engineDataOutputs: {
          issue_url: 'metadata.engine_data.store_idea_agent.issue_url',
          issue_number: 'metadata.engine_data.store_idea_agent.issue_number',
        },
        transcriptArtifactName: `store-idea-agent-transcript-${runId}`,
      }),
    }),
    task({
      id: 'website-idea-agent',
      title: 'Generate website idea',
      instructions: 'Generate one website concept issue for the site-generation loop.',
      config: datamachineConfig({
        bundle: 'bundles/website-idea-agent',
        agent: 'website-idea-agent',
        pipeline: 'website-idea-pipeline',
        flow: 'website-idea-local-business-flow',
        prompt: ' ',
        successRequiresPr: false,
        toolRecorders: issueRecorder('website_idea_agent'),
        engineDataOutputs: {
          issue_url: 'metadata.engine_data.website_idea_agent.issue_url',
          issue_number: 'metadata.engine_data.website_idea_agent.issue_number',
        },
        transcriptArtifactName: `website-idea-agent-transcript-${runId}`,
      }),
    }),
    task({
      id: 'design-store-issue',
      title: 'Design store issue #{{outputs.issue_number}}',
      instructions: 'Decide one visual design direction for GitHub issue #{{outputs.issue_number}}. Read the concept body, post the design.json fenced JSON block as a comment, and toggle the issue label from status:idea-ready to status:design-ready using surgical add_label_to_issue and remove_label_from_issue tool calls. Preserve every other label.',
      config: datamachineConfig({
        bundle: 'bundles/design-agent',
        agent: 'design-agent',
        pipeline: 'design-pipeline',
        flow: 'design-manual-flow',
        prompt: 'Decide one visual design direction for GitHub issue #{{outputs.issue_number}}. Read the concept body, post the design.json fenced JSON block as a comment, and toggle the issue label from status:idea-ready to status:design-ready using surgical add_label_to_issue and remove_label_from_issue tool calls. Preserve every other label.',
        successRequiresPr: false,
        successCompletionOutcomes: ['design_comment_and_labels'],
        flowStepPatches: issueFetchPatch('{{outputs.issue_number}}'),
        transcriptArtifactName: `design-agent-store-{{outputs.issue_number}}-transcript-${runId}`,
      }),
    }),
    task({
      id: 'design-website-issue',
      title: 'Design website issue #{{outputs.issue_number}}',
      instructions: 'Decide one visual design direction for GitHub issue #{{outputs.issue_number}}. Read the concept body, post the design.json fenced JSON block as a comment, and toggle the issue label from status:idea-ready to status:design-ready using surgical add_label_to_issue and remove_label_from_issue tool calls. Preserve every other label.',
      config: datamachineConfig({
        bundle: 'bundles/design-agent',
        agent: 'design-agent',
        pipeline: 'design-pipeline',
        flow: 'design-manual-flow',
        prompt: 'Decide one visual design direction for GitHub issue #{{outputs.issue_number}}. Read the concept body, post the design.json fenced JSON block as a comment, and toggle the issue label from status:idea-ready to status:design-ready using surgical add_label_to_issue and remove_label_from_issue tool calls. Preserve every other label.',
        successRequiresPr: false,
        successCompletionOutcomes: ['design_comment_and_labels'],
        flowStepPatches: issueFetchPatch('{{outputs.issue_number}}'),
        transcriptArtifactName: `design-agent-website-{{outputs.issue_number}}-transcript-${runId}`,
      }),
    }),
    task({
      id: 'static-store-site',
      title: 'Build store site for issue #{{outputs.issue_number}}',
      instructions: 'Implement GitHub issue #{{outputs.issue_number}} as a static site. Read the issue body and the design agent comment, honor both, and open exactly one static-site PR for that issue.',
      expectedArtifacts: ['datamachine-transcript', 'datamachine-pull-request'],
      config: datamachineConfig({
        bundle: 'bundles/static-site-agent',
        agent: 'static-site-agent',
        pipeline: 'static-site-pipeline',
        flow: 'static-site-manual-flow',
        prompt: 'Implement GitHub issue #{{outputs.issue_number}} as a static site. Read the issue body and the design agent comment, honor both, and open exactly one static-site PR for that issue.',
        successRequiresPr: true,
        successCompletionOutcomes: ['static_site_pr'],
        flowStepPatches: issueFetchPatch('{{outputs.issue_number}}'),
        toolRecorders: prRecorder,
        engineDataOutputs: {
          static_site_pr_url: 'metadata.engine_data.static_site_agent.pr_url',
          static_site_branch: 'metadata.engine_data.static_site_agent.branch',
          static_site_slug: 'metadata.engine_data.static_site_agent.slug',
        },
        transcriptArtifactName: `static-site-agent-store-{{outputs.issue_number}}-transcript-${runId}`,
      }),
    }),
    task({
      id: 'static-website-site',
      title: 'Build website site for issue #{{outputs.issue_number}}',
      instructions: 'Implement GitHub issue #{{outputs.issue_number}} as a static site. Read the issue body and the design agent comment, honor both, and open exactly one static-site PR for that issue.',
      expectedArtifacts: ['datamachine-transcript', 'datamachine-pull-request'],
      config: datamachineConfig({
        bundle: 'bundles/static-site-agent',
        agent: 'static-site-agent',
        pipeline: 'static-site-pipeline',
        flow: 'static-site-manual-flow',
        prompt: 'Implement GitHub issue #{{outputs.issue_number}} as a static site. Read the issue body and the design agent comment, honor both, and open exactly one static-site PR for that issue.',
        successRequiresPr: true,
        successCompletionOutcomes: ['static_site_pr'],
        flowStepPatches: issueFetchPatch('{{outputs.issue_number}}'),
        toolRecorders: prRecorder,
        engineDataOutputs: {
          static_site_pr_url: 'metadata.engine_data.static_site_agent.pr_url',
          static_site_branch: 'metadata.engine_data.static_site_agent.branch',
          static_site_slug: 'metadata.engine_data.static_site_agent.slug',
        },
        transcriptArtifactName: `static-site-agent-website-{{outputs.issue_number}}-transcript-${runId}`,
      }),
    }),
  ],
  output_dependencies: {
    'design-store-issue': {
      bindings: {
        issue_number: {
          task_id: 'store-idea-agent',
          path: engineDataPath('store_idea_agent', 'issue_number'),
          required: true,
        },
      },
    },
    'design-website-issue': {
      bindings: {
        issue_number: {
          task_id: 'website-idea-agent',
          path: engineDataPath('website_idea_agent', 'issue_number'),
          required: true,
        },
      },
    },
    'static-store-site': {
      depends_on: ['design-store-issue'],
      bindings: {
        issue_number: {
          task_id: 'store-idea-agent',
          path: engineDataPath('store_idea_agent', 'issue_number'),
          required: true,
        },
      },
    },
    'static-website-site': {
      depends_on: ['design-website-issue'],
      bindings: {
        issue_number: {
          task_id: 'website-idea-agent',
          path: engineDataPath('website_idea_agent', 'issue_number'),
          required: true,
        },
      },
    },
  },
  options: {
    max_concurrency: 2,
    resource_budget: {
      max_active_units: 2,
      default_task_units: 1,
    },
    retry: {
      max_attempts: 0,
    },
  },
  metadata: {
    source: 'wp-site-generator site-generation-loop',
    generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(outputPath);
