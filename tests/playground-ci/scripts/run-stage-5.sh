#!/usr/bin/env bash
#
# Stage 5: run the imported Data Machine idea agent with a real OpenAI call.
#
# This proof crosses the remaining boundary: Playground boots WordPress, loads
# Data Machine + Data Machine Code + the OpenAI provider plugin, imports the
# wc-idea-agent bundle, injects ephemeral API credentials from bench_env, runs a
# real AI step, and publishes the AI-created GitHub issue.
#
# Refs Extra-Chill/homeboy-extensions#422

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
BOOTSTRAP_WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/wc-idea-agent-bootstrap.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/wc-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
STAGE5_GITHUB_REPO="${STAGE5_GITHUB_REPO:-chubes4/wc-site-generator}"
STAGE5_OPENAI_MODEL="${STAGE5_OPENAI_MODEL:-gpt-5.5}"

if [ ! -f "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: wc-idea-agent bundle not found at $BUNDLE_SOURCE" >&2
    exit 1
fi
if [ ! -d "$OPENAI_PROVIDER_PATH" ]; then
    echo "ERROR: AI Provider for OpenAI plugin not found at $OPENAI_PROVIDER_PATH" >&2
    exit 1
fi
if [ ! -f "$AGENTS_API_PATH/agents-api.php" ]; then
    echo "ERROR: Agents API plugin not found at $AGENTS_API_PATH" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq required for assertions" >&2
    exit 1
fi

GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$GITHUB_TOKEN" ] && command -v gh >/dev/null 2>&1; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
fi
if [ -z "$GITHUB_TOKEN" ]; then
    echo "ERROR: GITHUB_TOKEN or GH_TOKEN is required, or gh must be authenticated" >&2
    exit 1
fi

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [ -z "$OPENAI_API_KEY" ] && command -v studio >/dev/null 2>&1 && [ -d "$STUDIO_SITE_PATH" ]; then
    OPENAI_API_KEY="$(cd "$STUDIO_SITE_PATH" && studio wp option get connectors_ai_openai_api_key 2>/dev/null || true)"
fi
if [ -z "$OPENAI_API_KEY" ]; then
    echo "ERROR: OPENAI_API_KEY is required, or the local Studio site must store connectors_ai_openai_api_key" >&2
    exit 1
fi

CONFIG_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-stage-5-config.XXXXXX.json")
RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-stage-5-results.XXXXXX.json")
COMPONENT_BOOTSTRAP_WORKLOAD="$COMPONENT_PATH/wc-idea-agent-bootstrap.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/wc-idea-agent"

cleanup() {
    rm -f "$CONFIG_TMPFILE" "$RESULTS_TMPFILE" "$COMPONENT_BOOTSTRAP_WORKLOAD"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

cp "$BOOTSTRAP_WORKLOAD_PATH" "$COMPONENT_BOOTSTRAP_WORKLOAD"
mkdir -p "$COMPONENT_PATH/bundles"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

STAGE5_RUN_ID="$(date -u +%Y%m%d%H%M%S)-$RANDOM"
STAGE5_SYSTEM_PROMPT="You are running a CI proof inside WordPress Playground.

Call the github_issue_publish tool exactly once. Do not call any other tools. Do not mention secrets.

Create a concise GitHub issue in ${STAGE5_GITHUB_REPO} proving the imported Data Machine agent used a real OpenAI request from Playground.

Title must start with: [Playground proof] Stage 5 OpenAI issue ${STAGE5_RUN_ID}

Body must include these sections: Proof Path, Runtime, Verification, Cleanup. Say this issue can be closed after verification."

jq -n \
    --arg componentPath "$COMPONENT_PATH" \
    --arg agentsApi "$AGENTS_API_PATH" \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    --arg openaiProvider "$OPENAI_PROVIDER_PATH" \
    --arg githubToken "$GITHUB_TOKEN" \
    --arg openaiKey "$OPENAI_API_KEY" \
    --arg stage5Repo "$STAGE5_GITHUB_REPO" \
    --arg stage5Model "$STAGE5_OPENAI_MODEL" \
    --arg systemPrompt "$STAGE5_SYSTEM_PROMPT" \
    '{
        component_id: "wc-site-generator-ci-driver",
        component_path: $componentPath,
        workload_id: "dm-openai-issue-flow",
        workload_label: "Run imported DM agent with OpenAI and publish a GitHub issue",
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bundle_path: "/wordpress/wp-content/plugins/wc-site-generator-ci-driver/bundles/wc-idea-agent",
        agent_slug: "wc-idea-agent",
        pipeline_slug: "wc-idea-pipeline",
        flow_slug: "wc-idea-manual-flow",
        provider: "openai",
        model: $stage5Model,
        provider_register_function: "WordPress\\OpenAiAiProvider\\register_provider",
        provider_credentials: { connectors_ai_openai_api_key: "OPENAI_API_KEY" },
        github_token_env: "GITHUB_TOKEN",
        github_profile_id: "stage5-ci",
        target_repo: $stage5Repo,
        allowed_repos: [$stage5Repo],
        max_turns: 3,
        prompt: "Run Stage 5 now. Publish one CI proof issue to the configured GitHub issue publish tool.",
        step_budget: 8,
        time_budget_ms: 120000,
        pipeline_step_patches: [
            { step_type: "ai", set: { system_prompt: $systemPrompt } }
        ],
        flow_step_patches: [
            { step_type: "publish", set: { handler_slugs: ["github_issue"] }, merge: { handler_configs: { github_issue: { repo: $stage5Repo, labels: "status:idea-ready" } } } }
        ],
        tool_recorders: [
            {
                tool: "github_issue_publish",
                record: {
                    engine_key: "stage5_github_issue_publish",
                    fields: {
                        success: ["response.success"],
                        repo: ["data.repo"],
                        issue_url: ["data.issue_url"],
                        html_url: ["data.html_url"],
                        issue_number: ["data.issue_number"],
                        title: ["data.title"],
                        error: ["response.error"]
                    }
                }
            }
        ],
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            STAGE5_GITHUB_REPO: $stage5Repo,
            STAGE5_OPENAI_MODEL: $stage5Model
        },
        workload_run_before: [
            { type: "php", file: "wc-idea-agent-bootstrap.php" }
        ]
    }' > "$CONFIG_TMPFILE"

