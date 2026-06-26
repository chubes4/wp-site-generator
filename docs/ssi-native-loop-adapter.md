# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific domain declaration for the continuous site-generation loop. The reusable contract is the generated Homeboy from-spec loop declaration at `.github/homeboy/controllers/static-site-generation-loop.controller.json`. Homeboy lab runners trigger that contract and own orchestration and proof.

The controller builder is `.github/scripts/build-homeboy-ssi-loop-controller.mjs`. It emits only the WPSG-owned domain contract: agents, abilities, workflows, artifact schemas, SSI stack dependencies, and quality gate metric definitions.

The controller spec is the authority for the full self-improving loop:

```text
concept -> design -> static candidate
  -> static validation + visual parity -> finding packets
  -> revalidation -> reviewer gate -> publication/evidence PRs and issues
```

WPSG declares domain ingredients only. Homeboy owns controller execution, fan-out, retries, state, lineage, gate decisions, and executor/provider contracts. `homeboy-extensions/wordpress` supplies the WordPress runtime and Codebox mapping for the selected execution path.

## Native Controller Path

Build or refresh the checked-in controller spec:

```bash
node .github/scripts/build-homeboy-ssi-loop-controller.mjs
```

The generated spec is intended for a Homeboy repo-loop bridge that consumes repo-owned domain ingredients. Homeboy and Homeboy Extensions supply the executor backend, runtime provider, WordPress runtime, controller state store, retry policy, dedupe implementation, routing policy, and fan-out mechanism.

Homeboy derives execution behavior from the declaration and its own controller policy. Resume, dedupe, joins, retries, routing, gate decisions, and lineage persistence are Homeboy responsibilities.

## Domain Ingredients

The generated spec declares these groups directly:

- `agents`: WPSG runtime bundles participating in generation, iterator, and reviewer flows.
- `abilities`: required ability contracts such as bundle execution, packet materialization, deterministic publication, and GitHub commenting.
- `workflows`: Homeboy-ingestible repo-domain prompts/tasks, explicit `consumes`/`emits` artifact handoffs, participating agents, fan-out rules, reviewer gates, and required abilities.
- `artifact_flow`: the enforceable handoff graph from concept packets through reviewer gate evidence.
- `artifacts`: WPSG and GitHub/Homeboy artifact schemas the loop emits or consumes.
- `dependencies`: SSI stack repositories and the behavior each owns.
- `gates` and `metrics`: WPSG metric definitions and pass expressions.

Homeboy maps these declarations to durable controller policy/actions through `agent-task controller run-from-spec`. Homeboy Extensions WordPress supplies WordPress runtime details behind generic Homeboy executor/provider contracts when Homeboy selects an implementation. WPSG does not own controller lifecycle, dependency materialization, dispatch/provider selection, runtime substrate, or evidence capture.

## Runtime Inputs

WPSG keeps its controller and domain specs backend-agnostic. Homeboy lab runners select the concrete runtime behind their own contract, so WPSG callers pass domain inputs only. Controller run specs use clean runtime input fields as a visible contract. Runtime-specific fields stay in the Homeboy runtime contract.

Controller run specs record `inputs.runtime_input_contract: "homeboy-agent-runtime-env"` to make the seam visible. Runtime selection flows through the Homeboy runtime contract rather than `.github/homeboy/controllers/static-site-generation-loop.controller.json` fields.

## Quality Gates

The native controller exposes these WPSG-owned gate metrics and pass conditions:

- **Fallback blocks:** `fallback_blocks`, `fallback_block_count`, or `ssi_fallback_count` must be `0`.
- **Conversion findings:** actionable conversion finding count must be `0`; fallback/core HTML/freeform finding kinds are identified for Homeboy-owned routing.
- **Visual parity:** visual parity must report `status === "pass"`, `mismatch_count === 0`, and `max_delta_ratio === 0`.
- **Reviewer evidence:** reviewer-facing evidence links to durable candidate, validation, visual, finding, and revalidation artifacts through reviewer-accessible URLs. Generated-site PRs and upstream issue/PR URLs are optional publication evidence after the artifact gates.

The gate declarations define metrics and pass conditions only. Homeboy owns fail/pass routing, bounded revalidation, escalation, and completion decisions.

## Workflow Contracts

The controller declares workflow artifact dependencies and emissions. Homeboy decides how to execute the repo workflows:

