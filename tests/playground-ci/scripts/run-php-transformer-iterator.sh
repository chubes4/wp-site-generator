#!/usr/bin/env bash
#
# Manual CI path: import and run the php-transformer-iterator-agent in
# WordPress Playground with grouped SSI finding packets as its input.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
BOOTSTRAP_WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/php-transformer-iterator-bootstrap.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/php-transformer-iterator-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
ITERATOR_OPENAI_MODEL="${ITERATOR_OPENAI_MODEL:-gpt-5.5}"
ITERATOR_SOURCE_REPO="${ITERATOR_SOURCE_REPO:-chubes4/wc-site-generator}"
ITERATOR_SOURCE_PR="${ITERATOR_SOURCE_PR:-}"
ITERATOR_SOURCE_HEAD_SHA="${ITERATOR_SOURCE_HEAD_SHA:-}"
ITERATOR_VALIDATION_RUN_ID="${ITERATOR_VALIDATION_RUN_ID:-}"
ITERATOR_FINDING_GROUPS_PATH="${ITERATOR_FINDING_GROUPS_PATH:-}"

if [ ! -f "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: php-transformer-iterator-agent bundle not found at $BUNDLE_SOURCE" >&2
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
if [ -z "$ITERATOR_FINDING_GROUPS_PATH" ] || [ ! -s "$ITERATOR_FINDING_GROUPS_PATH" ]; then
    echo "ERROR: ITERATOR_FINDING_GROUPS_PATH must point to grouped finding JSON" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq required" >&2
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

CONFIG_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-php-transformer-iterator-config.XXXXXX.json")
RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-php-transformer-iterator-results.XXXXXX.json")
COMPONENT_BOOTSTRAP_WORKLOAD="$COMPONENT_PATH/php-transformer-iterator-bootstrap.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/php-transformer-iterator-agent"
ITERATOR_TRANSCRIPT_DIR="${ITERATOR_TRANSCRIPT_DIR:-$REPO_ROOT/.ci/php-transformer-iterator-transcripts}"

# Validate the host-side finding groups payload (compact via jq doubles as
# a JSON syntax check) before forwarding it through Homeboy's bench_env
# seam. The bench_env value travels as raw JSON; Extra-Chill/homeboy-extensions#448
# escapes sed metacharacters in the replacement string so JSON escapes
# (`\"`) and `&` no longer corrupt the bench_env block during template
# substitution.
FINDING_GROUPS_JSON="$(jq -c . "$ITERATOR_FINDING_GROUPS_PATH")"

cleanup() {
    rm -f "$CONFIG_TMPFILE" "$RESULTS_TMPFILE" "$COMPONENT_BOOTSTRAP_WORKLOAD"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

cp "$BOOTSTRAP_WORKLOAD_PATH" "$COMPONENT_BOOTSTRAP_WORKLOAD"
mkdir -p "$COMPONENT_PATH/bundles"
mkdir -p "$ITERATOR_TRANSCRIPT_DIR"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

ITERATOR_PROMPT=$(jq -n \
    --arg sourceRepo "$ITERATOR_SOURCE_REPO" \
    --arg sourcePr "$ITERATOR_SOURCE_PR" \
    --arg sourceHeadSha "$ITERATOR_SOURCE_HEAD_SHA" \
    --arg validationRunId "$ITERATOR_VALIDATION_RUN_ID" \
    --argjson findingGroups "$FINDING_GROUPS_JSON" \
    '{
        source_repo: $sourceRepo,
        source_pr: $sourcePr,
        source_head_sha: $sourceHeadSha,
        validation_run_id: $validationRunId,
        finding_groups: $findingGroups
    }' | sed '1s/^/Run the PHP transformer iterator now.\n\n/')

jq -n \
    --arg componentPath "$COMPONENT_PATH" \
    --arg agentsApi "$AGENTS_API_PATH" \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    --arg openaiProvider "$OPENAI_PROVIDER_PATH" \
    --arg githubToken "$GITHUB_TOKEN" \
    --arg openaiKey "$OPENAI_API_KEY" \
    --arg model "$ITERATOR_OPENAI_MODEL" \
    --arg sourceRepo "$ITERATOR_SOURCE_REPO" \
    --arg sourcePr "$ITERATOR_SOURCE_PR" \
    --arg sourceHeadSha "$ITERATOR_SOURCE_HEAD_SHA" \
    --arg validationRunId "$ITERATOR_VALIDATION_RUN_ID" \
    --arg findingGroupsJson "$FINDING_GROUPS_JSON" \
    --arg transcriptDir "$ITERATOR_TRANSCRIPT_DIR" \
    --arg prompt "$ITERATOR_PROMPT" \
    '{
        component_id: "wc-site-generator-ci-driver",
        component_path: $componentPath,
        workload_id: "dm-php-transformer-iterator",
        workload_label: "Run imported PHP transformer iterator agent",
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_warmup_iterations: 0,
        bundle_path: "/wordpress/wp-content/plugins/wc-site-generator-ci-driver/bundles/php-transformer-iterator-agent",
        agent_slug: "php-transformer-iterator-agent",
        pipeline_slug: "php-transformer-iterator-pipeline",
        flow_slug: "php-transformer-iterator-manual-flow",
        provider: "openai",
        model: $model,
        provider_register_function: "WordPress\\OpenAiAiProvider\\register_provider",
        provider_credentials: {
            connectors_ai_openai_api_key: "OPENAI_API_KEY"
        },
        github_token_env: "GITHUB_TOKEN",
        github_profile_id: "php-transformer-iterator-ci",
        target_repo: $sourceRepo,
        allowed_repos: [
            $sourceRepo,
            "chubes4/static-site-importer",
            "chubes4/html-to-blocks-converter",
            "chubes4/block-format-bridge",
            "chubes4/wc-site-generator"
        ],
        max_turns: 24,
        prompt: $prompt,
        step_budget: 20,
        time_budget_ms: 600000,
        transcript_dir: $transcriptDir,
        ability_tools: [
            { name: "workspace_clone", ability: "datamachine/workspace-clone", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_worktree_add", ability: "datamachine/workspace-worktree-add", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_read", ability: "datamachine/workspace-read", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_write", ability: "datamachine/workspace-write", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_edit", ability: "datamachine/workspace-edit", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_git_status", ability: "datamachine/workspace-git-status", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_git_commit", ability: "datamachine/workspace-git-commit", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            { name: "workspace_git_push", ability: "datamachine/workspace-git-push", record: { engine_key: "php_transformer_iterator", tool_results_key: "tool_results" } },
            {
                name: "create_github_pull_request",
                ability: "datamachine/create-github-pull-request",
                description: "Open the focused upstream transformer repair pull request after pushing the worktree branch.",
                record: {
                    engine_key: "php_transformer_iterator",
                    tool_results_key: "tool_results",
                    event: { key: "upstream_action", type: "pull_request", only_if_success: true }
                }
            },
            {
                name: "create_github_issue",
                ability: "datamachine/create-github-issue",
                description: "Fallback only: open a focused issue when no safe upstream patch path exists.",
                record: {
                    engine_key: "php_transformer_iterator",
                    tool_results_key: "tool_results",
                    event: { key: "upstream_action", type: "issue", only_if_success: true }
                }
            },
            {
                name: "comment_github_pull_request",
                ability: "datamachine/comment-github-pull-request",
                description: "Post the required callback comment on the source generated-site pull request.",
                record: {
                    engine_key: "php_transformer_iterator",
                    tool_results_key: "tool_results",
                    event: {
                        key: "source_callback",
                        type: "pull_request_comment",
                        only_if_success: true,
                        match: { repo: "ITERATOR_SOURCE_REPO", pull_number: "ITERATOR_SOURCE_PR" }
                    }
                }
            }
        ],
        required_abilities: [
            "datamachine/import-agent",
            "datamachine/run-flow",
            "datamachine/drain-job",
            "datamachine/workspace-clone",
            "datamachine/workspace-worktree-add",
            "datamachine/workspace-read",
            "datamachine/workspace-write",
            "datamachine/workspace-edit",
            "datamachine/workspace-git-status",
            "datamachine/workspace-git-commit",
            "datamachine/workspace-git-push",
            "datamachine/create-github-pull-request",
            "datamachine/create-github-issue",
            "datamachine/comment-github-pull-request"
        ],
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            ITERATOR_OPENAI_MODEL: $model,
            ITERATOR_SOURCE_REPO: $sourceRepo,
            ITERATOR_SOURCE_PR: $sourcePr,
            ITERATOR_SOURCE_HEAD_SHA: $sourceHeadSha,
            ITERATOR_VALIDATION_RUN_ID: $validationRunId,
            ITERATOR_FINDING_GROUPS_JSON: $findingGroupsJson,
            ITERATOR_TRANSCRIPT_DIR: $transcriptDir
        },
        workload_run_before: [
            { type: "php", file: "php-transformer-iterator-bootstrap.php" }
        ]
    }' > "$CONFIG_TMPFILE"

echo "============================================"
echo "PHP transformer iterator: run imported agent"
echo "============================================"
echo "Source repo:       $ITERATOR_SOURCE_REPO"
echo "Source PR:         $ITERATOR_SOURCE_PR"
echo "Validation run ID: $ITERATOR_VALIDATION_RUN_ID"
echo "OpenAI model:      $ITERATOR_OPENAI_MODEL"
echo "Agents API:        $AGENTS_API_PATH"
echo ""

GITHUB_TOKEN="$GITHUB_TOKEN" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
ITERATOR_OPENAI_MODEL="$ITERATOR_OPENAI_MODEL" \
ITERATOR_SOURCE_REPO="$ITERATOR_SOURCE_REPO" \
ITERATOR_SOURCE_PR="$ITERATOR_SOURCE_PR" \
ITERATOR_SOURCE_HEAD_SHA="$ITERATOR_SOURCE_HEAD_SHA" \
ITERATOR_VALIDATION_RUN_ID="$ITERATOR_VALIDATION_RUN_ID" \
ITERATOR_FINDING_GROUPS_JSON="$FINDING_GROUPS_JSON" \
ITERATOR_FINDING_GROUPS_PATH="$ITERATOR_FINDING_GROUPS_PATH" \
ITERATOR_TRANSCRIPT_DIR="$ITERATOR_TRANSCRIPT_DIR" \
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_DEPENDENCY_GITHUB_ORG=Extra-Chill \
HOMEBOY_EXTENSION_PATH="$EXTENSION_PATH" \
    bash "$EXTENSION_PATH/scripts/agent/run-datamachine-agent.sh" "$CONFIG_TMPFILE"

if [ ! -s "$RESULTS_TMPFILE" ]; then
    echo "ERROR: results file empty or missing at $RESULTS_TMPFILE" >&2
    exit 1
fi

cat "$RESULTS_TMPFILE"

scenario='.scenarios[] | select(.id == "dm-php-transformer-iterator")'
import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
upstream_action_url=$(jq -r "$scenario | .metadata.engine_data.php_transformer_iterator.upstream_action.url // \"\"" "$RESULTS_TMPFILE")
source_callback_url=$(jq -r "$scenario | .metadata.engine_data.php_transformer_iterator.source_callback.url // \"\"" "$RESULTS_TMPFILE")

if [ "$import_resolved" = "true" ] \
    && [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && [ "$job_status" = "completed" ] \
    && [ -n "$upstream_action_url" ] \
    && [ -n "$source_callback_url" ]; then
    echo "PHP transformer iterator PASSED"
    exit 0
fi

echo "PHP transformer iterator FAILED - see envelope above"
exit 1
