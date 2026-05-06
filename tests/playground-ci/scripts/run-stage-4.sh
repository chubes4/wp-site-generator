#!/usr/bin/env bash
#
# Stage 4: run a Data Machine flow that publishes a real GitHub issue.
#
# This is intentionally the first proof stage with an external side effect. It
# reads GITHUB_TOKEN/GH_TOKEN (or falls back to `gh auth token`), seeds the
# ephemeral Playground site's DMC GitHub settings, executes a one-step flow, and
# returns the created issue URL as workload metadata.
#
# Refs Extra-Chill/homeboy-extensions#422

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-github-issue-publish-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/wc-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"
STAGE4_GITHUB_REPO="${STAGE4_GITHUB_REPO:-chubes4/wc-site-generator}"

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: wc-idea-agent bundle not found at $BUNDLE_SOURCE" >&2
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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-store-blueprints-stage-4.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-github-issue-publish-probe.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/wc-idea-agent"

cleanup() {
    rm -f "$RESULTS_TMPFILE" "$COMPONENT_WORKLOAD"
    rm -rf "$COMPONENT_PATH/bundles"
}
trap cleanup EXIT

cp "$WORKLOAD_PATH" "$COMPONENT_WORKLOAD"
mkdir -p "$COMPONENT_PATH/bundles"
cp -R "$BUNDLE_SOURCE" "$COMPONENT_BUNDLE_DIR"

SETTINGS_JSON=$(jq -nc \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    --arg githubToken "$GITHUB_TOKEN" \
    --arg stage4Repo "$STAGE4_GITHUB_REPO" \
    '{
        validation_dependencies: [$dm, $dmc],
        bench_env: {
            GITHUB_TOKEN: $githubToken,
            STAGE4_GITHUB_REPO: $stage4Repo
        },
        playground_workloads: [
            {
                id: "dm-github-issue-publish",
                label: "Run DM flow that publishes a GitHub issue",
                run: [
                    { type: "php", file: "dm-github-issue-publish-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "Stage 4: run DM flow and publish GitHub issue"
echo "============================================"
echo "Repo:         $REPO_ROOT"
echo "Driver:       $COMPONENT_PATH"
echo "Target repo:  $STAGE4_GITHUB_REPO"
echo "DM:           $DM_PATH"
echo "DMC:          $DMC_PATH"
echo "Extension:    $EXTENSION_PATH"
echo ""

GITHUB_TOKEN="$GITHUB_TOKEN" \
STAGE4_GITHUB_REPO="$STAGE4_GITHUB_REPO" \
HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wc-store-blueprints-ci-driver \
HOMEBOY_COMPONENT_PATH="$COMPONENT_PATH" \
HOMEBOY_EXTENSION_PATH="$EXTENSION_PATH" \
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

scenario='.scenarios[] | select(.id == "dm-github-issue-publish")'

run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
publish_resolved=$(jq -r "$scenario | .metadata.publish_result.success // false" "$RESULTS_TMPFILE")
issue_url=$(jq -r "$scenario | .metadata.issue_url // \"\"" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
actions_drained=$(jq -r "$scenario | .metadata.drain_result.actions_drained // 0" "$RESULTS_TMPFILE")
run_ms=$(jq -r "$scenario | .metrics.run_elapsed_ms_p50 // 0" "$RESULTS_TMPFILE")
drain_ms=$(jq -r "$scenario | .metrics.drain_elapsed_ms_p50 // 0" "$RESULTS_TMPFILE")
err=$(jq -r "$scenario | .metadata.publish_result.error // .metadata.error // \"\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "Stage 4 summary"
echo "============================================"
printf '%-32s %s\n' "run-flow succeeded:" "$run_resolved"
printf '%-32s %s\n' "drain-job succeeded:" "$drain_resolved"
printf '%-32s %s\n' "GitHub publish succeeded:" "$publish_resolved"
printf '%-32s %s\n' "Persisted job status:" "$job_status"
printf '%-32s %s\n' "Actions drained:" "$actions_drained"
printf '%-32s %s ms\n' "run-flow ability time:" "$run_ms"
printf '%-32s %s ms\n' "drain-job ability time:" "$drain_ms"
printf '%-32s %s\n' "Issue URL:" "$issue_url"
if [ -n "$err" ] && [ "$err" != "null" ]; then
    printf '%-32s %s\n' "Error:" "$err"
fi
echo ""

if [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && [ "$publish_resolved" = "true" ] \
    && [ -n "$issue_url" ] \
    && [ "$job_status" = "completed" ]; then
    echo "✓ Stage 4 PASSED — DM flow published a GitHub issue inside Playground"
    exit 0
fi

echo "✗ Stage 4 FAILED — see envelope above"
exit 1
