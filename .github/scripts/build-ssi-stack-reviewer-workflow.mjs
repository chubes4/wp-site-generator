#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = new URL('../..', import.meta.url).pathname;
const outputPath = process.env.SSI_STACK_REVIEWER_WORKFLOW_PATH || process.argv[2] || '.ci/ssi-stack-reviewer-workflow.json';
const pipelinePath = process.env.SSI_STACK_REVIEWER_PIPELINE_PATH || 'bundles/ssi-stack-reviewer-agent/pipelines/ssi-stack-reviewer-pipeline.json';
const flowPath = process.env.SSI_STACK_REVIEWER_FLOW_PATH || 'bundles/ssi-stack-reviewer-agent/flows/ssi-stack-reviewer-manual-flow.json';

const upstreamPrUrl = requiredEnv('UPSTREAM_PR_URL');
const findingContext = process.env.FINDING_PACKET_CONTEXT || '';
const reviewerContext = process.env.REVIEWER_CONTEXT || '';
const sourcePrUrl = process.env.SOURCE_PR_URL || '';
const pipeline = await readJson(resolveRepoPath(pipelinePath));
const flow = await readJson(resolveRepoPath(flowPath));

const workflow = buildWorkflow(pipeline, flow);
await mkdir(path.dirname(resolveRepoPath(outputPath)), { recursive: true });
await writeFile(resolveRepoPath(outputPath), `${JSON.stringify(workflow, null, 2)}\n`);

function buildWorkflow(pipelineConfig, flowConfig) {
    const pipelineStep = pipelineConfig.steps.find((step) => step?.step_type === 'ai' || step?.step_config?.step_type === 'ai');
    const flowStep = flowConfig.steps.find((step) => step?.step_type === 'ai');
    if (!pipelineStep || !flowStep) {
        throw new Error('SSI stack reviewer bundle must contain an AI step in both pipeline and flow JSON.');
    }

    const aiConfig = pipelineStep.step_config || {};
    const promptQueue = Array.isArray(flowStep.prompt_queue) ? flowStep.prompt_queue : [];
    const userMessage = [
        ...promptQueue.map((item) => item?.prompt || '').filter(Boolean),
        formatReviewPrompt(),
    ].filter(Boolean).join('\n\n');

    return {
        workflow: {
            steps: [
                {
                    step_type: 'ai',
                    label: aiConfig.label || 'Review upstream SSI stack PR',
                    system_prompt: aiConfig.system_prompt || '',
                    prompt_queue: [
                        {
                            prompt: userMessage,
                            added_at: 'ssi-stack-reviewer-build',
                        },
                    ],
                    queue_mode: 'static',
                    enabled_tools: flowStep.enabled_tools || [],
                    disabled_tools: aiConfig.disabled_tools || flowStep.disabled_tools || [],
                    completion_assertions: aiConfig.completion_assertions || flowStep.completion_assertions || {},
                },
            ],
        },
        initial_data: {
            job_source: 'system',
            job_label: 'SSI stack reviewer gate',
            upstream_pr_url: upstreamPrUrl,
            source_pr_url: sourcePrUrl,
        },
    };
}

function formatReviewPrompt() {
    const parsedFindingContext = parseContext(findingContext);
    const parsedReviewerContext = parseContext(reviewerContext);
    return [
        'Run the SSI stack reviewer gate now.',
        `Upstream PR URL: ${upstreamPrUrl}`,
        sourcePrUrl ? `Source generated-site PR URL: ${sourcePrUrl}` : '',
        'Finding packet context:',
        formatContext(parsedFindingContext),
        reviewerContext ? 'Additional reviewer context:' : '',
        reviewerContext ? formatContext(parsedReviewerContext) : '',
        'Required comment target: the upstream PR URL above.',
        'Required comment heading: ## SSI Stack Reviewer Gate',
    ].filter(Boolean).join('\n\n');
}

function parseContext(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

function formatContext(value) {
    if (value === '') {
        return '(none supplied)';
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

function resolveRepoPath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`${name} is required`);
    }
    return value.trim();
}
