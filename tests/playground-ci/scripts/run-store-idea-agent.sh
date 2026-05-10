#!/usr/bin/env bash
#
# Production CI path: import and run the store-idea-agent in WordPress
# Playground, publish one real store-concept GitHub issue, and fail closed if
# the issue publish tool does not produce a URL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
BUNDLE_SOURCE="$REPO_ROOT/bundles/store-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
WC_IDEA_AGENT_OPENAI_MODEL="${WC_IDEA_AGENT_OPENAI_MODEL:-gpt-5.5}"
WC_IDEA_AGENT_TARGET_REPO="${WC_IDEA_AGENT_TARGET_REPO:-chubes4/wp-site-generator}"
WC_IDEA_AGENT_PROMPT="${WC_IDEA_AGENT_PROMPT:-Industry: open. Generate one distinct, buildable store concept for an underserved but visually interesting product category. Treat this as a production idea run; pick a concept that produces a strong homepage and product catalog when built downstream.}"
WC_IDEA_AGENT_SYSTEM_PROMPT=$(cat <<'PROMPT'
You are the Store Idea Agent running inside WordPress Playground.

Call the github_issue_publish tool exactly once. Do not call any other tools. Do not mention secrets.

Create one distinct, buildable WooCommerce store concept in the configured repository for an underserved but visually interesting product category. Use the user's industry prompt as the concept lane. Do not author implementation artifacts. Do not open pull requests or branches.

Issue title shape: shopping-cart emoji, then the concept name, an em dash, and a one-line summary.

Issue body sections, in this order: Recommended Concept; Who It Serves; What It Sells; Why It Could Work; Issue Overlap Check; Next Step.

Use Next Step: move forward unless the concept obviously overlaps with a recent issue. Use only labels supplied by the publish handler configuration.
PROMPT
)

if [ ! -f "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" ]; then
    echo "ERROR: Homeboy Data Machine agent runner not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: store-idea-agent bundle not found" >&2
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

