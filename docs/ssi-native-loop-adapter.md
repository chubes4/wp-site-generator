# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific orchestration for the continuous site-generation loop. GitHub Actions remains a supported trigger, but the reusable contract is the checked-in Homeboy controller spec at `.github/homeboy/controllers/static-site-generation-loop.controller.json` so a Lab/Homeboy controller can run the same phases without using Actions as the orchestrator.

The controller spec is the authority for the full loop:

```text
concept -> design -> candidate -> import validation -> publish PR
  -> static validation + visual parity -> finding packets
  -> iterator upstream PR -> reviewer gate
```

The native Lab path assumes the `codebox` backend. Inside the sandbox, Homeboy should mount the Codex provider overlay and required secrets for Codex execution; the Actions compatibility path may keep using the existing OpenAI provider checkout until Homeboy Extensions exposes those Codebox/Codex defaults.

## Native Controller Sequence

1. Build and run the site-generation Homeboy plan.

```bash
node .github/scripts/build-homeboy-site-generation-plan.mjs
homeboy agent-task run-plan --plan "@.ci/site-generation-loop.agent-task-plan.json" --record-run-id "$RUN_ID" --artifact-root "$HOMEBOY_ARTIFACT_ROOT"
```

The generated plan records `.github/homeboy/controllers/static-site-generation-loop.controller.json` in `metadata.controller_spec`. Lab controllers should use that field to bind plan execution back to controller lineage.

2. For each generated static-site PR/site, build the SSI validation settings and run the Homeboy bench workload.

```bash
SITE="$SITE" node .github/scripts/build-static-validation-settings.mjs --output ".ci/static-validation-settings-$SITE.json"
```

Use the emitted `settings.wp_codebox_blueprint`, `settings.wp_codebox_workloads`, and `workloads` values with the Homeboy WordPress bench runner. The dependency order intentionally remains WooCommerce, Block Artifact Compiler, Block Format Bridge, then Static Site Importer.

3. Build finding packets from bench and visual parity artifacts.

```bash
SITE="$SITE" \
SOURCE_REPO="$SOURCE_REPO" \
SOURCE_PR="$SOURCE_PR" \
SOURCE_HEAD_SHA="$SOURCE_HEAD_SHA" \
SOURCE_BRANCH="$SOURCE_BRANCH" \
VALIDATION_RUN_ID="$RUN_ID" \
node .github/scripts/build-ssi-finding-packets.mjs
```

4. Group findings and build the iterator workflow payload.

```bash
FINDING_GROUPS_PATH=.ci/finding-packets/grouped-finding-packets.json \
node .github/scripts/group-ssi-finding-packets.mjs .ci/finding-packets/finding-packets.json

VISUAL_ARTIFACT_DIR=.ci/visual-parity \
node .github/scripts/build-datamachine-iterator-workflow.mjs \
  .ci/finding-packets/grouped-finding-packets.json \
  .ci/datamachine-iterator-workflow.json
```

5. Submit the iterator through Homeboy natively.

```bash
DATAMACHINE_WORKFLOW_PATH=.ci/datamachine-iterator-workflow.json \
SOURCE_REPO="$SOURCE_REPO" \
SOURCE_PR="$SOURCE_PR" \
SOURCE_HEAD_SHA="$SOURCE_HEAD_SHA" \
VALIDATION_RUN_ID="$RUN_ID" \
node .github/scripts/build-homeboy-php-transformer-iterator-plan.mjs

homeboy agent-task run-plan --plan "@.ci/php-transformer-iterator.agent-task-plan.json" --record-run-id "php-transformer-iterator-$RUN_ID" --artifact-root "$HOMEBOY_ARTIFACT_ROOT"
```

## Actions Compatibility

`site-generation-loop.yml` builds the same generation plan and records `HOMEBOY_CONTROLLER_SPEC_PATH` so Actions-triggered runs point back to the Lab controller contract.

`static-site-validation.yml` calls the same shared scripts for Homeboy settings, Playground preview URLs, and php-transformer iterator dispatch. The Actions path still dispatches `php-transformer-iterator.yml`; native controllers should use `build-homeboy-php-transformer-iterator-plan.mjs` instead.

## Current Native Blockers

- Extra-Chill/homeboy#3905: autonomous controller pending-action execution.
- Extra-Chill/homeboy#3904: Lab `@file` plan staging.
- Extra-Chill/homeboy#4216: native nested controller/subloop execution for validation and iterator fan-out.
- Extra-Chill/homeboy#4218: controller lineage/event persistence for PRs, validation runs, findings, upstream PRs, and reviewer gates.
- Extra-Chill/homeboy-extensions#1319: Codex provider defaults through Codebox sandbox execution.
