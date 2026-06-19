# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific domain declaration for the continuous site-generation loop. GitHub Actions remains a supported trigger, but the reusable contract is the generated Homeboy from-spec loop declaration at `.github/homeboy/controllers/static-site-generation-loop.controller.json` so Homeboy can consume the same repo-domain terms without using Actions as the orchestrator.

The controller builder is `.github/scripts/build-homeboy-ssi-loop-controller.mjs`. It emits only the WPSG-owned domain contract: agents, abilities, workflows, artifact schemas, SSI stack dependencies, and quality gate metric definitions.

The controller spec is the authority for the full self-improving loop:

```text
concept -> design -> static candidate
  -> static validation + visual parity -> finding packets
  -> revalidation -> reviewer gate -> publication/evidence PRs and issues
```

WPSG does not define a backend abstraction layer and does not encode WordPress or WP Codebox execution knowledge. WPSG declares domain ingredients only. Homeboy owns controller execution, fan-out, retries, state, lineage, gate decisions, and executor/provider contracts. WordPress runtime and Codebox mapping belongs to `homeboy-extensions/wordpress`, not to this repo-owned spec.

## Native Controller Path

Build or refresh the checked-in controller spec:

```bash
node .github/scripts/build-homeboy-ssi-loop-controller.mjs
```

The generated spec is intended for a Homeboy repo-loop bridge that consumes repo-owned domain ingredients. The repo spec does not pick an executor backend, runtime provider, WordPress runtime, WP Codebox API, controller state store, retry policy, dedupe implementation, routing policy, or fan-out mechanism.

Homeboy should derive execution behavior from the declaration and its own controller policy. Resume, dedupe, joins, retries, routing, gate decisions, and lineage persistence are Homeboy responsibilities.

## Domain Ingredients

The generated spec declares these groups directly:

- `agents`: WPSG runtime bundles participating in generation, iterator, and reviewer flows.
- `abilities`: required ability contracts such as bundle execution, packet materialization, deterministic publication, and GitHub commenting.
- `workflows`: Homeboy-ingestible repo-domain prompts/tasks, explicit `consumes`/`emits` artifact handoffs, participating agents, fan-out rules, reviewer gates, and required abilities.
- `artifact_flow`: the enforceable handoff graph from concept packets through reviewer gate evidence.
- `artifacts`: WPSG and GitHub/Homeboy artifact schemas the loop emits or consumes.
- `dependencies`: SSI stack repositories and the behavior each owns.
- `gates` and `metrics`: WPSG metric definitions and pass expressions.

Homeboy maps these declarations to durable controller policy/actions through `agent-task controller from-spec`. Homeboy Extensions WordPress supplies WordPress/Codebox runtime details behind generic Homeboy executor/provider contracts when Homeboy selects that implementation.

## Runtime Input Migration

WPSG keeps its controller and domain specs backend-agnostic. Reusable Homeboy Agent CI selects the WP Codebox runtime behind its own contract, so WPSG callers pass domain inputs only. Controller run specs use clean `HOMEBOY_AGENT_RUNTIME_*` environment variables as a visible input contract. WPSG does not expose WP Codebox-specific agent runtime fields in its controller/domain specs.

Controller run specs record `inputs.runtime_input_contract: "homeboy-agent-runtime-env"` to make the seam visible. Keep runtime selection behind the Homeboy runtime contract; do not add backend-specific fields to `.github/homeboy/controllers/static-site-generation-loop.controller.json`.

## Quality Gates

The native controller exposes these WPSG-owned gate metrics and pass conditions:

- **Fallback blocks:** `fallback_blocks`, `fallback_block_count`, or `ssi_fallback_count` must be `0`.
- **Conversion findings:** actionable conversion finding count must be `0`; fallback/core HTML/freeform finding kinds are identified for Homeboy-owned routing.
- **Visual parity:** visual parity must report `status === "pass"`, `mismatch_count === 0`, and `max_delta_ratio === 0`.
- **Reviewer evidence:** reviewer-facing evidence must link to durable candidate, validation, visual, finding, and revalidation artifacts and must not use local-only URLs or filesystem paths. Generated-site PRs and upstream issue/PR URLs are optional publication evidence after the artifact gates.

