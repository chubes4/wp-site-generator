# wc-static-site-agent bundle

Data Machine bundle that reads one open `status:idea-ready` issue from `chubes4/wc-site-generator` and authors a static HTML/CSS storefront PR for it.

## Lifecycle filter

The fetch handler in `flows/wc-static-site-manual-flow.json` queries GitHub for issues with:

- `state: open`
- `labels: status:idea-ready`

GitHub's REST `list issues` endpoint, and DMC's GitHub fetch handler on top of it, only support **positive** label filtering. There is no native `-label:` exclusion. Issue [#104](https://github.com/chubes4/wc-site-generator/issues/104) calls for skipping issues labelled `status:built` or `status:abandoned`.

### How exclusion is achieved without modifying DMC

1. **Primary mechanism — natural label exclusion via lifecycle.** The
   `.github/workflows/idea-lifecycle-labels.yml` workflow removes
   `status:idea-ready` from an idea the moment a `target:static-site` PR opens
   against it (and adds `status:built`). Because the fetch handler requires
   `status:idea-ready`, an idea that has been built or abandoned is no longer
   matched by the positive label filter. The lifecycle workflow is therefore
   the source of truth for "this idea is still claimable".

2. **Defense in depth — AI-step lifecycle guard.** The AI step prompt queue
   includes an explicit guard: if the fetched item's
   `metadata.github_labels` contains `status:built` or `status:abandoned`,
   the agent must stop and skip the idea. This protects against race
   conditions where the lifecycle workflow has not finished updating labels
   before the next fetch run.

If/when DMC ships native negative label filtering for the GitHub fetch
handler, the AI guard can move to the fetch step config and the prompt
instruction can be dropped.

## Lifecycle labels

Owned by `chubes4/wc-site-generator`:

- `status:idea-ready` — claimable by the static-site agent.
- `status:built` — a `target:static-site` PR is open that closes this idea.
- `status:abandoned` — the most recent `target:static-site` PR for this idea
  was closed without merging and no other open `target:static-site` PR claims
  it.

Transitions are maintained by the repo workflow, not by this bundle. See
`.github/workflows/idea-lifecycle-labels.yml` in the repository for the
authoritative state machine.
