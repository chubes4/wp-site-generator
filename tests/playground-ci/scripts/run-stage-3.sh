#!/usr/bin/env bash
#
# Stage 3: execute a CI-safe Data Machine flow inside Playground.
#
# Imports the store-idea-agent bundle, creates a one-step no-op fetch flow, runs it
# via datamachine/run-flow, drains Action Scheduler with datamachine/drain-job,
# and asserts the job reaches a terminal state. The fetch returns no items by
# design, avoiding AI token spend and GitHub writes while proving the execution
# loop works in a one-shot Playground process.
#
# Refs Extra-Chill/homeboy-extensions#422

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-run-flow-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/store-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    exit 1
fi
if [ ! -d "$BUNDLE_SOURCE" ]; then
    echo "ERROR: store-idea-agent bundle not found at $BUNDLE_SOURCE" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq required for assertions" >&2
    exit 1
fi

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wp-site-generator-stage-3.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-run-flow-probe.php"
COMPONENT_BUNDLE_DIR="$COMPONENT_PATH/bundles/store-idea-agent"

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
    '{
        validation_dependencies: [$dm, $dmc],
        wp_codebox_workloads: [
            {
                id: "dm-run-flow",
                label: "Run and drain a CI-safe DM flow",
                run: [
                    { type: "php", file: "dm-run-flow-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "Stage 3: run and drain a DM flow (in Playground)"
echo "============================================"
echo "Repo:         $REPO_ROOT"
echo "Driver:       $COMPONENT_PATH"
echo "Bundle src:   $BUNDLE_SOURCE"
echo "Bundle dest:  $COMPONENT_BUNDLE_DIR"
echo "DM:           $DM_PATH"
echo "DMC:          $DMC_PATH"
echo "Extension:    $EXTENSION_PATH"
echo ""

HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wp-site-generator-ci-driver \
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

scenario='.scenarios[] | select(.id == "dm-run-flow")'

import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
run_resolved=$(jq -r "$scenario | .metadata.run_result.success // false" "$RESULTS_TMPFILE")
drain_resolved=$(jq -r "$scenario | .metadata.drain_result.success // false" "$RESULTS_TMPFILE")
terminal_state=$(jq -r "$scenario | .metadata.drain_result.terminal_state // \"unknown\"" "$RESULTS_TMPFILE")
job_status=$(jq -r "$scenario | .metadata.job_status // \"unknown\"" "$RESULTS_TMPFILE")
actions_drained=$(jq -r "$scenario | .metadata.drain_result.actions_drained // 0" "$RESULTS_TMPFILE")
flow_id=$(jq -r "$scenario | .metadata.flow_id // \"unknown\"" "$RESULTS_TMPFILE")
job_id=$(jq -r "$scenario | .metadata.job_id // \"unknown\"" "$RESULTS_TMPFILE")
run_ms=$(jq -r "$scenario | .metrics.run_elapsed_ms_p50 // 0" "$RESULTS_TMPFILE")
drain_ms=$(jq -r "$scenario | .metrics.drain_elapsed_ms_p50 // 0" "$RESULTS_TMPFILE")
err=$(jq -r "$scenario | .metadata.error // \"\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "Stage 3 summary"
echo "============================================"
printf '%-32s %s\n' "Bundle imported:" "$import_resolved"
printf '%-32s %s\n' "run-flow succeeded:" "$run_resolved"
printf '%-32s %s\n' "drain-job succeeded:" "$drain_resolved"
printf '%-32s %s\n' "Terminal state:" "$terminal_state"
printf '%-32s %s\n' "Persisted job status:" "$job_status"
printf '%-32s %s\n' "Flow ID:" "$flow_id"
printf '%-32s %s\n' "Job ID:" "$job_id"
printf '%-32s %s\n' "Actions drained:" "$actions_drained"
printf '%-32s %s ms\n' "run-flow ability time:" "$run_ms"
printf '%-32s %s ms\n' "drain-job ability time:" "$drain_ms"
if [ -n "$err" ]; then
    printf '%-32s %s\n' "Error:" "$err"
fi
echo ""

if [ "$import_resolved" = "true" ] \
    && [ "$run_resolved" = "true" ] \
    && [ "$drain_resolved" = "true" ] \
    && { [ "$terminal_state" = "completed" ] || [ "$terminal_state" = "completed_no_items" ]; } \
    && { [ "$job_status" = "completed" ] || [ "$job_status" = "completed_no_items" ]; }; then
    echo "✓ Stage 3 PASSED — DM flow ran and drained synchronously inside Playground"
    exit 0
fi

echo "✗ Stage 3 FAILED — see envelope above"
exit 1
