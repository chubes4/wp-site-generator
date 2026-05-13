# static-site-agent

The **static site agent** is the build agent for this repo. It reads one design-ready concept issue (concept body + the design agent's `design.json` comment) and opens a pull request containing the static HTML/CSS site that implements the design.

## Where it sits in the loop

```
store-idea-agent      ─┐
                       ├─►  status:idea-ready issue
website-idea-agent    ─┘
                                │
                                ▼
                        design-agent
                                │
                                ▼
                  status:design-ready issue
                  (carries design.json comment)
                                │
                                ▼
                       static-site-agent  ◄── this agent
                                │
                                ▼
                  target:<wordpress|woocommerce> PR
                  (closes the concept issue)
                                │
                                ▼
                  status:built (or status:abandoned
                  if the most recent PR closes
                  without merging)
```

## Lifecycle labels (this repo)

| Label | Meaning |
| --- | --- |
| `status:idea-ready` | An idea agent published a concept; design has not been picked yet. |
| `status:design-ready` | The design agent attached a `design.json` comment to the concept; the build agent can pick it up. |
| `status:built` | This agent opened a PR closing the concept and that PR was merged. |
| `status:abandoned` | The most recent target-lane PR for the concept closed without merging. |

This agent is the only one that opens target-lane pull requests.

## What it does

- Fetches one open issue with `status:design-ready` (excluding `status:built` and `status:abandoned`).
- Reads the issue body (concept) and the most recent design-agent comment (design direction).
- Generates files under `static-sites/<slug>/`. The exact set of files is the agent's call based on what the design needs.
- Opens a PR with `target:wordpress` for content concepts or `target:woocommerce` for commerce concepts, branch `static/<slug>`, title `🧱 <Concept Name> — static site`, body documenting Generated Files / Design Intent / AI Assistance / `Closes #<issue>`.

## What it does NOT do

- Invent concepts (idea agents do that).
- Pick designs (design agent does that).
- Validate its output (the CI lane does that).
- Reference platforms, frameworks, or build tooling (the agent is platform-blind).
