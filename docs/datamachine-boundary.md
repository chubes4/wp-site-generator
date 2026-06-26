# Data Machine Boundary

WPSG-owned generation, validation, and review domain code consume generic Homeboy runtime configuration. Data Machine and Data Machine Code references stay isolated to the explicit boundary enforcement surface.

WPSG does not keep GitHub Actions runtime wrappers for production loop execution. Bundle execution stays described with HBE `runtime_execution` descriptors rendered by the shared runtime facade. Homeboy lab runners select generic workload profiles such as `workspace-iteration` and `workspace-publication`, then render Homeboy runtime profiles and tool requirements from upstream runtime contracts.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Boundary Classes

- `boundary_enforcement`: the boundary test and guarded assertions that name the classified boundary terms.

Current behavior coverage lives in runtime output/evidence projection config, workspace-preload package contracts, and the upstream primitive gap list in `docs/homeboy-lab-primitive-gaps.md`.

## Generic Runtime Execution

- Controller specs and workflow callers use `runtime_execution.kind = "bundle"` with a runtime-package `package`, `workflow`, `input`, and `options` envelope.
- Runtime profiles set `runtime_task_ability`, `runtime_bundle_ability`, and `runtime_workflow_ability` through `.github/scripts/lib/runtime-domain-inputs.mjs`, which only renders WPSG-owned domain inputs from explicit upstream runtime env values.
- Iterator fanout lifecycle uses Homeboy's public `homeboy agent-task fanout plan`, `submit-batch`, `status`, and `artifacts` primitives with WPSG-owned packet input.
- Iterator callback publication uses generic `runtime_output_projections` over semantic `outputs.*` values populated by `evidence_projections`.

Runtime packages materialize `agent-runtime/workspace-preload`, so WPSG declares workspace preload artifacts directly with `agent-runtime/workspace-preload/v1` extension payloads instead of adapter artifact metadata.

WPSG relies on the selected runtime package and Homeboy Extensions runtime execution support for provider-specific behavior.
