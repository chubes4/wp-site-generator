# ssi-stack-reviewer-agent

The **SSI stack reviewer agent** is a review-only gate for upstream iterator PRs before merge or promotion.

## Where it sits

```
generated-site PR
      │
      ▼
SSI validation finding packets
      │
      ▼
php-transformer-iterator-agent opens upstream PR
      │
      ▼
ssi-stack-reviewer-agent reviews that PR
```

## What it does

- Consumes an upstream PR URL plus finding-packet context.
- Checks owner repo, layer purity, generic transformer behavior, regression coverage, and bootstrap-helper avoidance.
- Leaves one upstream PR comment headed `## SSI Stack Reviewer Gate` with `PASS`, `NEEDS WORK`, or `INSUFFICIENT EVIDENCE`.

## What it does NOT do

- Repair findings.
- Open upstream PRs or issues.
- Create worktrees or edit code.
- Duplicate the PHP transformer iterator role.
