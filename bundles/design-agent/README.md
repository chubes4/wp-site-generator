# design-agent

The **design agent** is the bridge between the idea agents and the build agent. It does not write files. It does not open pull requests. It reads one open concept issue and decides the visual design direction for it, then posts that direction back as a structured `design.json` comment on the same issue.

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
                       static-site-agent
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
| `status:built` | The static site agent opened a PR closing this concept. |
| `status:abandoned` | The most recent target-lane PR for this concept closed without merging. |

The design agent is the only agent that performs the `status:idea-ready` → `status:design-ready` transition.

## What the design comment looks like

The design comment is shaped as:

```
## Design direction

```json
{
  "schema_version": 1,
  "design_system": "...",
  "palette_kind": "...",
  "palette": { "...": "#..." },
  "typography_kind": "...",
  "typography": { "...": "..." },
  "layout_direction": "...",
  "mood": "...",
  "notes": "..."
}
```
```

The exact field set is the design agent's call per concept. The fenced `json` block must parse as JSON. Downstream tooling reads whatever fields are present; there is no rigid schema.

## What the design agent must NOT do

- Write HTML, CSS, or any site file
- Open pull requests against the repo
- Pick a slug or branch (the build agent owns those)
- Reference platforms, frameworks, or build tooling