echo "============================================"
echo "Stage 5: run imported DM agent with OpenAI"
echo "============================================"
echo "Repo:         $REPO_ROOT"
echo "Driver:       $COMPONENT_PATH"
echo "Target repo:  $STAGE5_GITHUB_REPO"
echo "OpenAI model: $STAGE5_OPENAI_MODEL"
echo "Agents API:   $AGENTS_API_PATH"
echo "DM:           $DM_PATH"
echo "DMC:          $DMC_PATH"
echo "OpenAI:       $OPENAI_PROVIDER_PATH"
echo "Extension:    $EXTENSION_PATH"
echo ""

GITHUB_TOKEN="$GITHUB_TOKEN" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
STAGE5_GITHUB_REPO="$STAGE5_GITHUB_REPO" \
STAGE5_OPENAI_MODEL="$STAGE5_OPENAI_MODEL" \
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_EXTENSION_PATH="$EXTENSION_PATH" \
    bash "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" "$CONFIG_TMPFILE"

if [ ! -s "$RESULTS_TMPFILE" ]; then
    echo "ERROR: results file empty or missing at $RESULTS_TMPFILE" >&2
    exit 1
fi

echo ""
echo "--- Results envelope ---"
cat "$RESULTS_TMPFILE"
echo ""

scenario='.scenarios[] | select(.id == "dm-openai-issue-flow")'

import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
publish_resolved=$(jq -r "$scenario | .metadata.engine_data.stage5_github_issue_publish.success // false" "$RESULTS_TMPFILE")
issue_url=$(jq -r "$scenario | (.metadata.engine_data.stage5_github_issue_publish.html_url // .metadata.engine_data.stage5_github_issue_publish.issue_url // \"\")" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
actions_drained=$(jq -r "$scenario | .metadata.drain_result.actions_drained // 0" "$RESULTS_TMPFILE")
total_tokens=$(jq -r "$scenario | (.metadata.token_usage | if type == \"object\" then .total_tokens else 0 end) // 0" "$RESULTS_TMPFILE")
err=$(jq -r "$scenario | .metadata.error_message // .metadata.error // \"\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "Stage 5 summary"
echo "============================================"
printf '%-32s %s\n' "import-agent succeeded:" "$import_resolved"
printf '%-32s %s\n' "run-flow succeeded:" "$run_resolved"
printf '%-32s %s\n' "drain-job succeeded:" "$drain_resolved"
printf '%-32s %s\n' "GitHub publish succeeded:" "$publish_resolved"
printf '%-32s %s\n' "Persisted job status:" "$job_status"
printf '%-32s %s\n' "Actions drained:" "$actions_drained"
printf '%-32s %s\n' "OpenAI total tokens:" "$total_tokens"
printf '%-32s %s\n' "Issue URL:" "$issue_url"
if [ -n "$err" ] && [ "$err" != "null" ]; then
    printf '%-32s %s\n' "Error:" "$err"
fi
echo ""

if [ "$import_resolved" = "true" ] \
    && [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && [ "$publish_resolved" = "true" ] \
    && [ -n "$issue_url" ] \
    && [ "$job_status" = "completed" ] \
    && [ "$total_tokens" != "0" ]; then
    echo "Stage 5 PASSED - imported DM agent used OpenAI and published a GitHub issue inside Playground"
    exit 0
fi

echo "Stage 5 FAILED - see envelope above"
exit 1
