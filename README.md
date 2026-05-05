# wc-store-blueprints

A Data Machine loop that generates **WooCommerce store previews** at scale.

Ideas live as **GitHub issues**. Store implementations arrive as **pull requests**. A PR either contains a direct WordPress Playground blueprint, or a static site that CI imports through Static Site Importer and reports back with an imported Playground preview plus SSI/BFB/H2BC telemetry. Concurrency is the strategy: the system is designed to produce many credible starting points fast, not one perfect store slowly.

> Volume over perfection. If a hundred blueprints land in a day, the cost of any individual one being wrong is small, and the cost of finding a good one is just clicking the Playground link.

---

## What the user sees

1. **Issues** in this repo represent generated store concepts. Title shape: `🛒 <Concept Name> — <one-liner>`.
2. **Pull requests** in this repo propose blueprints for those concepts. Title shape: `🛍️ <Concept Name> — <one-liner>`.
3. Every PR body contains a **WordPress Playground preview link** of the form

   ```
   https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/chubes4/wc-store-blueprints/<branch>/blueprints/<slug>/blueprint.json
   ```

   Click it. The store boots inside the browser. No local install, no setup, no auth.
4. Each PR closes its source idea on merge via a `Closes #<issue>` reference. PRs that aren't merged keep their source idea open so the same concept can be retried.

That's the entire reviewer experience. Open a PR, click the link, decide if you like the store.

---

## How the work flows

```
                    +--------------------+
                    |   wc-idea-agent    |
                    |  (concept finder)  |
                    +---------+----------+
                              |
                              v
                   reads recent issues (open + closed)
                              |
                              v
                   generates 1 candidate concept
                              |
                              v
                   opens a GitHub issue (the "idea")
                              |
                              v
+-------------------------------------------------------------+
|                         GITHUB                              |
|  Issues = idea queue   PRs = proposed blueprints            |
+-------------------------------------------------------------+
                              ^
                              |
                   opens a PR for that idea
                              |
                              v
                   commits blueprint.json + theme files
                   to a new branch: store/<slug>
                              |
                              v
                   PR body includes Playground preview link
                              |
                    +---------+----------+
                    | wc-blueprint-agent |
                    |  (implementation)  |
                    +--------------------+
```

There are three agents. Each is narrow on purpose.

### Agent 1 — `wc-idea-agent`

**Job:** turn a loose problem space into a distinct, buildable WooCommerce store concept and queue it for implementation.

**What it does on each run:**

1. Reads recent open and recently-closed GitHub issues to avoid duplicating concepts already in flight.
2. Generates 2–5 candidate store concepts internally and picks the strongest based on novelty, clarity, and buildability.
3. Compares against the existing issue corpus. If the closest match is materially overlapping, the run is suppressed; if it is adjacent but differentiated, the differentiation is stated.
4. Opens a new GitHub issue with the concept written out: name, target customer, what it sells, why it could work.

The idea agent does **not** generate blueprints. It produces work items.

### Agent 2 — `wc-blueprint-agent`

**Job:** take an open idea and turn it into a runnable WooCommerce store as a pull request.

**What it does on each run:**

1. Picks the next open idea issue labeled `status:idea-ready` and `target:blueprint` that doesn't already have a PR pointing at it.
2. Generates the blueprint files for that concept:
   - `blueprints/<slug>/blueprint.json` — the WordPress Playground blueprint
   - `blueprints/<slug>/theme.json` — global styles, palette, typography
   - `blueprints/<slug>/templates/home.html` — the front-page template
   - `blueprints/<slug>/parts/header.html` and `parts/footer.html`
   - `blueprints/<slug>/products.csv` — product seed data
3. Creates a `store/<slug>` branch and commits the files to it.
4. Opens a pull request against `main` with:
   - the Playground preview link in the body
   - a Creative Decisions section (palette / typography / layout reasoning)
   - a Product Catalogue table
   - an Assumptions section
   - `Closes #<issue>` so merge auto-closes the idea

The blueprint agent does **not** invent concepts. It only implements existing issues.

### Agent 3 — `wc-static-site-agent`

**Job:** take an open idea and turn it into a static WooCommerce-style storefront source site as a pull request.

**What it does on each run:**

1. Picks the next open idea issue labeled `status:idea-ready` and `target:static-site`.
2. Generates source files under `static-sites/<slug>/`:
   - `index.html`
   - `assets/styles.css`
   - optional supporting assets/data such as `products.json`
3. Creates a `static/<slug>` branch and commits the files to it.
4. Opens a pull request against `main` with `Closes #<issue>`.

The static-site agent does **not** run Static Site Importer and does **not** write telemetry. CI/Homeboy owns import, validation, metrics, artifacts, and the imported-site Playground preview link.

### Why three agents instead of one

Splitting "what should we build" from "how do we build it" keeps each agent's prompt and tool surface narrow. Concept generation can read prior GitHub issues without the implementation noise; blueprint generation can focus on Playground rules and block validity, while static-site generation can focus on realistic source HTML for SSI. It also lets us scale them independently — many idea workers feeding many blueprint and static-site workers — without one lane bottlenecking the other.

---

## How Playground links work

Blueprint PRs use a direct blueprint link. Static-site PRs use a CI-generated imported-site preview link.

### Blueprint PRs