The gate declarations define metrics and pass conditions only. Homeboy owns fail/pass routing, bounded revalidation, escalation, and completion decisions.

## Workflow Contracts

The controller declares workflow artifact dependencies and emissions. Homeboy decides how to execute the repo workflows:

1. `store-idea` and `website-idea` emit `concept_packet` artifacts.
2. `design-store` and `design-website` consume `concept_packet` and emit `design_packet`.
3. `static-store` and `static-site` consume `design_packet` and emit `static_site_candidate` without publishing a pull request.
4. `static-validation` consumes `static_site_candidate` and emits `static_validation_run`, `import_validation_result`, and `visual_parity_artifact`.
5. `static-publication` consumes the validated candidate evidence and emits optional `static_site_pull_request` publication evidence through deterministic publication.
6. `finding-packets` consumes validation and visual artifacts, then emits `finding_packet_set` and grouped `finding_group` artifacts.
7. `iterator` fans out per `finding_group`, grouped by `owner_repo`, `root_cause`, and `group_id`, then emits optional upstream issue and pull-request evidence artifacts.
8. `revalidation` consumes the candidate, validation, visual, and finding artifacts directly, then emits a `revalidation_attempt` plus refreshed validation artifacts.
9. `reviewer` consumes candidate, validation, visual, finding, and revalidation artifacts, then emits `reviewer_gate_outcome`. Promotion requires `reviewer_gate_outcome.decision === "PASS"` and blocks when artifact evidence is missing.

## Complexity And Randomness Policy

Prompt difficulty is owned by WP Site Generator, not Homeboy. The checked-in policy at `.github/site-generation-complexity-policy.json` is evaluated by `.github/scripts/build-homeboy-controller-run-inputs.mjs` before Homeboy materializes the controller spec with `homeboy agent-task controller materialize`.

The materialized controller run spec records the full decision on each workflow at `workflows[].inputs.complexity_policy`, including:

- selected and current complexity tier
- ramp decision: `hold`, `raise`, `lower`, `hold_floor`, `hold_ceiling`, or `override`
- deterministic randomness seed and randomness profile
- site-kind mix
- tier layout/component families and criteria
- quality-signal path and explicit overrides used for the run

Homeboy receives the policy decision with the controller spec and owns how it is applied to generated actions. Candidate-producing workflows retain WPSG-owned prompts and artifact schemas so emitted artifact metadata can record tier, randomness seed/profile, site kind, layout family, component families, and policy decision.

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

### Overrides

GitHub Actions exposes these optional inputs, which map directly to environment variables:

- `complexity_tier` -> `WPSG_COMPLEXITY_TIER`
- `randomness_profile` -> `WPSG_RANDOMNESS_PROFILE`
- `randomness_seed` -> `WPSG_RANDOMNESS_SEED`
- `quality_signals_path` -> `WPSG_QUALITY_SIGNALS_PATH`

Additional WPSG policy inputs are available for local controller run-input generation:

- `WPSG_CURRENT_COMPLEXITY_TIER`: current tier when the signal file does not include one
- `WPSG_SITE_KIND_MIX`: comma-separated site-kind override
- `WPSG_TARGET_PARALLEL_CANDIDATES`: candidate budget override, bounded by the selected tier

Homeboy remains the controller, executor, scheduler, and loop-spec materializer. It receives WPSG domain declarations, artifact contracts, task inputs, workload settings, and metadata that WPSG has computed.

## Upstream Contract

Extra-Chill/homeboy#5152 is the upstream runtime dependency for the generic `agent-task controller from-spec`, `resume`, and `events` primitives. Extra-Chill/homeboy#5186 is the upstream dependency for `agent-task controller materialize`, which expands WPSG's run-input payload into workflow inputs without WPSG assembling the full controller run spec locally. If a backend-specific WordPress or WP Codebox mapping is needed, it belongs behind generic Homeboy executor/provider contracts in `homeboy-extensions/wordpress`, not in this WPSG spec.
