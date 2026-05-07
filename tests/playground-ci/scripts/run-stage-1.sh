#!/usr/bin/env bash
#
# Stage 1: cold-boot DM + DMC inside Playground and capture the boot probe.
#
# Drives the Homeboy WordPress extension's Playground bench runner directly
# (no `homeboy bench` wrapper needed) using:
#   - the tiny CI-driver plugin under tests/playground-ci/component/ as the
#     "component under test" so the bench runner mounts this repo cleanly;
#   - HOMEBOY_WORDPRESS_DEPENDENCY_PATHS to mount real DM + DMC checkouts
#     into wp-content/plugins/;
#   - playground_workloads in HOMEBOY_SETTINGS_JSON to run the boot probe
#     and emit { metrics, artifacts, metadata } as a BenchResults scenario.
#
# Refs Extra-Chill/homeboy-extensions#422

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPONENT_PATH="$REPO_ROOT/tests/playground-ci/component"
WORKLOAD_PATH="$REPO_ROOT/tests/playground-ci/workloads/dm-boot-probe.php"

EXTENSION_PATH="${HOMEBOY_EXTENSION_PATH:-/Users/chubes/Developer/homeboy-extensions/wordpress}"
DM_PATH="${DM_PATH:-/Users/chubes/Developer/data-machine}"
DMC_PATH="${DMC_PATH:-/Users/chubes/Developer/data-machine-code}"

if [ ! -f "$EXTENSION_PATH/scripts/bench/bench-runner.sh" ]; then
    echo "ERROR: Homeboy WordPress extension not found at $EXTENSION_PATH" >&2
    echo "       Set HOMEBOY_EXTENSION_PATH to override." >&2
    exit 1
fi
if [ ! -f "$EXTENSION_PATH/node_modules/.bin/wp-playground-cli" ]; then
    echo "ERROR: @wp-playground/cli not installed at $EXTENSION_PATH/node_modules" >&2
    echo "       cd $EXTENSION_PATH && npm install" >&2
    exit 1
fi
if [ ! -d "$EXTENSION_PATH/vendor/wp-phpunit" ]; then
    echo "ERROR: wp-phpunit not installed at $EXTENSION_PATH/vendor" >&2
    echo "       cd $EXTENSION_PATH && composer install" >&2
    exit 1
fi
if [ ! -f "$DM_PATH/data-machine.php" ]; then
    echo "ERROR: Data Machine plugin not found at $DM_PATH" >&2
    exit 1
fi
if [ ! -f "$DMC_PATH/data-machine-code.php" ]; then
    echo "ERROR: Data Machine Code plugin not found at $DMC_PATH" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq required for assertions" >&2
    exit 1
fi

RESULTS_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/wc-site-generator-stage-1.XXXXXX")
cleanup() {
    rm -f "$RESULTS_TMPFILE"
}
trap cleanup EXIT

# The boot probe lives outside the component path, so we mount it by absolute
# path and reference it from the workload. The bench runner mounts the
# component path verbatim into Playground at /wordpress/wp-content/plugins/<slug>;
# to keep the workload self-contained we copy it into the component before run.
COMPONENT_WORKLOAD="$COMPONENT_PATH/dm-boot-probe.php"
cp "$WORKLOAD_PATH" "$COMPONENT_WORKLOAD"
trap 'rm -f "$RESULTS_TMPFILE" "$COMPONENT_WORKLOAD"' EXIT

# Settings JSON: declares DM + DMC as validation_dependencies (the bench
# runner's existing helper resolves these to mount paths and exports
# HOMEBOY_WORDPRESS_DEPENDENCY_PATHS) and one configured workload that runs
# the boot probe through the new playground_workloads primitive.
SETTINGS_JSON=$(jq -nc \
    --arg dm "$DM_PATH" \
    --arg dmc "$DMC_PATH" \
    '{
        validation_dependencies: [$dm, $dmc],
        playground_workloads: [
            {
                id: "dm-boot-probe",
                label: "Data Machine cold-boot probe",
                run: [
                    { type: "php", file: "dm-boot-probe.php" }
                ]
            }
        ]
    }')