1. `store-idea` and `website-idea` emit `concept_packet` artifacts.
2. `design-store` and `design-website` consume `concept_packet` and emit `design_packet`.
3. `static-store` and `static-site` consume `design_packet` and emit `static_site_candidate` without publishing a pull request.
4. `static-validation` consumes `static_site_candidate` and emits `static_validation_run`, `import_validation_result`, and `visual_parity_artifact`.
5. `static-publication` consumes the validated candidate evidence and emits optional `static_site_pull_request` publication evidence through deterministic publication.
6. `finding-packets` consumes validation and visual artifacts, then emits `finding_packet_set` and grouped `finding_group` artifacts.
7. `iterator` fans out per `finding_group`, grouped by `owner_repo`, `root_cause`, and `group_id`, then emits optional upstream issue and pull-request evidence artifacts. The controller declaration points at `.github/scripts/build-php-transformer-iterator-fanout-config.mjs`, which builds `wp-site-generator/php-transformer-iterator-fanout-input/v1` for Homeboy's `homeboy/agent-task-fanout-input/v1` submit-batch contract.
8. `revalidation` consumes the candidate, validation, visual, and finding artifacts directly, then emits a `revalidation_attempt` plus refreshed validation artifacts.
9. `reviewer` consumes candidate, validation, visual, finding, and revalidation artifacts, then emits `reviewer_gate_outcome`. Promotion requires `reviewer_gate_outcome.decision === "PASS"` and blocks when artifact evidence is missing.

The three model-produced handoff artifacts declare Homeboy typed-artifact envelopes in the loop spec and bundle completion assertions:

- `concept_packet` -> `homeboy/agent-task-typed-artifact/v1` with payload schema `wp-site-generator/ConceptPacket/v1`.
- `design_packet` -> `homeboy/agent-task-typed-artifact/v1` with payload schema `wp-site-generator/DesignPacket/v1`.
- `static_site_candidate` -> `homeboy/agent-task-typed-artifact/v1` with payload schema `wp-site-generator/StaticSiteCandidate/v1`.

Run `node tests/scripts/test-wpsg-loop-typed-artifact-contracts.mjs` to validate those declarations and deterministic fixture envelopes without launching providers.

## Complexity And Randomness Policy

Prompt difficulty is owned by WP Site Generator, not Homeboy. The checked-in policy at `.github/site-generation-complexity-policy.json` is evaluated by `.github/scripts/build-homeboy-controller-run-inputs.mjs` before Homeboy runs the controller spec with `homeboy agent-task controller run-from-spec --policy-result @<policy-result.json>`.

The materialized controller run spec records the full decision on each workflow at `workflows[].inputs.policy_results["wpsg-complexity-policy"]`, including:

- selected and current complexity tier
- ramp decision: `hold`, `raise`, `lower`, `hold_floor`, `hold_ceiling`, or `override`
- deterministic randomness seed and randomness profile
- site-kind mix
- tier layout/component families and criteria
- quality-signal path and explicit overrides used for the run

Homeboy receives the policy decision through its generic policy-result materialization contract and records provenance under `metadata.policy_materialization["wpsg-complexity-policy"]`. Candidate-producing workflows retain WPSG-owned prompts and artifact schemas so emitted artifact metadata can record tier, randomness seed/profile, site kind, layout family, component families, and policy decision.

### Quality Signals

Quality signals are optional JSON supplied through `WPSG_QUALITY_SIGNALS_PATH` or `HOMEBOY_QUALITY_SIGNALS_PATH`. When no signal file is supplied, the loop holds at the configured default tier.

Accepted quality signals use the current object shape with `recent_results`:

```json
{
  "current_tier": "foundation",
  "recent_results": [
    {
      "status": "passed",
      "site_kind": "store",
      "pattern_family": "basic-commerce",
      "fallback_block_count": 0,
      "visual_mismatch_ratio": 0.01,
      "actionable_findings": 0
    }
  ]
}
```

The evaluator uses the configured `quality_window` and summarizes pass rate, fallback blocks, visual mismatch ratio, actionable findings, site kinds, and pattern families.

### Ramp Rules

The default policy has three tiers:

- `foundation`: simple store/website prompts for core importer stability
- `composed`: richer section variety after foundation quality is stable
- `stress`: higher-variance prompts after composed quality is stable

Stable quality raises at most one tier for the next run. Regressions lower at most one tier. The floor and ceiling hold when the policy cannot move farther. This keeps prompt complexity reproducible and prevents a single good or bad run from skipping the configured ladder.

### Optional Run Overrides

Homeboy lab runners can expose these inputs, which map directly to environment variables:

- `complexity_tier` -> `WPSG_COMPLEXITY_TIER`
- `randomness_profile` -> `WPSG_RANDOMNESS_PROFILE`
- `randomness_seed` -> `WPSG_RANDOMNESS_SEED`
- `quality_signals_path` -> `WPSG_QUALITY_SIGNALS_PATH`

Additional WPSG policy inputs are available for local controller run-input generation:

- `WPSG_CURRENT_COMPLEXITY_TIER`: current tier when the signal file does not include one
- `WPSG_SITE_KIND_MIX`: comma-separated site-kind override
- `WPSG_TARGET_PARALLEL_CANDIDATES`: candidate budget override, bounded by the selected tier

Homeboy remains the controller, executor, scheduler, and loop-spec materializer. It receives WPSG domain declarations, artifact contracts, task inputs, workload settings, and metadata that WPSG has computed.

## Headless Contract Validation

The deterministic headless validation path is `.github/scripts/validate-headless-site-generation-loop.mjs`. It proves WPSG can exercise the production loop contract through Homeboy controller primitives:

```bash
HOMEBOY_BIN=homeboy node .github/scripts/validate-headless-site-generation-loop.mjs \
  --run-id headless-contract \
  --randomness-seed headless-contract-seed \
  --runtime-id <runtime-id> \
  --artifact-root .ci/homeboy-agent-task-artifacts \
  --evidence .ci/headless-site-generation-loop-evidence.json
```

The command sequence it records is the reviewer-facing contract evidence:

```bash
node .github/scripts/build-homeboy-controller-run-inputs.mjs
homeboy agent-task controller run-from-spec @.github/homeboy/controllers/static-site-generation-loop.controller.json --inputs @<run-inputs> --policy-result @<policy-result> --max-actions 100 > <controller-result>
homeboy agent-task controller validate-proof @<materialization-proof>
node .github/scripts/write-materialized-controller-run-spec.mjs <materialization> <controller-run-spec>
node .github/scripts/assert-site-generation-loop-proof.mjs --controller-result <controller-result> --controller-run-spec <controller-run-spec> --artifact-root <artifact-root>
```

The proof requires artifacts emitted by Homeboy/runtime execution under `--artifact-root`. It fails closed when the artifact root does not include real import report, zero fallback/conversion findings, visual parity gates, typed runtime preview/access URL, required iterator fanout evidence for actionable findings, and controller run-from-spec evidence. Iterator issue/PR artifacts and publication PR artifacts are optional for a clean candidate-only run, but are validated when emitted. Runtime selection remains outside the controller spec through `HOMEBOY_AGENT_RUNTIME_*`; `--runtime-id` is runner selection, not a WPSG-owned contract.

Production success evidence is a single bundle of Homeboy artifacts: controller run-from-spec result, materialization proof, a typed `runtime_access` envelope for the generated WordPress result, typed artifacts for `concept_packet`, `design_packet`, and `static_site_candidate`, and downstream validation/gate artifacts. Failure evidence is the same bundle plus the failing assertion or runtime message, for example `runtime task did not produce required typed artifacts: concept_packet`.

The headless N-revolution production run uses the same boundary with a generic HBE runner:

```bash
HOMEBOY_HEADLESS_LOOP_REVOLUTIONS=3 \
HOMEBOY_AGENT_RUNTIME=wp-codebox \
HOMEBOY_AGENT_RUNTIME_PROVIDER=codex \
HOMEBOY_AGENT_RUNTIME_MODEL=gpt-5.5 \
HOMEBOY_AGENT_RUNTIME_PROVIDER_PLUGIN_PATHS=/path/to/ai-provider-for-openai \
HOMEBOY_AGENT_RUNTIME_SECRET_ENV=AI_PROVIDER_OPENAI_CODEX_ACCESS_TOKEN,AI_PROVIDER_OPENAI_CODEX_REFRESH_TOKEN,AI_PROVIDER_OPENAI_CODEX_EXPIRES_AT,AI_PROVIDER_OPENAI_CODEX_ACCOUNT_ID,AI_PROVIDER_OPENAI_CODEX_FEDRAMP \
node .ci/homeboy-extensions/runtime-agent-ci/scripts/run-headless-loop.cjs \
  --spec .github/homeboy/headless-production-loop.json \
  --revolutions 3
```

The WPSG spec does not name Codebox or Codex. Those are selected by the runtime profile/env contract, so another runtime profile can swap in without changing WPSG workload code.

Runtime selection is Homeboy-owned. WPSG keeps the workload spec and artifact contract runtime-neutral while lab runners provide the selected runtime profile, provider credentials, and execution budget.