Every PR body contains exactly one preview link of this shape:

```
https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/chubes4/wc-store-blueprints/<branch>/blueprints/<slug>/blueprint.json
```

Three things happen when a reviewer clicks it:

1. WordPress Playground boots a clean WordPress + WooCommerce environment in the browser.
2. It fetches `blueprint.json` directly from the PR's branch via `raw.githubusercontent.com`.
3. The blueprint installs the theme files, seeds the products, sets the home page, and lands the reviewer on the rendered storefront.

There is no infrastructure to host. There is no preview environment to provision. The PR branch itself is the preview, because Playground reads it directly.

### Static-site PRs

Static-site PRs are validated after the agent finishes. The validation workflow is gated on the `target:static-site` label, so normal blueprint PRs keep using direct Playground links and never run SSI telemetry.

```
static-sites/<slug>/...
        |
        v
Homeboy CI imports the source site through Static Site Importer
        |
        v
Homeboy collects SSI/BFB/H2BC telemetry and artifacts
        |
        v
Homeboy posts a PR comment with metrics and an imported-site Playground link
```

The static-site agent only writes source HTML/CSS/assets. The validation harness imports that source into WordPress, packages the imported result for Playground, and reports importer quality without the agent knowing about the telemetry system.

This is also how merge works for free: the reviewer either merges the PR (and the source idea closes), or leaves it. Volume of decent starting points compounds.

---

## How concepts stay distinct

The de-duplication strategy is intentionally lightweight at the issue layer:

- Before opening an issue, the idea agent reads the recent issue corpus (open + closed).
- Material overlap → the candidate is dropped, no issue is opened.
- Adjacent but differentiated → the differentiation is stated in the issue body so reviewers see why it isn't a duplicate.

When concurrency increases, two issue runs can briefly race. The intent is to live with low collision rates and rely on volume to outweigh the few duplicates. If duplication becomes painful, a shared dedup index belongs in the agent layer, not in this repo.

---

## How blueprints stay valid

Each generated blueprint has to:

1. Boot in WordPress Playground without errors.
2. Render the home page without empty regions.
3. Use **section styles** for color application — not per-block color overrides.
4. Use **global styles / element styles** for typography — not hardcoded fonts on individual blocks.
5. Produce **AA contrast** between text and background on every default surface.
6. Pass Gutenberg block validation when the home template is loaded into the editor.

Today the system relies on prompt rules + Playground booting cleanly as the validation gate. The richer block-validation pass (running the blueprint inside Playground programmatically and capturing block invalidation reports) is a planned upgrade and will sit in the blueprint agent's pipeline as an explicit step.

---

## What this repo contains

```
wc-store-blueprints/
  README.md                  ← this file
  .gitignore
  .gitattributes
  blueprints/                ← generated Playground blueprints, one directory per store
    <slug>/
      blueprint.json
      theme.json
      templates/home.html
      parts/header.html
      parts/footer.html
      products.csv
  static-sites/              ← generated static source sites for SSI validation
    <slug>/
      index.html
      assets/styles.css
      products.json
  resources/                 ← reusable theme bases / shared assets
  scripts/                   ← optional dev helpers (not required to use a blueprint)
```

The agents themselves live as a portable **Data Machine bundle**, not in this repo. The bundle is what knows how to read issues, generate blueprints, and open PRs against this repo. It is exported as a directory or zip, installed on a Studio (or other Data Machine) site, pointed at this repo, and run.

---

## How to use a blueprint as a designer

You don't need any of the agent infrastructure to use a blueprint. From a PR (or `main`):

1. Click the **Playground preview link** in the PR body. The store boots in the browser.
2. If you like it, merge the PR. The source idea issue auto-closes via `Closes #<issue>`.
3. If you want to take it further locally, copy `blueprints/<slug>/` into a Studio site or any WordPress install with WooCommerce.

That's the loop. Generate. Click. Decide. Repeat.

---

## How to run the agents (operator notes)

The agents run as Data Machine agent bundles on a host site (currently a Studio site). The host site needs:

1. **Data Machine** + **Data Machine Code** plugins active.
2. A **GitHub credential profile** in DMC scoped to this repo with `Contents`, `Issues`, and `Pull requests` write access.
3. An **AI provider** configured (OpenAI today, with the bundle pinned to `gpt-5.5`; Claude planned later for the idea agent).
4. The agent bundle imported and pointed at `chubes4/wc-store-blueprints`.

Both flows are **manual-trigger** by default during validation:

```
studio wp datamachine flow run <wc-idea-flow-id>
studio wp datamachine flow run <wc-blueprint-flow-id>
studio wp datamachine flow run <wc-static-site-flow-id>
```

Once the loop is observed end-to-end, scheduling is enabled and concurrency is increased. There is no fixed daily cap; the goal is to scale toward many parallel idea+blueprint workers so a backlog of preview-ready PRs exists for any reviewer at any time.

There is no auto-merge step. Merging is a human decision.

---

## Status

- `chubes4/wc-store-blueprints` repo seeded.
- Data Machine Code v0.30.0 in place with `create-github-issue` and `create-github-pull-request` abilities and credential profiles.
- Agent bundle (manual-trigger flows) under construction on the host Studio site.
- First end-to-end pass (one idea → one blueprint PR with a working Playground link) is the validation gate before scaling concurrency.
