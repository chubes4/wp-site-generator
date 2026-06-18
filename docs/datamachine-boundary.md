# Data Machine Boundary

WPSG may know WP Codebox, but WPSG-owned generation, validation, and review domain code should not know Data Machine or Data Machine Code. Runtime coupling must stay in explicit transitional adapter surfaces until generic Homeboy/Homeboy Extensions and Codebox provider contracts replace it.

As of this update, Homeboy Extensions `main` does not expose `.github/workflows/runtime-agent-ci.yml`; the available reusable primitive is still `.github/workflows/datamachine-agent-ci.yml`, with generic runtime inputs inside that workflow. WPSG therefore relies on upstream defaults for runtime component refs and keeps only unavoidable ability/component names in quarantine instead of reimplementing the missing generic workflow.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Quarantine Classes

- `transitional_adapter_surface`: workflow, controller, or bootstrap code that currently invokes Data Machine/Data Machine Code because no generic runtime contract exists yet.
- `transitional_adapter_test`: tests that pin the current adapter payloads so changes are deliberate.
- `exported_bundle_metadata`: generated bundle metadata that records the exporter or current extension path.
- `legacy_runtime_probe`: older Playground proof scripts/workloads for the historical runtime integration.
- `domain_language_cleanup_required`: WPSG-owned docs, prompts, or test language that should move to generic runtime vocabulary as low-risk edits become available.
- `boundary_enforcement`: the boundary test and negative assertions that necessarily name the prohibited terms.

## Upstream Gaps

- Homeboy Extensions needs a generic reusable `runtime-agent-ci` workflow that replaces `datamachine-agent-ci.yml` for bundle execution.
- Homeboy/Homeboy Extensions need generic agent-runtime component defaults for controller execution so WPSG does not check out `Extra-Chill/data-machine` and `Extra-Chill/data-machine-code` directly.
- Codebox provider contracts need generic workspace, GitHub issue/PR, review-comment, transcript, tool-recorder, and workflow-execution ability names so WPSG does not pass `datamachine-code/*` or `datamachine/run-agent-bundle` identifiers.
- Bundle workspace preload metadata needs a generic artifact type/path instead of `datamachine-code/workspace_preload`.

This PR intentionally does not add shims around those gaps.
