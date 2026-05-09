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
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-openai-issue-flow-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/wc-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
AGENTS_API_PATH="${AGENTS_API_PATH:-/Users/chubes/Developer/agents-api}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
OPENAI_PROVIDER_PATH="${OPENAI_PROVIDER_PATH:-/Users/chubes/Studio/intelligence-chubes4/wp-content/plugins/ai-provider-for-openai}"
STUDIO_SITE_PATH="${STUDIO_SITE_PATH:-/Users/chubes/Studio/intelligence-chubes4}"
STAGE5_GITHUB_REPO="${STAGE5_GITHUB_REPO:-chubes4/wc-site-generator}"
STAGE5_OPENAI_MODEL="${STAGE5_OPENAI_MODEL:-gpt-5.5}"

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-stage-5.XXXXXX")
RUNTIME_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wc-site-generator-homeboy-runtime.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-openai-issue-flow-probe.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/wc-idea-agent"

cleanup() {
    rm -f "$RESULTS_TMPFILE" "$COMPONENT_WORKLOAD"
    rm -rf "$RUNTIME_DIR"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

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

function homeboy_bench_results_envelope(string $component_id, int $iterations, array $scenarios): array {
    return [
        'component_id' => $component_id,
        'iterations' => $iterations,
        'scenarios' => $scenarios,
    ];
}

function homeboy_write_bench_results(string $results_path, string $component_id, int $iterations, array $scenarios): void {
    $json = json_encode(homeboy_bench_results_envelope($component_id, $iterations, $scenarios), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('json_encode failed: ' . json_last_error_msg());
    }
    if (file_put_contents($results_path, $json) === false) {
        throw new RuntimeException("failed to write $results_path");
    }
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
    --arg stage5Repo "$STAGE5_GITHUB_REPO" \
    --arg stage5Model "$STAGE5_OPENAI_MODEL" \
    '{
        validation_dependencies: [$agentsApi, $dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            STAGE5_GITHUB_REPO: $stage5Repo,
            STAGE5_OPENAI_MODEL: $stage5Model
        },
        playground_workloads: [
            {
                id: "dm-openai-issue-flow",
                label: "Run imported DM agent with OpenAI and publish a GitHub issue",
                run: [
                    { type: "php", file: "dm-openai-issue-flow-probe.php" }
                ]
            }
        ]
    }')

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
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wc-site-generator-ci-driver \
HOMEBOY_COMPONENT_PATH="$COMPONENT_PATH" \
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

scenario='.scenarios[] | select(.id == "dm-openai-issue-flow")'

import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
publish_resolved=$(jq -r "$scenario | if (.metadata.publish_result | type) == \"object\" then (.metadata.publish_result.success // false) else false end" "$RESULTS_TMPFILE")
issue_url=$(jq -r "$scenario | .metadata.issue_url // \"\"" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
actions_drained=$(jq -r "$scenario | .metadata.drain_result.actions_drained // 0" "$RESULTS_TMPFILE")
total_tokens=$(jq -r "$scenario | .metadata.token_usage.total_tokens // 0" "$RESULTS_TMPFILE")
err=$(jq -r "$scenario | if (.metadata.publish_result | type) == \"object\" then (.metadata.publish_result.error // .metadata.error // \"\") else (.metadata.error_message // .metadata.error // \"\") end" "$RESULTS_TMPFILE")

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
