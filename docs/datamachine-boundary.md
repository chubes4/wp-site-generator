# Data Machine Boundary

WPSG may know WP Codebox, but WPSG-owned generation, validation, and review domain code should not know Data Machine or Data Machine Code.

WPSG uses Homeboy Extensions `.github/workflows/runtime-agent-ci.yml` for agent runtime CI config. Bundle execution is described with HBE `runtime_execution` descriptors and dispatched through the Agents API `agents/run-runtime-package` ability. Iterator workspace, issue, PR, and comment publication tool config uses WP Codebox provider runtime identifiers such as `wp-codebox/runner-workspace-command` and `wp-codebox/runner-workspace-publish`.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Quarantine Classes

- `transitional_adapter_surface`: legacy reference surfaces retained only when tests or historical fixture names still contain boundary vocabulary.
- `transitional_adapter_test`: tests that pin generic runtime package payloads and negative boundary assertions.
- `transitional_adapter_config`: workflow or package config using generic runtime execution descriptors and WP Codebox runtime tool identifiers.
- `boundary_enforcement`: the boundary test and negative assertions that necessarily name the prohibited terms.

The older Playground proof scripts, workloads, and workflow for the historical runtime integration have been removed. Current behavior coverage lives in the generic `runtime-agent-ci` workflow wiring, workspace-preload package contracts, and transitional adapter tests above.

## Generic Runtime Execution

- Controller specs and workflow callers use `runtime_execution.kind = "bundle"` with a runtime-package `package`, `workflow`, `input`, and `options` envelope.
- Runtime profiles set `runtime_task_ability`, `runtime_bundle_ability`, and `runtime_workflow_ability` to `agents/run-runtime-package`.
- WPSG workflows check out Agents API and Homeboy Extensions, and no longer check out concrete runtime implementation repositories.

WP Codebox now materializes `agent-runtime/workspace-preload`, so WPSG declares workspace preload artifacts directly with `agent-runtime/workspace-preload/v1` extension payloads instead of adapter artifact metadata.

WPSG does not add local shims around runtime execution. Provider-specific behavior belongs in the WP Codebox runtime package or Homeboy Extensions runtime execution support.
