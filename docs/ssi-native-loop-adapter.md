# SSI Native Loop Adapter

This repo owns the Static Site Importer-specific orchestration for the continuous site-generation loop. GitHub Actions remains a supported trigger, but the reusable contract is now script-first so a Lab/Homeboy controller can run the same phases without using Actions as the orchestrator.

## Native Controller Sequence

1. Build and run the site-generation Homeboy plan.

```bash
node .github/scripts/build-homeboy-site-generation-plan.mjs
homeboy agent-task run-plan --plan "@.ci/site-generation-loop.agent-task-plan.json" --record-run-id "$RUN_ID" --artifact-root "$HOMEBOY_ARTIFACT_ROOT"
```

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

`static-site-validation.yml` calls the same shared scripts for Homeboy settings, Playground preview URLs, and php-transformer iterator dispatch. The Actions path still dispatches `php-transformer-iterator.yml`; native controllers should use `build-homeboy-php-transformer-iterator-plan.mjs` instead.
