# wc-static-site-agent bundle

Data Machine bundle that reads one open `status:idea-ready` issue from `chubes4/wc-site-generator` and authors a static HTML/CSS storefront PR for it.

## Lifecycle filter

The fetch handler in `flows/wc-static-site-manual-flow.json` queries GitHub for issues with:

- `state: open`
- `labels: status:idea-ready` — server-side positive filter, forwarded to GitHub's REST `list issues` endpoint.
- `exclude_labels: status:built,status:abandoned` — DMC's post-fetch negative label filter.

Both filters compose: `labels` narrows the server-side response to `status:idea-ready`, and `exclude_labels` drops anything that also carries a lifecycle label after the API call returns. Empty / missing `exclude_labels` is a no-op, so older bundles continue to work unchanged.

`exclude_labels` is generic in DMC — it knows nothing about `wc-site-generator`. The lifecycle vocabulary (`status:idea-ready`, `status:built`, `status:abandoned`) is owned by this repo and lives in the flow JSON, not the handler. See [Extra-Chill/data-machine-code#282](https://github.com/Extra-Chill/data-machine-code/pull/282) for the upstream feature.

## Lifecycle labels

Owned by `chubes4/wc-site-generator`:

- `status:idea-ready` — claimable by the static-site agent.
- `status:built` — a `target:static-site` PR is open that closes this idea.
- `status:abandoned` — the most recent `target:static-site` PR for this idea was closed without merging and no other open `target:static-site` PR claims it.

Transitions are maintained by `.github/workflows/idea-lifecycle-labels.yml` in the repository, not by this bundle. The workflow reacts to PR open / close-unmerged / issue-reopened events on the GitHub side; the fetch handler is the read-side consumer of the resulting label state.
