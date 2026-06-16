# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific domain declaration for the continuous site-generation loop. GitHub Actions remains a supported trigger, but the reusable contract is the generated Homeboy from-spec loop declaration at `.github/homeboy/controllers/static-site-generation-loop.controller.json` so Homeboy can consume the same repo-domain terms without using Actions as the orchestrator.

The controller builder is `.github/scripts/build-homeboy-ssi-loop-controller.mjs`. It emits only the WPSG-owned domain contract: agents, abilities, workflows, artifact schemas, SSI stack dependencies, and quality gate metric definitions.

The controller spec is the authority for the full self-improving loop:

```text
generation -> import validation -> publish PR
  -> static validation + visual parity -> finding packets
  -> iterator subloops -> revalidation -> reviewer gate
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

- `agents`: WPSG Data Machine bundles participating in generation, iterator, and reviewer flows.
- `abilities`: required ability contracts such as bundle execution and GitHub publishing/commenting.
- `workflows`: Homeboy-ingestible repo-domain prompts/tasks, artifact dependencies, participating agents, and required abilities.
- `artifacts`: WPSG and GitHub/Homeboy artifact schemas the loop emits or consumes.
- `dependencies`: SSI stack repositories and the behavior each owns.
- `gates` and `metrics`: WPSG metric definitions and pass expressions.

Homeboy maps these declarations to durable controller policy/actions through `agent-task controller from-spec`. Homeboy Extensions WordPress supplies WordPress/Codebox runtime details behind generic Homeboy executor/provider contracts when Homeboy selects that implementation.

## Quality Gates

The native controller exposes these WPSG-owned gate metrics and pass conditions:

- **Fallback blocks:** `fallback_blocks`, `fallback_block_count`, or `ssi_fallback_count` must be `0`.
- **Conversion findings:** actionable conversion finding count must be `0`; fallback/core HTML/freeform finding kinds are identified for Homeboy-owned routing.
- **Visual parity:** visual parity must report `status === "pass"`, `mismatch_count === 0`, and `max_delta_ratio === 0`.
- **Reviewer evidence:** reviewer-facing evidence must link to GitHub artifacts, PRs, or issues and must not use local-only URLs or filesystem paths.

The gate declarations define metrics and pass conditions only. Homeboy owns fail/pass routing, bounded revalidation, escalation, and completion decisions.

## Workflow Contracts

The controller declares workflow artifact dependencies and emissions. Homeboy decides how to execute the repo workflows:

1. `store-idea`, `website-idea`, `design-store`, `design-website`, `static-store`, and `static-site` declare concept, design, static-site candidate, import validation, and static-site PR artifacts.
2. `static-validation` declares static validation, import validation, and visual parity artifacts for a generated PR.
3. `finding-packets` declares normalized finding packets and grouped finding artifacts from validation evidence.
4. `iterator` declares grouped findings as input and upstream issue/PR artifacts as outputs.
5. `revalidation` declares validation artifacts after upstream iterator work.
6. `reviewer` declares reviewer gate outcome evidence from PR, validation, visual parity, findings, or iterator outputs.

## Complexity And Randomness Policy

Prompt difficulty is owned by WP Site Generator, not Homeboy. The checked-in policy at `.github/site-generation-complexity-policy.json` is evaluated by `.github/scripts/build-homeboy-site-generation-plan.mjs` every time the generation plan is built.

The generated plan records the full decision at `metadata.complexity_policy`, including:

- selected and current complexity tier
- ramp decision: `hold`, `raise`, `lower`, `hold_floor`, `hold_ceiling`, or `override`
- deterministic randomness seed and randomness profile
- site-kind mix
- tier layout/component families and criteria
- quality-signal path and explicit overrides used for the run

The same policy decision is also attached to generation task `inputs.complexity_policy`, copied into each Datamachine bundle config as `complexity_policy`, and injected into concept/design/candidate prompts. Candidate-producing prompts instruct the agent to record the tier, randomness seed/profile, site kind, layout family, component families, and policy decision in emitted artifact metadata.

### Quality Signals

Quality signals are optional JSON supplied through `WPSG_QUALITY_SIGNALS_PATH` or `HOMEBOY_QUALITY_SIGNALS_PATH`. When no signal file is supplied, the loop holds at the configured default tier.

Accepted shapes are either an array of recent results or an object with `recent_results`, `results`, or `validations`:

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

Stable quality raises at most one tier for the next plan. Regressions lower at most one tier. The floor and ceiling hold when the policy cannot move farther. This keeps prompt complexity reproducible and prevents a single good or bad run from skipping the configured ladder.

### Overrides

GitHub Actions exposes these optional inputs, which map directly to environment variables:

- `complexity_tier` -> `WPSG_COMPLEXITY_TIER`
- `randomness_profile` -> `WPSG_RANDOMNESS_PROFILE`
- `randomness_seed` -> `WPSG_RANDOMNESS_SEED`
- `quality_signals_path` -> `WPSG_QUALITY_SIGNALS_PATH`

Additional WPSG policy inputs are available for local plan generation:

- `WPSG_CURRENT_COMPLEXITY_TIER`: current tier when the signal file does not include one
- `WPSG_SITE_KIND_MIX`: comma-separated site-kind override
- `WPSG_TARGET_PARALLEL_CANDIDATES`: candidate budget override, bounded by the selected tier

Homeboy remains the controller, executor, and scheduler. It receives WPSG domain declarations, artifact contracts, task inputs, workload settings, and metadata that WPSG has computed.

## Actions Compatibility

`site-generation-loop.yml` builds the same generation plan and records `HOMEBOY_CONTROLLER_SPEC_PATH` so Actions-triggered runs point back to the Lab controller contract.

`static-site-validation.yml` calls the same shared scripts for Homeboy settings, Playground preview URLs, and php-transformer iterator dispatch. The Actions path still dispatches `php-transformer-iterator.yml`; native controllers should let Homeboy map the declared workflow ingredients to controller actions and then resume through the revalidation phase.

## Upstream Contract

Extra-Chill/homeboy#4658 is the upstream contract seam for compiling these repo declarations into controller execution. Extra-Chill/homeboy#4722 and Extra-Chill/homeboy#4723 are the from-spec ingestion alignment points this declaration shape follows. If a backend-specific WordPress or WP Codebox mapping is needed, it belongs behind generic Homeboy executor/provider contracts in `homeboy-extensions/wordpress`, not in this WPSG spec.
