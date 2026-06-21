# Data Machine Boundary

WPSG-owned generation, validation, and review domain code consume generic Homeboy runtime configuration. Data Machine and Data Machine Code references stay isolated to the explicit boundary enforcement surface.

WPSG workflows call the local `.github/workflows/wpsg-runtime-agent-ci.yml` seam. Bundle execution stays described with HBE `runtime_execution` descriptors and dispatches through the Agents API `agents/run-runtime-package` ability. Domain workflows select generic workload profiles such as `workspace-iteration` and `workspace-publication`; the seam renders Homeboy runtime profiles and tool requirements from the `HOMEBOY_AGENT_RUNTIME_*` contract.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Boundary Classes

- `boundary_enforcement`: the boundary test and guarded assertions that name the classified boundary terms.

The older Playground proof scripts, workloads, workflow, and transitional adapter config for the historical runtime integration have been removed. Current behavior coverage lives in the generic `runtime-agent-ci` workflow wiring, runtime output/evidence projection config, and workspace-preload package contracts.

## Generic Runtime Execution

- Controller specs and workflow callers use `runtime_execution.kind = "bundle"` with a runtime-package `package`, `workflow`, `input`, and `options` envelope.
- Runtime profiles set `runtime_task_ability`, `runtime_bundle_ability`, and `runtime_workflow_ability` to the Agents API `agents/run-runtime-package` entry point for Codebox package execution.
- Iterator fanout planning uses Homeboy's public `homeboy agent-task fanout plan` primitive with WPSG-owned packet input.
- WPSG workflows check out Agents API and Homeboy Extensions for the current runtime support path.
- Iterator callback publication uses generic `runtime_output_projections` over semantic `outputs.*` values populated by `evidence_projections`, not legacy engine-data helper functions or config keys.

Runtime packages materialize `agent-runtime/workspace-preload`, so WPSG declares workspace preload artifacts directly with `agent-runtime/workspace-preload/v1` extension payloads instead of adapter artifact metadata.

WPSG relies on WP Codebox, the selected runtime package, and Homeboy Extensions runtime execution support for provider-specific behavior.
