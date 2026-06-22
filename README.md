# wp-site-generator

A factory for **WordPress static site implementations**, generated and validated through lab-native Homeboy loops. Sites can be commerce-shaped (WooCommerce storefronts) or content-shaped (blogs, local business sites, portfolios, professional services, nonprofits, etc.). Commerce is **one supported profile**, not the identity of the repo.

The repo knows about WordPress. The generation agents inside it do not — they describe real-world businesses, websites, designs, and static HTML, and never mention WordPress, themes, blocks, or import tooling. The WordPress-aware lane lives in the Homeboy controller spec, the Homeboy/Static Site Importer integration, and the transformer iterator.

The lab-native loop is represented by `.github/homeboy/controllers/static-site-generation-loop.controller.json`: concept packets, design packets, static-site candidates, import validation, static validation, visual parity, finding packets, revalidation attempts, and reviewer gate outcomes are controller runtime lineage entities. Generated-site PRs and upstream issue/PR URLs are publication evidence emitted after artifact gates, not transport required before validation or review.

Concurrency is the strategy. The system is designed to produce many credible starting points fast, not one perfect site slowly.

> Volume over perfection. If a hundred sites land in a day, the cost of any individual one being wrong is small, and the cost of finding a good one is just clicking a link.

---

## Four agents, one substrate

```
                +---------------------+    +-----------------------+
                |   store-idea-agent  |    |  website-idea-agent   |
                |   (commerce lane)   |    |   (content lane)      |
                +----------+----------+    +-----------+-----------+
                           |                           |
                           v                           v
                          emits ConceptPacket
                                     |
                                     v
                           +---------+----------+
                           |    design-agent    |
                           |  (palette / type / |
                           |   layout / mood)   |
                           +---------+----------+
                                     |
                                     v
                           emits DesignPacket
                                     |
                                     v
                            +---------+----------+
                            | static-site-agent  |
                            | (raw HTML/CSS site |
                            |  for the concept)  |
                            +---------+----------+
                                     |
                                     v
                             emits StaticSiteCandidate
                             and static-site PR
                                     |
                                     v
                             Homeboy lab runtime
                             runs Static Site Importer
                             against candidate artifacts
                             (typed runtime access,
                              provider/runtime agnostic)
                                     |
                                     v
                              durable validation evidence
                              + visual parity artifact
                              + typed preview/access URLs
                              + import-report.json artifact
                              + finding-packets.json artifact
                                      |
                                      v
                            +---------+----------+
                            | php-transformer-   |
                            | iterator-agent     |
                            | (per finding group |
                            |  fan-out)          |
                            +--------------------+
                                      |
                                      v
                            +---------+----------+
                            | ssi-stack-reviewer |
                            | agent              |
                            | (upstream PR gate) |
                            +--------------------+
```

Every layer is intentionally generic on its own:

- **The runtime substrate** doesn't know about WooCommerce.
- **The agents** don't know they run on WordPress, or how their output will be reviewed or imported.
- **The flows** don't know about validation.
- **Homeboy WordPress extension** doesn't know about Static Site Importer.
- **Static Site Importer** auto-detects whether the input is a content site or a Woo store from the input data; it does not branch on a flag.
- **The selected WordPress runtime** doesn't know about Homeboy.
- **The iterator** doesn't know about generated-site strategy; it consumes validation findings and routes upstream transformer gaps.

This repo is the only place all of them meet. The Homeboy controller spec is the shared contract for Lab execution and declares the enforceable artifact chain from concept packet through reviewer gate.

---

## Collaborating repos

This repository is the orchestration and generated-site source repo. The working system spans these repos:

