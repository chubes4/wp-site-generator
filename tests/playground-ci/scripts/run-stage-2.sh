#!/usr/bin/env bash
#
# Stage 2: import the wc-idea-agent bundle into Data Machine inside Playground
# via the canonical Abilities API surface (datamachine/import-agent), and
# verify the agent is queryable through datamachine/get-agent.
#
# Builds on the same plumbing as Stage 1 but adds a bundle copy step so the
# component dir mounted into Playground at /wordpress/wp-content/plugins/<slug>
# carries the bundle alongside the workload. The bench runner mounts the
# component path verbatim, so co-locating the bundle there is the lightest
# way to make it reachable inside the PHP-WASM process.
#
# Refs Extra-Chill/homeboy-extensions#422

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-import-agent-probe.php"
BUNDLE_SOURCE="$REPO_ROOT/bundles/wc-idea-agent"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"

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

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-store-blueprints-stage-2.XXXXXX")
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-import-agent-probe.php"
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
    '{
        validation_dependencies: [$dm, $dmc],
        playground_workloads: [
            {
                id: "dm-import-agent",
                label: "Import wc-idea-agent bundle into DM",
                run: [
                    { type: "php", file: "dm-import-agent-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "Stage 2: import wc-idea-agent into DM (in Playground)"
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

scenario='.scenarios[] | select(.id == "dm-import-agent")'

import_resolved=$(jq -r "$scenario | .metadata.import_result.success // false" "$RESULTS_TMPFILE")
agent_resolved=$(jq -r "$scenario | .metadata.get_agent_result.success // false" "$RESULTS_TMPFILE")
pre_count=$(jq -r "$scenario | .metadata.pre_agent_count // 0" "$RESULTS_TMPFILE")
post_count=$(jq -r "$scenario | .metadata.post_agent_count // 0" "$RESULTS_TMPFILE")
flows_count=$(jq -r "$scenario | .metadata.post_flows_count // \"unknown\"" "$RESULTS_TMPFILE")
agent_slug=$(jq -r "$scenario | .metadata.import_result.agent_slug // \"unknown\"" "$RESULTS_TMPFILE")
import_ms=$(jq -r "$scenario | .metrics.import_elapsed_ms_p50 // 0" "$RESULTS_TMPFILE")
err=$(jq -r "$scenario | .metadata.error // \"\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "Stage 2 summary"
echo "============================================"
printf '%-32s %s\n' "Bundle imported:" "$import_resolved"
printf '%-32s %s\n' "Agent slug:" "$agent_slug"
printf '%-32s %s\n' "Agent queryable via API:" "$agent_resolved"
printf '%-32s %s -> %s\n' "Agent count (pre -> post):" "$pre_count" "$post_count"
printf '%-32s %s\n' "Visible flow count after import:" "$flows_count"
printf '%-32s %s ms\n' "import-agent ability time:" "$import_ms"
if [ -n "$err" ]; then
    printf '%-32s %s\n' "Error:" "$err"
fi
echo ""

if [ "$import_resolved" = "true" ] && [ "$agent_resolved" = "true" ]; then
    echo "✓ Stage 2 PASSED — wc-idea-agent imported and queryable inside Playground"
    exit 0
fi

echo "✗ Stage 2 FAILED — see envelope above"
exit 1
