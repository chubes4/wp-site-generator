# Data Machine Boundary

WPSG may know WP Codebox, but WPSG-owned generation, validation, and review domain code should not know Data Machine or Data Machine Code. Runtime coupling must stay in explicit transitional adapter surfaces until generic Homeboy/Homeboy Extensions and Codebox provider contracts replace it.

WPSG uses Homeboy Extensions `.github/workflows/runtime-agent-ci.yml` for agent runtime CI config. The public workflow boundary is now generic; unavoidable current runtime ability/tool names remain quarantined inside workflow task config and adapter tests until Codebox and Homeboy expose fully generic execution contracts.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Quarantine Classes

- `transitional_adapter_surface`: controller or bootstrap code that currently invokes Data Machine/Data Machine Code because no generic execution contract exists yet.
- `transitional_adapter_test`: tests that pin the current adapter payloads so changes are deliberate.
- `transitional_adapter_config`: workflow or package config that uses a generic outer contract while quarantining current adapter-only ability names.
- `boundary_enforcement`: the boundary test and negative assertions that necessarily name the prohibited terms.

The older Playground proof scripts, workloads, and workflow for the historical runtime integration have been removed. Current behavior coverage lives in the generic `runtime-agent-ci` workflow wiring, workspace-preload package contracts, and transitional adapter tests above.

## Upstream Gaps

- Homeboy/Homeboy Extensions need generic agent-runtime component defaults for controller execution so WPSG does not check out `Extra-Chill/data-machine` and `Extra-Chill/data-machine-code` directly.
- Codebox provider contracts need generic workspace, GitHub issue/PR, review-comment, transcript, tool-recorder, bundle-execution, and workflow-execution ability names so WPSG does not pass `datamachine-code/*` or `datamachine/run-agent-bundle` identifiers.

WP Codebox now materializes `agent-runtime/workspace-preload`, so WPSG declares workspace preload artifacts directly with `agent-runtime/workspace-preload/v1` extension payloads instead of adapter artifact metadata.

This PR intentionally does not add shims around those gaps.