echo "============================================"
echo "Stage 1: Data Machine cold-boot inside Playground"
echo "============================================"
echo "Repo:        $REPO_ROOT"
echo "Driver:      $COMPONENT_PATH"
echo "DM:          $DM_PATH"
echo "DMC:         $DMC_PATH"
echo "Extension:   $EXTENSION_PATH"
echo "Iterations:  1"
echo ""

HOMEBOY_BENCH_RESULTS_FILE="$RESULTS_TMPFILE" \
HOMEBOY_BENCH_ITERATIONS=1 \
HOMEBOY_COMPONENT_ID=wc-site-generator-ci-driver \
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

scenario='.scenarios[] | select(.id == "dm-boot-probe")'
boot_ms=$(jq -r '.scenarios[] | select(.id == "__bootstrap") | .metrics.boot_ms // 0' "$RESULTS_TMPFILE")
install_ms=$(jq -r '.scenarios[] | select(.id == "__bootstrap") | .metrics.install_ms // 0' "$RESULTS_TMPFILE")
load_deps_ms=$(jq -r '.scenarios[] | select(.id == "__bootstrap") | .metrics.load_deps_ms // 0' "$RESULTS_TMPFILE")
load_component_ms=$(jq -r '.scenarios[] | select(.id == "__bootstrap") | .metrics.load_component_ms // 0' "$RESULTS_TMPFILE")

# Aggregated metrics use the _p50 suffix (mean/p50/p95/p99/min/max). Read the
# stable representative for each indicator instead of the raw key the workload
# returned, which the runner expands into the suffix family.
has_dm=$(jq -r "$scenario | .metadata.data_machine_loaded // false" "$RESULTS_TMPFILE")
has_dmc=$(jq -r "$scenario | .metadata.data_machine_code_loaded // false" "$RESULTS_TMPFILE")
has_abilities=$(jq -r "$scenario | .metadata.abilities_api_available // false" "$RESULTS_TMPFILE")
has_action_scheduler=$(jq -r "$scenario | .metadata.action_scheduler_loaded // false" "$RESULTS_TMPFILE")
dm_classes_seen=$(jq -r "$scenario | .metadata.datamachine_classes_seen | length" "$RESULTS_TMPFILE")
wp_version=$(jq -r "$scenario | .metadata.wp_version // \"unknown\"" "$RESULTS_TMPFILE")
php_version=$(jq -r "$scenario | .metadata.php_version // \"unknown\"" "$RESULTS_TMPFILE")

echo "============================================"
echo "Stage 1 summary"
echo "============================================"
printf '%-32s %s ms\n' "WP boot stage:" "$boot_ms"
printf '%-32s %s ms\n' "WP install stage:" "$install_ms"
printf '%-32s %s ms\n' "DM + DMC load_deps stage:" "$load_deps_ms"
printf '%-32s %s ms\n' "Component load stage:" "$load_component_ms"
echo ""
printf '%-32s %s\n' "WP version:" "$wp_version"
printf '%-32s %s\n' "PHP version:" "$php_version"
printf '%-32s %s\n' "Data Machine loaded:" "$has_dm"
printf '%-32s %s\n' "Data Machine Code loaded:" "$has_dmc"
printf '%-32s %s\n' "Abilities API available:" "$has_abilities"
printf '%-32s %s\n' "Action Scheduler loaded:" "$has_action_scheduler"
printf '%-32s %s\n' "DM classes seen:" "$dm_classes_seen"
echo ""

if [ "$has_dm" = "true" ] && [ "$has_dmc" = "true" ]; then
    echo "✓ Stage 1 PASSED — DM + DMC cold-booted under PHP-WASM + SQLite"
    exit 0
fi

echo "✗ Stage 1 FAILED — DM or DMC did not load. See envelope above for diagnostics."
exit 1
