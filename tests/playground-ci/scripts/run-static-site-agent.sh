#!/usr/bin/env bash
#
# Manual CI path: import and run the static-site-agent in WordPress
# Playground against a single supplied status:idea-ready issue, capture the
# resulting static-site PR URL, and fail closed if no upstream PR is opened.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-static-site-agent-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/static-site-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
STATIC_SITE_AGENT_OPENAI_MODEL="${STATIC_SITE_AGENT_OPENAI_MODEL:-gpt-5.5}"
STATIC_SITE_AGENT_TARGET_REPO="${STATIC_SITE_AGENT_TARGET_REPO:-chubes4/wp-site-generator}"
STATIC_SITE_AGENT_ISSUE_NUMBER="${STATIC_SITE_AGENT_ISSUE_NUMBER:-}"

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: static-site-agent bundle not found at $BUNDLE_SOURCE" >&2
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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wp-site-generator-static-site-agent.XXXXXX")
RUNTIME_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wp-site-generator-homeboy-runtime.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-static-site-agent-probe.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/static-site-agent"
TRANSCRIPT_ARTIFACT_DIR="$COMPONENT_PATH/artifacts/static-site-agent"

cleanup() {
    rm -f "$RESULTS_TMPFILE" "$COMPONENT_WORKLOAD"
    rm -rf "$RUNTIME_DIR"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

rm -rf "$TRANSCRIPT_ARTIFACT_DIR"
mkdir -p "$TRANSCRIPT_ARTIFACT_DIR"

cat > "$RUNTIME_DIR/bench-helper.sh" <<'SH'
#!/usr/bin/env bash
homeboy_write_empty_bench_results() {
    printf '{"component":"%s","iterations":%s,"scenarios":[]}' "$1" "$2" > "$3"
}
SH

cat > "$RUNTIME_DIR/bench-helper.php" <<'PHP'
<?php
function homeboy_bench_percentile(array $sorted_values, float $p): float {
    $n = count($sorted_values);
    if ($n === 0) {
        return 0.0;
    }
    if ($n === 1) {
        return (float) $sorted_values[0];
    }
    $rank = $p * ($n - 1);
    $lo = (int) floor($rank);
    $hi = (int) ceil($rank);
    if ($lo === $hi) {
        return (float) $sorted_values[$lo];
    }
    $frac = $rank - $lo;
    return (float) ($sorted_values[$lo] * (1 - $frac) + $sorted_values[$hi] * $frac);
}
function homeboy_bench_scenario_id(string $basename): string {
    $name = preg_replace('/\.[^.]+$/', '', $basename);
    $name = preg_replace('/([a-z0-9])([A-Z])/', '$1-$2', $name);
    $name = strtolower($name);
    $name = preg_replace('/[^a-z0-9]+/', '-', $name);
    return trim($name, '-');
}
function homeboy_write_bench_results(string $results_path, string $component_id, int $iterations, array $scenarios): void {
    file_put_contents($results_path, json_encode([
        'component_id' => $component_id,
        'iterations' => $iterations,
        'scenarios' => $scenarios,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}
function homeboy_write_empty_bench_results(string $results_path, string $component_id, int $iterations = 0): void {
    homeboy_write_bench_results($results_path, $component_id, $iterations, []);
}
PHP

cp "$WORKLOAD_PATH" "$COMPONENT_WORKLOAD"
mkdir -p "$COMPONENT_PATH/bundles"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

SETTINGS_JSON=$(jq -nc \
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
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_warmup_iterations: 0,
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            STATIC_SITE_AGENT_OPENAI_MODEL: $model,
            STATIC_SITE_AGENT_TARGET_REPO: $targetRepo,
            STATIC_SITE_AGENT_ISSUE_NUMBER: $issueNumber,
            STATIC_SITE_AGENT_TRANSCRIPT_DIR: "/wordpress/wp-content/plugins/wp-site-generator-ci-driver/artifacts/static-site-agent"
        },
        playground_workloads: [
            {
                id: "dm-static-site-agent",
                label: "Run imported static-site-agent for one supplied issue",
                run: [
                    { type: "php", file: "dm-static-site-agent-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "static-site-agent CI"
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
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wp-site-generator-ci-driver \
HOMEBOY_COMPONENT_PATH="$COMPONENT_PATH" \
HOMEBOY_DEPENDENCY_GITHUB_ORG=Extra-Chill \
HOMEBOY_WORDPRESS_DEPENDENCY_PATHS="$AGENTS_API_PATH
$DM_PATH
$DMC_PATH
$OPENAI_PROVIDER_PATH" \
HOMEBOY_EXTENSION_PATH="$EXTENSION_PATH" \
HOMEBOY_RUNTIME_BENCH_HELPER_SH="$RUNTIME_DIR/bench-helper.sh" \
HOMEBOY_RUNTIME_BENCH_HELPER_PHP="$RUNTIME_DIR/bench-helper.php" \
HOMEBOY_SETTINGS_JSON="$SETTINGS_JSON" \
    bash "$EXTENSION_PATH/scripts/bench/bench-runner.sh"

if [ ! -s "$RESULTS_TMPFILE" ]; then
    echo "ERROR: results file empty or missing at $RESULTS_TMPFILE" >&2
    exit 1
fi

echo ""
echo "--- Results envelope ---"
cat "$RESULTS_TMPFILE"
echo ""

scenario='.scenarios[] | select(.id == "dm-static-site-agent")'
import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
static_site_pr_url=$(jq -r "$scenario | .metadata.static_site_pr_url // \"\"" "$RESULTS_TMPFILE")
static_site_branch=$(jq -r "$scenario | .metadata.static_site_branch // \"\"" "$RESULTS_TMPFILE")
static_site_slug=$(jq -r "$scenario | .metadata.static_site_slug // \"\"" "$RESULTS_TMPFILE")
total_tokens=$(jq -r "$scenario | (.metadata.token_usage | if type == \"object\" then .total_tokens else 0 end) // 0" "$RESULTS_TMPFILE")
transcript_json_path=$(jq -r "$scenario | .metadata.transcript_artifacts.json // \"\"" "$RESULTS_TMPFILE")
transcript_summary_path=$(jq -r "$scenario | .metadata.transcript_artifacts.summary // \"\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "static-site-agent summary"
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
    echo "static-site-agent PASSED — opened $static_site_pr_url"
    exit 0
fi

echo "static-site-agent FAILED - see envelope above"
exit 1
