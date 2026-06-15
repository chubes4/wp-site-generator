# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific orchestration for the continuous site-generation loop. GitHub Actions remains a supported trigger, but the reusable contract is the generated Homeboy controller spec at `.github/homeboy/controllers/static-site-generation-loop.controller.json` so Homeboy can compile the same phases into durable controller actions without using Actions as the orchestrator.

The controller builder is `.github/scripts/build-homeboy-ssi-loop-controller.mjs`. It emits the WPSG-owned loop contract that tracks candidate lineage, validation artifacts, finding packets, iterator work, upstream PR/issue URLs, revalidation attempts, and final reviewer-gate evidence.

The controller spec is the authority for the full self-improving loop:

```text
generation -> import validation -> publish PR
  -> static validation + visual parity -> finding packets
  -> iterator subloops -> revalidation -> reviewer gate
```

The spec is backend-agnostic. WPSG declares domain phases, artifacts, quality gates, dedupe keys, and action intent. Homeboy owns controller state and action execution. WordPress runtime/backend details belong to `homeboy-extensions/wordpress`, not to this repo-owned spec.

## Native Controller Path

Build or refresh the checked-in controller spec:

```bash
node .github/scripts/build-homeboy-ssi-loop-controller.mjs
```

The generated spec is intended for a Homeboy repo-loop bridge that compiles repo-owned phases into executable controller actions. The repo spec does not pick an executor backend or runtime provider.

Homeboy should checkpoint the configured events after candidate generation, import validation, PR publication, static validation, grouped findings, iterator subloops, revalidation, and the reviewer gate. Resume uses the controller `resume_key` plus the candidate identity, and dedupes repeated finding groups, iterator worktrees, and upstream PR actions through the declared `state.dedupe_keys`.

## Controller Actions

The generated spec uses action types instead of shell-command runbook strings:

- `build_plan`: run a repo-owned builder and materialize an agent-task plan artifact.
- `run_plan`: submit a materialized agent-task plan through Homeboy executor resolution.
- `build_workload`: run a repo-owned builder and materialize workload/settings artifacts.
- `run_workload`: submit a materialized workload through Homeboy workload execution.
- `normalize_findings`: convert validation artifacts into finding packets and grouped work.
- `run_gates`: evaluate Homeboy gate decisions from WPSG metric definitions.
- `fan_out`: expand grouped findings into deduped subloop work items.
- `spawn_subloop`: start a nested controller or task loop for one work item.
- `wait_for_subloops`: join nested controller/task loop outcomes before transition.
- `complete`: finish the controller with reviewer-facing evidence.
- `escalate`: block the controller with the exact missing evidence or exhausted gate.

Homeboy is expected to compile these actions into its durable controller policy. WPSG only names the domain artifact contracts, builders, gates, transitions, and dedupe keys.

## Quality Gates

The native controller stops publication/advancement unless the declared gates pass:

- **Fallback blocks:** `fallback_blocks`, `fallback_block_count`, or `ssi_fallback_count` must be `0`.
- **Conversion findings:** actionable conversion finding count must be `0`; fallback/core HTML/freeform findings route to iterator subloops.
- **Visual parity:** visual parity must report `status === "pass"`, `mismatch_count === 0`, and `max_delta_ratio === 0`.
- **Reviewer evidence:** reviewer-facing evidence must link to GitHub artifacts, PRs, or issues and must not use local-only URLs or filesystem paths.

Failed import/static/revalidation gates route through finding packet generation, grouped iterator workflows, upstream PR/issue tracking, and bounded revalidation attempts. Passing gates route to the SSI stack reviewer gate and then completion.

## Builder Contracts

The controller references existing repo-owned builders as phase inputs. Homeboy decides how to execute the resulting actions:

1. `generation` uses `.github/scripts/build-homeboy-site-generation-plan.mjs` to materialize `.ci/site-generation-loop.agent-task-plan.json`, then a `run_plan` action records concept, design, and candidate artifacts.

The generated plan records `.github/homeboy/controllers/static-site-generation-loop.controller.json` in `metadata.controller_spec`. Lab controllers use that field to bind plan execution back to controller lineage.

2. `import_validation` reuses the generation plan's validation tasks and then runs the fallback/conversion gates before PR publication.

3. `publish_pr` reuses the generation plan's publication tasks and records the static-site PR entity.

4. `static_validation` builds `.ci/static-validation-settings-${site}.json`, runs the SSI import workload, builds visual parity evidence, and runs fallback/conversion/visual-parity gates.

5. `finding_packets` runs the finding-packet and grouping builders, dedupes groups, and materializes `.ci/datamachine-iterator-workflow.json` when actionable work exists.

6. `iterator_subloops` fans out grouped findings, builds `.ci/php-transformer-iterator.agent-task-plan.json` per work item, spawns deduped subloops, and waits for upstream issue/PR outcomes.

7. `revalidation` repeats validation and finding normalization until gates pass or `max_attempts` is exhausted.

8. `reviewer_gate` builds `.ci/ssi-stack-reviewer.agent-task-plan.json`, verifies reviewer evidence, and completes or escalates from the reviewer decision.

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

Additional local-only knobs are available for controller/lab runs:

- `WPSG_CURRENT_COMPLEXITY_TIER`: current tier when the signal file does not include one
- `WPSG_SITE_KIND_MIX`: comma-separated site-kind override
- `WPSG_TARGET_PARALLEL_CANDIDATES`: candidate budget override, bounded by the selected tier
- `HOMEBOY_MAX_CONCURRENCY`: optional lower cap for plan `max_concurrency`

Homeboy remains a generic controller, executor, and scheduler. It only receives the action graph, plan artifacts, task inputs, workload settings, and metadata that WPSG has already computed.

## Actions Compatibility

`site-generation-loop.yml` builds the same generation plan and records `HOMEBOY_CONTROLLER_SPEC_PATH` so Actions-triggered runs point back to the Lab controller contract.

`static-site-validation.yml` calls the same shared scripts for Homeboy settings, Playground preview URLs, and php-transformer iterator dispatch. The Actions path still dispatches `php-transformer-iterator.yml`; native controllers should use the compiled `build_plan`, `spawn_subloop`, and `wait_for_subloops` actions, then resume through the controller's revalidation phase.

## Current Native Blockers

- Extra-Chill/homeboy#3905: autonomous controller pending-action execution.
- Extra-Chill/homeboy#3904: Lab `@file` plan staging.
- Extra-Chill/homeboy#4216: native nested controller/subloop execution for validation and iterator fan-out.
- Extra-Chill/homeboy#4218: controller lineage/event persistence for PRs, validation runs, findings, upstream PRs, and reviewer gates.
- Extra-Chill/homeboy#4647: generic repo loop spec compiler that turns phase actions into executable controller policy/actions.
- Extra-Chill/homeboy-extensions#1319: Codex provider defaults through Codebox sandbox execution.