if [ -z "$WC_IDEA_AGENT_TARGET_REPO" ] || [[ "$WC_IDEA_AGENT_TARGET_REPO" != */* ]]; then
    echo "ERROR: WC_IDEA_AGENT_TARGET_REPO must be owner/repo" >&2
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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wp-site-generator-idea-agent.XXXXXX")
CONFIG_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wp-site-generator-idea-agent-config.XXXXXX")
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/store-idea-agent"

cleanup() {
    rm -f "$RESULTS_TMPFILE" "$CONFIG_TMPFILE"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

mkdir -p "$COMPONENT_PATH/bundles"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

jq -nc \
    --arg componentPath "$COMPONENT_PATH" \
    --arg agentsApi "$AGENTS_API_PATH" \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    --arg openaiProvider "$OPENAI_PROVIDER_PATH" \
    --arg githubToken "$GITHUB_TOKEN" \
    --arg openaiKey "$OPENAI_API_KEY" \
    --arg model "$WC_IDEA_AGENT_OPENAI_MODEL" \
    --arg targetRepo "$WC_IDEA_AGENT_TARGET_REPO" \
    --arg prompt "$WC_IDEA_AGENT_PROMPT" \
    --arg systemPrompt "$WC_IDEA_AGENT_SYSTEM_PROMPT" \
    '{
        component_id: "wp-site-generator-ci-driver",
        component_path: $componentPath,
        workload_id: "dm-store-idea-agent",
        workload_label: "Run imported store-idea-agent and publish a concept issue",
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_warmup_iterations: 0,
        bundle_path: "/wordpress/wp-content/plugins/wp-site-generator-ci-driver/bundles/store-idea-agent",
        agent_slug: "store-idea-agent",
        pipeline_slug: "store-idea-pipeline",
        flow_slug: "store-idea-manual-flow",
        provider: "openai",
        model: $model,
        provider_register_function: "WordPress\\OpenAiAiProvider\\register_provider",
        provider_credentials: {
            connectors_ai_openai_api_key: "OPENAI_API_KEY"
        },
        github_token_env: "GITHUB_TOKEN",
        github_profile_id: "store-idea-agent-ci",
        target_repo: $targetRepo,
        allowed_repos: [$targetRepo],
        max_turns: 6,
        prompt: $prompt,
        pipeline_step_patches: [
            {
                step_type: "ai",
                set: {
                    system_prompt: $systemPrompt
                }
            }
        ],
        step_budget: 8,
        time_budget_ms: 180000,
        tool_recorders: [
            {
                tool: "github_issue_publish",
                record: {
                    engine_key: "wc_idea_agent",
                    fields: {
                        issue_url: ["data.html_url", "data.issue_url", "response.html_url", "response.issue_url"],
                        issue_number: ["data.issue_number", "data.number", "response.issue_number", "response.number"],
                        title: ["data.title", "response.title"],
                        repo: ["data.repo", "parameters.repo"]
                    },
                    event: {
                        key: "published_issue",
                        type: "github_issue",
                        only_if_success: true
                    }
                }
            }
        ],
        flow_step_patches: [
            {
                step_type: "publish",
                set: {
                    enabled: false
                },
                merge: {
                    handler_configs: {
                        github_issue: {
                            repo: $targetRepo,
                            labels: "status:idea-ready"
                        }
                    },
                    handler_slugs: ["github_issue"]
                }
            }
        ],
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            WC_IDEA_AGENT_OPENAI_MODEL: $model,
            WC_IDEA_AGENT_TARGET_REPO: $targetRepo,
            WC_IDEA_AGENT_PROMPT: $prompt
        }
    }' > "$CONFIG_TMPFILE"

echo "============================================"
echo "store-idea-agent CI"
echo "============================================"
echo "Target repo:  $WC_IDEA_AGENT_TARGET_REPO"
echo "OpenAI model: $WC_IDEA_AGENT_OPENAI_MODEL"
echo "Prompt:       $WC_IDEA_AGENT_PROMPT"
echo "Agents API:   $AGENTS_API_PATH"
echo ""

GITHUB_TOKEN="$GITHUB_TOKEN" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
WC_IDEA_AGENT_OPENAI_MODEL="$WC_IDEA_AGENT_OPENAI_MODEL" \
WC_IDEA_AGENT_TARGET_REPO="$WC_IDEA_AGENT_TARGET_REPO" \
WC_IDEA_AGENT_PROMPT="$WC_IDEA_AGENT_PROMPT" \
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_DEPENDENCY_GITHUB_ORG=Extra-Chill \
HOMEBOY_EXTENSION_PATH="$EXTENSION_PATH" \
    bash "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" "$CONFIG_TMPFILE"

if [ ! -s "$RESULTS_TMPFILE" ]; then
    echo "ERROR: results file empty or missing at $RESULTS_TMPFILE" >&2
    exit 1
fi

cat "$RESULTS_TMPFILE"

scenario='.scenarios[] | select(.id == "dm-store-idea-agent")'
import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
issue_url=$(jq -r "$scenario | .metadata.engine_data.wc_idea_agent.issue_url // .metadata.engine_data.wc_idea_agent.published_issue.url // \"\"" "$RESULTS_TMPFILE")
issue_number=$(jq -r "$scenario | .metadata.engine_data.wc_idea_agent.issue_number // .metadata.engine_data.wc_idea_agent.published_issue.number // \"\"" "$RESULTS_TMPFILE")
total_tokens=$(jq -r "$scenario | (.metadata.token_usage | if type == \"object\" then .total_tokens else 0 end) // 0" "$RESULTS_TMPFILE")

echo "============================================"
echo "store-idea-agent summary"
echo "============================================"
printf '%-32s %s\n' "import-agent succeeded:" "$import_resolved"
printf '%-32s %s\n' "run-flow succeeded:" "$run_resolved"
printf '%-32s %s\n' "drain-job succeeded:" "$drain_resolved"
printf '%-32s %s\n' "Persisted job status:" "$job_status"
printf '%-32s %s\n' "Idea issue URL:" "$issue_url"
printf '%-32s %s\n' "Idea issue number:" "$issue_number"
printf '%-32s %s\n' "OpenAI total tokens:" "$total_tokens"
echo ""

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "idea_issue_url=$issue_url"
        echo "idea_issue_number=$issue_number"
    } >> "$GITHUB_OUTPUT"
fi

if [ "$import_resolved" = "true" ] \
    && [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && [ "$job_status" = "completed" ] \
    && [ -n "$issue_url" ]; then
    echo "store-idea-agent PASSED - opened $issue_url"
    exit 0
fi

echo "store-idea-agent FAILED - see envelope above"
exit 1