- [`chubes4/wp-site-generator`](https://github.com/chubes4/wp-site-generator) — concept issues, runtime bundles, generated static-site candidates, validation declarations, and iterator fanout inputs.
- [`Extra-Chill/homeboy`](https://github.com/Extra-Chill/homeboy) — deterministic lab loop controller, durable agent-task state, fanout batches, and evidence/artifact lifecycle.
- [`Extra-Chill/homeboy-action`](https://github.com/Extra-Chill/homeboy-action) — optional GitHub Actions wrapper for triggering Homeboy from repository workflows.
- [`Extra-Chill/homeboy-extensions`](https://github.com/Extra-Chill/homeboy-extensions) — reusable WordPress runtime workloads, runtime access evidence, validation reporting, and iterator plumbing.
- [`chubes4/static-site-importer`](https://github.com/chubes4/static-site-importer) — WordPress plugin that imports each generated static site into a block theme.
- [`Automattic/blocks-engine`](https://github.com/Automattic/blocks-engine) — tagged PHP transform contract used by Static Site Importer for HTML-to-block conversion, block serialization, and site-artifact diagnostics.
- [`WordPress/wordpress-playground`](https://github.com/WordPress/wordpress-playground) — one supported WordPress runtime behind Homeboy's generic runtime contract.

The generated-site PR is only one artifact in the loop. Validation output can produce upstream PRs or issues in the importer and transformer repos, then the generated-site PR is revalidated against the improved stack.

---

## Agents

The agents are narrow on purpose.

### Idea agents

Implemented as two focused bundles:

- `store-idea-agent`
- `website-idea-agent`

#### `store-idea-agent`

Reads the recent issue corpus, picks the strongest distinct **commerce store concept** inside the industry the flow specifies, and files a `status:idea-ready` issue. Industry / problem space lives on flow user messages; flow labels carry the `site-kind:`, `commerce:`, and `industry:` axes. Ships eight industry-tuned flows plus a manual flow.

Issue body sections: Recommended Concept, Who It Serves, What It Offers, Why It Could Work, Issue Overlap Check, Next Step.

#### `website-idea-agent`

Same shape, different lane. Generates **non-commerce website concepts** (blog, local business, portfolio, professional services, nonprofit). Ships a manual flow plus focused local business, blog, portfolio, professional services, and nonprofit flows. Concepts whose core is an online storefront are excluded from this agent — they belong to the store agent.

### `design-agent`

The bridge between the idea agents and the build agent. Reads one open `status:idea-ready` source concept issue, decides one visual design direction (palette, typography, design system, layout direction, mood), opens a separate design-direction issue containing source issue metadata plus a fenced `json` block, and toggles the source concept from `status:idea-ready` to `status:design-ready`. Does not edit the source concept title/body. Does not write code. Does not open PRs. Does not pick slugs. The design issue's field set is the agent's call per concept; there is no rigid schema beyond source issue/title metadata and parseable design JSON.

### `static-site-agent`

Reads one open `status:design-ready` source concept issue plus the separate design-direction issue recorded by the design task, then authors a **static HTML/CSS site PR**. The source concept remains the identity contract: PR title, branch, static-site directory, and `Closes #...` derive from the concept issue, not the design issue. Files live under `static-sites/<slug>/`. The agent chooses the file set based on what the design needs. PRs open with `target:wordpress` for content concepts or `target:woocommerce` for commerce concepts. Validation happens through Homeboy lab runtime evidence.

PR title shape: `🧱 <Concept Name> — static site`. Branch: `static/<slug>`.

### `php-transformer-iterator-agent`

Consumes grouped SSI finding packets from a generated-site PR's validation run and routes each actionable finding to the owning upstream repo (`static-site-importer`, `Automattic/blocks-engine`, or `wp-site-generator`). It opens a focused upstream PR when the evidence is patchable, opens a fallback upstream issue when human narrowing is safer, and comments back on the generated-site PR with the upstream action. It is a repair loop for importer/transformer gaps, not a site-generation agent.

### `ssi-stack-reviewer-agent`

Reviews an upstream iterator PR before merge or promotion. It consumes the upstream PR URL plus finding-packet context and leaves a review/comment on that PR. It checks owner repo, generic transformer behavior, SSI layer purity, generator-specific leakage, regression coverage, and bootstrap-helper patches. It does not repair findings, open PRs, create issues, or duplicate the iterator role.

---

## Lifecycle and label axes

### Lifecycle (per issue)

| Label | Meaning |
| --- | --- |
| `status:idea-ready` | An idea agent published a concept; design has not been picked yet. |
| `status:design-ready` | The design agent created a separate design-direction issue for the source concept; the build agent can pick it up. |
| `status:built` | A target-lane PR currently claims the concept or the generated-site PR has merged and closed it. |
| `status:abandoned` | The most recent target-lane PR for this concept closed without merging and no other open target-lane PR still claims it. |

### Target lane (per PR)

- `target:wordpress` — content-shaped sites imported into WordPress.
- `target:woocommerce` — commerce-shaped sites imported into WordPress with WooCommerce available.

### Site kind / commerce / industry (per issue, set by idea flows)

- `site-kind:commerce`, `site-kind:content`
- `commerce:none`, `commerce:woocommerce`
- `industry:food-beverage`, `industry:home-craft`, `industry:outdoors-field`, `industry:apparel-accessories`, `industry:music-audio`, `industry:health-body`, `industry:pet-animal`, `industry:print-paper-stationery`, `industry:local-business`, `industry:blog`, `industry:portfolio`, `industry:professional-services`, `industry:nonprofit`

Idea flows publish issues with `status:idea-ready` plus the relevant `site-kind:`, `commerce:`, and `industry:` axes set.

---

## Validation Lane

Static-site validation is driven by `.github/homeboy/controllers/static-site-generation-loop.controller.json` with Homeboy-owned WordPress runtime execution. WPSG supplies backend-neutral runtime settings; Homeboy Extensions selects and normalizes the concrete adapter.

The validation loop:

1. Materializes a controller run spec with `agent-task controller run-from-spec`.
2. Installs Static Site Importer plus the shared block conversion stack via `wordpress_runtime_blueprint`; WooCommerce is added only for the commerce/WooCommerce lane.
3. Runs the Static Site Importer `static-site-importer/import-website-artifact` ability against the candidate website artifact.
4. Captures a Playwright visual parity comparison between the source static HTML and imported WordPress result.
5. Reads the resulting `import-report.json` and emits importer metrics plus durable artifact evidence.
6. Builds `finding-packets.json` for actionable importer, block, and visual parity failures.
7. Emits typed runtime access evidence, including reviewer-facing preview/access URLs supplied by the selected runtime.
8. Submits durable Homeboy fanout batches for the PHP transformer iterator when actionable finding packets exist.

This whole loop runs **without a hosted WordPress site**. The selected Homeboy runtime supplies the WordPress environment, access URLs, artifacts, provider credentials, and execution backend through generic contracts.

The target lane gates validation. `target:wordpress` marks content-shaped WordPress imports; `target:woocommerce` marks commerce-shaped imports and enables the WooCommerce stack. The build agent still emits static source files; Homeboy owns the WordPress import context.

Runtime preview/access links require immutable provenance from the PR head SHA, a source tag, or an artifact source. Preview generation fails closed instead of falling back to a mutable branch ref.

The Homeboy WordPress extension capability that makes this possible (`wordpress_runtime_workloads`) is generic. SSI is just one consumer; any WordPress plugin can be exercised the same way through lab runtime workloads.

---

## How Concepts Stay Distinct

- Idea agents publish a buildable concept directly instead of spending turns on corpus analysis.
- Prompt-level variety keeps concepts specific without trying to enforce global uniqueness.
- Adjacent but differentiated ideas are acceptable when the audience, offer, place, product angle, or site shape differs.

Prompt-level variety keeps the generator moving. Stronger duplicate prevention should be deterministic, ideally through runtime processed-item/idempotency machinery, rather than asking the model to police the corpus.

---

## What This Repo Contains

```
wp-site-generator/
  README.md
  homeboy.json                       Homeboy config: WordPress extension + base wordpress_runtime_blueprint
  .github/
    workflows/
      static-site-validation.yml     optional PR-triggered SSI import, visual parity, findings, iterator fanout
      site-generation-loop.yml       optional trigger for the Homeboy controller loop
      php-transformer-iterator.yml   upstream transformer repair loop from findings
      ssi-stack-reviewer.yml         review-only gate for upstream iterator PRs
  bundles/
    store-idea-agent/                runtime bundle: commerce concept generation
    website-idea-agent/              runtime bundle: non-commerce concept generation
    design-agent/                    runtime bundle: visual design direction
    static-site-agent/               runtime bundle: static HTML/CSS implementation
    php-transformer-iterator-agent/  runtime bundle: upstream transformer fixes
    ssi-stack-reviewer-agent/        runtime bundle: upstream PR review gate
  static-sites/                      generated raw HTML/CSS sites for SSI validation
    <slug>/
      index.html
      assets/styles.css
      ...                             agent's call: any files that faithfully implement the design
  resources/                         reusable theme bases / shared assets
  scripts/                           optional dev helpers
```

The agents are portable runtime bundles. Six focused bundles are tracked here. Runtime boundary references are enforced by the boundary test.

---

## How To Review A Generated Site

You don't need any of the agent infrastructure to review a generated site. From a PR:

1. Inspect the generated static site files or artifact linked from the PR body.
2. Review the Homeboy/SSI metrics, visual parity artifact, import report, typed runtime access evidence, and finding packets.
3. If validation found importer/transformer gaps, follow the iterator callback to the upstream PR or fallback issue before judging the generated site itself.
4. For upstream iterator PRs, run `ssi-stack-reviewer.yml` with the upstream PR URL and finding-packet context before merge or promotion.
5. If you like it, merge the PR. The source idea issue auto-closes via `Closes #<issue>` and remains `status:built`.
6. If it misses the concept or design, close the PR without merging. If no other open target-lane PR still claims the idea, the lifecycle workflow moves the issue to `status:abandoned`; reopen the issue to return it to `status:idea-ready` for another pass.

That's the loop. Generate. Design. Build. Validate. Review. Decide. Repeat.

---

## Operating The Loop

The primary loop is a Homeboy lab controller run. WPSG stamps domain inputs onto `.github/homeboy/controllers/static-site-generation-loop.controller.json` and calls `homeboy agent-task controller run-from-spec`, which materializes policy inputs, initializes durable state, and executes bounded controller actions. Homeboy owns controller state, action scheduling, event application, durable fanout batches, and runtime/provider selection.

Required credentials depend on the selected Homeboy runtime and AI provider. Configure provider credentials in the Homeboy/runtime contract rather than in WPSG workflows.

1. Runtime provider/model credentials supplied by the selected runtime profile.
2. Runtime selection hints such as `runtime_backend`, `runtime_provider_id`, or `runtime_selector` when the runtime profile needs a specific backend/provider route.

The reusable `.github/workflows/wpsg-runtime-agent-ci.yml` seam accepts a `runtime_workload_profile` such as `workspace-iteration` or `workspace-publication`, then renders Homeboy runtime profile/tool requirements through `.github/scripts/render-homeboy-runtime-workflow-inputs.mjs`. Runtime execution descriptors are rendered through `.github/scripts/render-runtime-bundle-execution.mjs` so workflows consume the shared runtime facade instead of embedding provider internals.

For deterministic contract validation, run `.github/scripts/validate-headless-site-generation-loop.mjs`. It drives `homeboy agent-task controller run-from-spec`, validates the returned materialization proof, then asserts WPSG artifact evidence with `.github/scripts/assert-site-generation-loop-proof.mjs`. The validator requires `--artifact-root` evidence emitted by a real Homeboy run and fails closed when required runtime, fanout, typed runtime preview/access, import, visual, or artifact URL evidence is absent. Iterator issue/PR artifacts and publication PR artifacts are optional for a clean candidate-only run, but are validated when emitted. Fixture assertions must pass `--proof-mode fixture`; production proof is the default and rejects fixture-only artifacts or placeholder `example.*` URLs.

The PHP transformer iterator supplies WPSG-owned finding grouping and fanout packet input, then calls Homeboy's public `homeboy agent-task fanout plan`, `submit-batch`, `status`, and `artifacts` primitives for durable fanout lifecycle evidence.

Useful workflow entry points:

1. **`store-idea-agent.yml`** — manually generate one commerce concept issue from a prompt.
2. **`website-idea-agent.yml`** — manually generate one content concept issue from a selected website flow.
3. **`design-agent.yml`** — attach a design direction to one issue.
4. **`static-site-agent.yml`** — build one design-ready issue into a static-site PR.
5. **`site-generation-loop.yml`** — optional trigger for the end-to-end Homeboy controller contract: concept packets, design packets, static candidates, validation, publication gates, iterator/revalidation, and reviewer evidence.
6. **`static-site-validation.yml`** — optional PR-triggered validation for labeled target-lane static-site PRs.
7. **`php-transformer-iterator.yml`** — automatic or manual upstream repair loop from validation finding packets.
8. **`ssi-stack-reviewer.yml`** — manual review-only gate for upstream iterator PRs before merge or promotion.

Local Studio remains useful for bundle development or manual runtime experiments. A local host needs:

1. A WordPress agent runtime capable of importing these bundles.
2. A GitHub credential profile scoped to this repo with `Contents`, `Issues`, and `Pull requests` write access.
3. An AI provider and model configured in the selected runtime.
4. The bundles imported and pointed at `chubes4/wp-site-generator`.

Use the active runtime's bundle import and flow-run commands to install or refresh bundles and run a default manual flow.

Each agent ships with a default manual flow. The store idea agent additionally ships industry-tuned commerce flows; the website idea agent ships focused content flows for local business, blog, portfolio, professional services, and nonprofit concepts. Add more by dropping new flow JSON into the relevant `bundles/<agent>/flows/` directory and reinstalling.

There is no auto-merge step. Merging is a human decision, and generated-site PRs are only mergeable when the imported WordPress result is clean enough to accept: zero fallback blocks and exact visual parity are the bar, not merely "a preview exists."

---

## Current Loop

1. Keep generated sites as raw static source PRs.
2. Keep WordPress import, visual parity, diagnostics, and typed runtime access evidence in Homeboy lab artifacts.
3. Convert actionable failures into compact finding packets.
4. Let durable Homeboy fanout batches route PHP transformer iterator work into focused upstream fixes or fallback issues.
5. Gate upstream iterator PRs with the SSI stack reviewer before merge or promotion.
6. Re-run the generated-site PR against the improved importer stack until the WordPress result is reviewable.

The repo exercises both sides of the loop: lab-native generation and validation, plus upstream repair from validation evidence.
