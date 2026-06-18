# Data Machine Boundary

WPSG may know WP Codebox, but WPSG-owned generation, validation, and review domain code should not know Data Machine or Data Machine Code. Runtime coupling must stay in explicit transitional adapter surfaces until generic Homeboy/Homeboy Extensions and Codebox provider contracts replace it.

WPSG uses Homeboy Extensions `.github/workflows/runtime-agent-ci.yml` for agent runtime CI config. The public workflow boundary is generic, and iterator workspace/PR publication tool config uses the WP Codebox `wp-codebox/provider-runtime-invocation-contract/v1` ability identifiers. Unavoidable current runtime ability names remain quarantined inside workflow task config and adapter tests until Codebox and Homeboy expose fully generic execution contracts for the remaining operations.

The enforced quarantine lives in `.github/datamachine-boundary-quarantine.json`. Run `node tests/scripts/test-datamachine-boundary.mjs` to print the current boundary report and fail on new unclassified references.

## Current Quarantine Classes

- `transitional_adapter_surface`: controller or bootstrap code that currently invokes Data Machine/Data Machine Code because no generic execution contract exists yet.
- `transitional_adapter_test`: tests that pin the current adapter payloads so changes are deliberate.
- `transitional_adapter_config`: workflow or package config that uses a generic outer contract while quarantining current adapter-only ability names.
- `legacy_runtime_probe`: older Playground proof scripts/workloads for the historical runtime integration.
- `domain_language_cleanup_required`: WPSG-owned docs, prompts, or test language that should move to generic runtime vocabulary as low-risk edits become available.
- `boundary_enforcement`: the boundary test and negative assertions that necessarily name the prohibited terms.

## Upstream Gaps

- Homeboy/Homeboy Extensions need generic agent-runtime component defaults for controller execution so WPSG does not check out `Extra-Chill/data-machine` and `Extra-Chill/data-machine-code` directly.
- Homeboy Extensions `runtime-agent-ci` still requires a concrete runtime task ability for bundle execution. Owner/gap: Homeboy Extensions needs a generic agent-bundle or workflow execution primitive so WPSG does not pass `datamachine/run-agent-bundle`.
- WP Codebox/Homeboy still need generic GitHub issue creation and review-comment callback primitives, plus generic engine-data/tool-recorder projection. Owner/gap: the merged WP Codebox provider runtime invocation contract covers runner workspace command/publication and transcript/artifact handoff names, but it does not yet cover issue/comment callbacks or runtime engine-data recording.

WP Codebox now materializes `agent-runtime/workspace-preload`, so WPSG declares workspace preload artifacts directly with `agent-runtime/workspace-preload/v1` extension payloads instead of adapter artifact metadata.

WP Codebox also exports `wp-codebox/runner-workspace-command` and `wp-codebox/runner-workspace-publish`; WPSG uses those generic identifiers for iterator workspace tools and upstream pull-request publication instead of Data Machine Code workspace/PR ability names.

This PR intentionally does not add shims around those gaps.
