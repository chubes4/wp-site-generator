#!/usr/bin/env bash
#
# Manual CI path: import and run the php-transformer-iterator-agent in
# WordPress Playground with grouped SSI finding packets as its input.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-php-transformer-iterator-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/php-transformer-iterator-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
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

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-php-transformer-iterator.XXXXXX")
RUNTIME_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wc-site-generator-homeboy-runtime.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-php-transformer-iterator-probe.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/php-transformer-iterator-agent"

# Validate the host-side finding groups payload (compact via jq doubles as
# a JSON syntax check) before forwarding it through Homeboy's bench_env
# seam. The bench_env value travels as raw JSON; Extra-Chill/homeboy-extensions#448
# escapes sed metacharacters in the replacement string so JSON escapes
# (`\"`) and `&` no longer corrupt the bench_env block during template
# substitution.
FINDING_GROUPS_JSON="$(jq -c . "$ITERATOR_FINDING_GROUPS_PATH")"

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
    '{
        validation_dependencies: [$dm, $dmc, $openaiProvider],
        playground_wordpress_version: "7.0",
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            OPENAI_API_KEY: $openaiKey,
            ITERATOR_OPENAI_MODEL: $model,
            ITERATOR_SOURCE_REPO: $sourceRepo,
            ITERATOR_SOURCE_PR: $sourcePr,
            ITERATOR_SOURCE_HEAD_SHA: $sourceHeadSha,
            ITERATOR_VALIDATION_RUN_ID: $validationRunId,
            ITERATOR_FINDING_GROUPS_JSON: $findingGroupsJson
        },
        playground_workloads: [
            {
                id: "dm-php-transformer-iterator",
                label: "Run imported PHP transformer iterator agent",
                run: [
                    { type: "php", file: "dm-php-transformer-iterator-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "PHP transformer iterator: run imported agent"
echo "============================================"
echo "Source repo:       $ITERATOR_SOURCE_REPO"
echo "Source PR:         $ITERATOR_SOURCE_PR"
echo "Validation run ID: $ITERATOR_VALIDATION_RUN_ID"
echo "OpenAI model:      $ITERATOR_OPENAI_MODEL"
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
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wc-site-generator-ci-driver \
HOMEBOY_COMPONENT_PATH="$COMPONENT_PATH" \
HOMEBOY_DEPENDENCY_GITHUB_ORG=Extra-Chill \
HOMEBOY_WORDPRESS_DEPENDENCY_PATHS="$DM_PATH
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

cat "$RESULTS_TMPFILE"

scenario='.scenarios[] | select(.id == "dm-php-transformer-iterator")'
import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
upstream_action_url=$(jq -r "$scenario | .metadata.upstream_action_url // \"\"" "$RESULTS_TMPFILE")
source_callback_url=$(jq -r "$scenario | .metadata.source_callback_url // \"\"" "$RESULTS_TMPFILE")

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
