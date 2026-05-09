#!/usr/bin/env bash
#
# Manual CI path: import and run the wc-static-site-agent in WordPress
# Playground against a single supplied status:idea-ready issue, capture the
# resulting static-site PR URL, and fail closed if no upstream PR is opened.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
BOOTSTRAP_WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/wc-static-site-agent-bootstrap.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/wc-static-site-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
STATIC_SITE_AGENT_OPENAI_MODEL="${STATIC_SITE_AGENT_OPENAI_MODEL:-gpt-5.5}"
STATIC_SITE_AGENT_TARGET_REPO="${STATIC_SITE_AGENT_TARGET_REPO:-chubes4/wc-site-generator}"
STATIC_SITE_AGENT_ISSUE_NUMBER="${STATIC_SITE_AGENT_ISSUE_NUMBER:-}"

if [ ! -f "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: wc-static-site-agent bundle not found at $BUNDLE_SOURCE" >&2
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
    echo "ERROR: jq required" >&2
    exit 1
fi

if ! [[ "$STATIC_SITE_AGENT_ISSUE_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: STATIC_SITE_AGENT_ISSUE_NUMBER must be a positive integer (got: '$STATIC_SITE_AGENT_ISSUE_NUMBER')" >&2
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

CONFIG_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-static-site-agent-config.XXXXXX.json")
RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-static-site-agent-results.XXXXXX.json")
COMPONENT_BOOTSTRAP_WORKLOAD="$COMPONENT_PATH/wc-static-site-agent-bootstrap.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/wc-static-site-agent"
TRANSCRIPT_ARTIFACT_DIR="$COMPONENT_PATH/artifacts/wc-static-site-agent"

cleanup() {
    rm -f "$CONFIG_TMPFILE" "$RESULTS_TMPFILE" "$COMPONENT_BOOTSTRAP_WORKLOAD"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

rm -rf "$TRANSCRIPT_ARTIFACT_DIR"
mkdir -p "$TRANSCRIPT_ARTIFACT_DIR"

cp "$BOOTSTRAP_WORKLOAD_PATH" "$COMPONENT_BOOTSTRAP_WORKLOAD"
mkdir -p "$COMPONENT_PATH/bundles"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

jq -n \
    --arg componentPath "$COMPONENT_PATH" \
    --arg agentsApi "$AGENTS_API_PATH" \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    --arg openaiProvider "$OPENAI_PROVIDER_PATH" \
    --arg githubToken "$GITHUB_TOKEN" \
    --arg openaiKey "$OPENAI_API_KEY" \
    --arg model "$STATIC_SITE_AGENT_OPENAI_MODEL" \
    --arg targetRepo "$STATIC_SITE_AGENT_TARGET_REPO" \
    --arg issueNumber "$STATIC_SITE_AGENT_ISSUE_NUMBER" \
    '{
        component_id: "wc-site-generator-ci-driver",
        component_path: $componentPath,
        workload_id: "dm-wc-static-site-agent",
        workload_label: "Run imported wc-static-site-agent for one supplied issue",
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_warmup_iterations: 0,
        bundle_path: "/wordpress/wp-content/plugins/wc-site-generator-ci-driver/bundles/wc-static-site-agent",
        agent_slug: "wc-static-site-agent",
        pipeline_slug: "wc-static-site-pipeline",
        flow_slug: "wc-static-site-manual-flow",
        provider: "openai",
        model: $model,
        provider_register_function: "WordPress\\OpenAiAiProvider\\register_provider",
        provider_credentials: { connectors_ai_openai_api_key: "OPENAI_API_KEY" },
        github_token_env: "GITHUB_TOKEN",
        github_profile_id: "wc-static-site-agent-ci",
        target_repo: $targetRepo,
        allowed_repos: [$targetRepo],
        max_turns: 12,
        prompt: "Run the static site agent for the supplied issue.",
        step_budget: 20,
        time_budget_ms: 600000,
        transcript_dir: "/wordpress/wp-content/plugins/wc-site-generator-ci-driver/artifacts/wc-static-site-agent",
        flow_step_patches: [
            {
                step_type: "fetch",
                merge: {
                    handler_config: { data_source: "issues", repo: $targetRepo, state: "open", issue_number: $issueNumber, max_items: 1 },
                    handler_configs: { github: { data_source: "issues", repo: $targetRepo, state: "open", issue_number: $issueNumber, max_items: 1 } }
                }
            },
            {
                step_type: "publish",
                set: { handler_slugs: ["github_pull_request"] },
                merge: { handler_configs: { github_pull_request: { base: "main", draft: false, labels: "target:static-site", maintainer_can_modify: false, repo: $targetRepo } } }
            }
        ],
        tool_recorders: [
            {
                tool: "github_pull_request_publish",
                record: {
                    engine_key: "wc_static_site_agent",
                    fields: {
                        success: ["response.success"],
                        static_site_pr_url: ["data.html_url"],
                        static_site_branch: ["data.head", "parameters.head"],
                        static_site_slug: { paths: ["data.head", "parameters.head"], strip_prefix: "static/" },
                        repo: ["data.repo", "parameters.repo"],
                        pull_number: ["data.pull_number"],
                        title: ["data.title", "parameters.title"],
                        error: ["response.error"]
                    }
                }
            }
        ],
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            STATIC_SITE_AGENT_OPENAI_MODEL: $model,
            STATIC_SITE_AGENT_TARGET_REPO: $targetRepo,
            STATIC_SITE_AGENT_ISSUE_NUMBER: $issueNumber,
            STATIC_SITE_AGENT_TRANSCRIPT_DIR: "/wordpress/wp-content/plugins/wc-site-generator-ci-driver/artifacts/wc-static-site-agent"
        },
        workload_run_before: [
            { type: "php", file: "wc-static-site-agent-bootstrap.php" }
        ]
    }' > "$CONFIG_TMPFILE"

echo "============================================"
echo "wc-static-site-agent CI"
echo "============================================"
echo "Target repo:    $STATIC_SITE_AGENT_TARGET_REPO"
echo "Issue number:   $STATIC_SITE_AGENT_ISSUE_NUMBER"
echo "OpenAI model:   $STATIC_SITE_AGENT_OPENAI_MODEL"
echo "Agents API:     $AGENTS_API_PATH"
echo ""

GITHUB_TOKEN="$GITHUB_TOKEN" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
STATIC_SITE_AGENT_OPENAI_MODEL="$STATIC_SITE_AGENT_OPENAI_MODEL" \
STATIC_SITE_AGENT_TARGET_REPO="$STATIC_SITE_AGENT_TARGET_REPO" \
STATIC_SITE_AGENT_ISSUE_NUMBER="$STATIC_SITE_AGENT_ISSUE_NUMBER" \
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_DEPENDENCY_GITHUB_ORG=Extra-Chill \
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

scenario='.scenarios[] | select(.id == "dm-wc-static-site-agent")'
import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
static_site_pr_url=$(jq -r "$scenario | .metadata.engine_data.wc_static_site_agent.static_site_pr_url // \"\"" "$RESULTS_TMPFILE")
static_site_branch=$(jq -r "$scenario | .metadata.engine_data.wc_static_site_agent.static_site_branch // \"\"" "$RESULTS_TMPFILE")
static_site_slug=$(jq -r "$scenario | .metadata.engine_data.wc_static_site_agent.static_site_slug // \"\"" "$RESULTS_TMPFILE")
total_tokens=$(jq -r "$scenario | (.metadata.token_usage | if type == \"object\" then .total_tokens else 0 end) // 0" "$RESULTS_TMPFILE")
transcript_json_path=$(jq -r "$scenario | .metadata.transcript_artifacts | if type == \"object\" then (.json // \"\") else \"\" end" "$RESULTS_TMPFILE")
transcript_summary_path=""

echo "============================================"
echo "wc-static-site-agent summary"
echo "============================================"
printf '%-32s %s\n' "import-agent succeeded:" "$import_resolved"
printf '%-32s %s\n' "run-flow succeeded:" "$run_resolved"
printf '%-32s %s\n' "drain-job succeeded:" "$drain_resolved"
printf '%-32s %s\n' "Persisted job status:" "$job_status"
printf '%-32s %s\n' "Static-site PR URL:" "$static_site_pr_url"
printf '%-32s %s\n' "Static-site branch:" "$static_site_branch"
printf '%-32s %s\n' "Static-site slug:" "$static_site_slug"
printf '%-32s %s\n' "OpenAI total tokens:" "$total_tokens"
printf '%-32s %s\n' "Transcript JSON:" "$transcript_json_path"
printf '%-32s %s\n' "Transcript summary:" "$transcript_summary_path"
echo ""

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "static_site_pr_url=$static_site_pr_url"
        echo "static_site_branch=$static_site_branch"
        echo "static_site_slug=$static_site_slug"
        echo "transcript_json_path=$transcript_json_path"
        echo "transcript_summary_path=$transcript_summary_path"
    } >> "$GITHUB_OUTPUT"
fi

if [ "$import_resolved" = "true" ] \
    && [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && [ "$job_status" = "completed" ] \
    && [ -n "$static_site_pr_url" ]; then
    echo "wc-static-site-agent PASSED — opened $static_site_pr_url"
    exit 0
fi

echo "wc-static-site-agent FAILED - see envelope above"
exit 1
