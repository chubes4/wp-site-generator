# Homeboy Lab Primitive Gaps

WPSG no longer keeps GitHub Actions wrappers for production loop orchestration. The repo owns domain specs, bundle prompts, artifact contracts, and deterministic validators. Homeboy/Homeboy Extensions own execution.

## Needed Upstream Primitives

- **Lab loop run:** submit `.github/homeboy/headless-production-loop.json` for `count`, `duration`, and `until_stopped` modes with durable status, cancellation, and artifact handles.
- **Controller execution:** run `.github/homeboy/controllers/static-site-generation-loop.controller.json` with generated inputs and structured `--output` evidence without repo-local workflow glue.
- **Runtime profile selection:** choose runtime id, provider, model, provider plugin mounts, and secret env through Homeboy runtime profiles, not WPSG YAML.
- **WordPress validation workload:** run SSI import, visual parity capture, import report parsing, finding packet generation, and typed `runtime_access` evidence as a Homeboy lab workload.
- **Iterator fanout:** submit grouped WPSG finding packets to durable Homeboy fanout, join results, and expose upstream PR/issue evidence.
- **Reviewer gate:** run the SSI stack reviewer bundle against upstream iterator PRs and record the review comment/gate result.
- **Evidence bundle:** publish controller result, materialization proof, runtime access, validation reports, screenshots/diffs, finding packets, fanout records, and reviewer gates from Homeboy run artifacts.

Until these primitives are complete, missing functionality should fail as an upstream Homeboy/Homeboy Extensions gap. WPSG should not add new GitHub Actions workflow wrappers to compensate.
