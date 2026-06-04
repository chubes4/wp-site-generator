#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const repository = process.env.GITHUB_REPOSITORY || 'chubes4/wp-site-generator';
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const outputPath = process.env.HOMEBOY_PLAN_PATH || path.join(root, '.ci', 'site-generation-loop.agent-task-plan.json');
const manualTaskKind = process.env.HOMEBOY_TASK_KIND || '';
const planId = manualTaskKind ? `site-generator-${manualTaskKind}-${runId}` : `site-generation-loop-${runId}`;
const groupKey = manualTaskKind ? `site-generator-${manualTaskKind}` : 'site-generation-loop';

const ci = (name) => path.join(root, '.ci', name);
const wpCodeboxBin = process.env.HOMEBOY_WP_CODEBOX_BIN || path.join(ci('wp-codebox'), 'packages', 'cli', 'dist', 'index.js');
const artifactsRoot = process.env.HOMEBOY_ARTIFACT_ROOT || path.join(root, '.ci', 'homeboy-agent-task-artifacts');

function taskOutputPath(field) {
  return `/outputs/${field}`;
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
    group_key: groupKey,
    parent_plan_id: planId,
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

function storeIdeaTask({ id = 'store-idea-agent', flow = 'store-idea-home-and-craft-flow', prompt = ' ', title = 'Generate store idea' } = {}) {
  return task({
    id,
    title,
    instructions: 'Generate one store concept issue.',
    config: datamachineConfig({
      bundle: 'bundles/store-idea-agent',
      agent: 'store-idea-agent',
      pipeline: 'store-idea-pipeline',
      flow,
      prompt,
      successRequiresPr: false,
      maxTurns: 6,
      stepBudget: 8,
      timeBudgetMs: 180000,
      toolRecorders: issueRecorder('store_idea_agent'),
      engineDataOutputs: {
        issue_url: 'metadata.engine_data.store_idea_agent.issue_url',
        issue_number: 'metadata.engine_data.store_idea_agent.issue_number',
      },
      transcriptArtifactName: `${id}-transcript-${runId}`,
    }),
  });
}

function websiteIdeaTask({ id = 'website-idea-agent', flow = 'website-idea-local-business-flow', prompt = '', title = 'Generate website idea' } = {}) {
  return task({
    id,
    title,
    instructions: 'Generate one website concept issue.',
    config: datamachineConfig({
      bundle: 'bundles/website-idea-agent',
      agent: 'website-idea-agent',
      pipeline: 'website-idea-pipeline',
      flow,
      prompt,
      successRequiresPr: false,
      toolRecorders: issueRecorder('website_idea_agent'),
      engineDataOutputs: {
        issue_url: 'metadata.engine_data.website_idea_agent.issue_url',
        issue_number: 'metadata.engine_data.website_idea_agent.issue_number',
      },
      transcriptArtifactName: `${id}-transcript-${runId}`,
    }),
  });
}

function designTask({ id, issueNumber, title }) {
  const prompt = `Decide one visual design direction for GitHub issue #${issueNumber}. Read the concept body, post the design.json fenced JSON block as a comment, and toggle the issue label from status:idea-ready to status:design-ready using surgical add_label_to_issue and remove_label_from_issue tool calls. Preserve every other label.`;
  return task({
    id,
    title,
    instructions: prompt,
    config: datamachineConfig({
      bundle: 'bundles/design-agent',
      agent: 'design-agent',
      pipeline: 'design-pipeline',
      flow: 'design-manual-flow',
      prompt,
      successRequiresPr: false,
      successCompletionOutcomes: ['design_comment_and_labels'],
      flowStepPatches: issueFetchPatch(issueNumber),
      transcriptArtifactName: `${id}-transcript-${runId}`,
    }),
  });
}

function staticSiteTask({ id, issueNumber, title }) {
  const prompt = `Implement GitHub issue #${issueNumber} as a static site. Read the issue body and the design agent comment, honor both, and open exactly one static-site PR for that issue.`;
  return task({
    id,
    title,
    instructions: prompt,
    expectedArtifacts: ['datamachine-transcript', 'datamachine-pull-request'],
    config: datamachineConfig({
      bundle: 'bundles/static-site-agent',
      agent: 'static-site-agent',
      pipeline: 'static-site-pipeline',
      flow: 'static-site-manual-flow',
      prompt,
      successRequiresPr: true,
      successCompletionOutcomes: ['static_site_pr'],
      flowStepPatches: issueFetchPatch(issueNumber),
      toolRecorders: prRecorder,
      engineDataOutputs: {
        static_site_pr_url: 'metadata.engine_data.static_site_agent.pr_url',
        static_site_branch: 'metadata.engine_data.static_site_agent.branch',
        static_site_slug: 'metadata.engine_data.static_site_agent.slug',
      },
      transcriptArtifactName: `${id}-transcript-${runId}`,
    }),
  });
}

function manualPlan() {
  const conceptPrompt = process.env.CONCEPT_PROMPT || '';
  const issueNumber = process.env.ISSUE_NUMBER || '';
  const websiteFlow = process.env.WEBSITE_FLOW_SLUG || 'website-idea-local-business-flow';
  const taskByKind = {
    store_idea: () => storeIdeaTask({ id: 'store-idea-agent', flow: 'store-idea-manual-flow', prompt: conceptPrompt, title: 'Generate store idea' }),
    website_idea: () => websiteIdeaTask({ id: 'website-idea-agent', flow: websiteFlow, prompt: conceptPrompt, title: 'Generate website idea' }),
    design: () => designTask({ id: 'design-agent', issueNumber, title: `Design issue #${issueNumber}` }),
    static_site: () => staticSiteTask({ id: 'static-site-agent', issueNumber, title: `Build site for issue #${issueNumber}` }),
  };

  if (!taskByKind[manualTaskKind]) {
    throw new Error(`Unsupported HOMEBOY_TASK_KIND: ${manualTaskKind}`);
  }
  if ((manualTaskKind === 'design' || manualTaskKind === 'static_site') && !/^[1-9][0-9]*$/.test(issueNumber)) {
    throw new Error(`ISSUE_NUMBER must be a positive integer for ${manualTaskKind}.`);
  }

  return {
    schema: 'homeboy/agent-task-plan/v1',
    plan_id: planId,
    tasks: [taskByKind[manualTaskKind]()],
    options: {
      max_concurrency: 1,
      resource_budget: {
        max_active_units: 1,
        default_task_units: 1,
      },
      retry: {
        max_attempts: 0,
      },
    },
    metadata: {
      source: 'wp-site-generator manual agent task',
      task_kind: manualTaskKind,
      generated_by: '.github/scripts/build-homeboy-site-generation-plan.mjs',
    },
  };
}

const loopPlan = {
  schema: 'homeboy/agent-task-plan/v1',
  plan_id: planId,
  tasks: [
    storeIdeaTask({ prompt: ' ', title: 'Generate store idea' }),
    websiteIdeaTask({ prompt: ' ', title: 'Generate website idea' }),
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
          path: taskOutputPath('issue_number'),
          required: true,
        },
      },
    },
    'design-website-issue': {
      bindings: {
        issue_number: {
          task_id: 'website-idea-agent',
          path: taskOutputPath('issue_number'),
          required: true,
        },
      },
    },
    'static-store-site': {
      depends_on: ['design-store-issue'],
      bindings: {
        issue_number: {
          task_id: 'store-idea-agent',
          path: taskOutputPath('issue_number'),
          required: true,
        },
      },
    },
    'static-website-site': {
      depends_on: ['design-website-issue'],
      bindings: {
        issue_number: {
          task_id: 'website-idea-agent',
          path: taskOutputPath('issue_number'),
          required: true,
        },
      },
    },
  },
  options: {
    max_concurrency: 1,
    resource_budget: {
      max_active_units: 1,
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

const plan = manualTaskKind ? manualPlan() : loopPlan;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(outputPath);
