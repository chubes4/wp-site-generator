# Generic Bundle/Workflow Execution Dependency

WPSG may know WP Codebox, but WPSG-owned controller specs, runtime task config, workflow callers, and tests should not know Data Machine or Data Machine Code once the generic execution primitive is available.

## Current Upstream State

Inspected dependency: `Extra-Chill/homeboy-extensions@origin/main`.

The generic primitive is not available yet. The current Homeboy Extensions runtime still translates agent bundle execution to `datamachine/run-agent-bundle`, and direct runtime-task execution still requires the caller to provide a concrete ability name.

## Required Upstream Primitive

WPSG adoption is blocked until Homeboy Extensions and WP Codebox expose a generic bundle/workflow execution descriptor that lets callers declare:

- bundle path or bundle repository/ref/path
- agent, pipeline, and flow selection
- optional workflow payload path or workflow-builder command
- runtime inputs such as prompt, target repository, budgets, artifacts, and output mappings

The descriptor must not require WPSG to pass `datamachine/run-agent-bundle`, `datamachine/execute-workflow`, `datamachine/run-flow`, or Data Machine component paths.

## WPSG Policy

Until that primitive is merged, WPSG keeps the existing references quarantined and documented. This repo must not add a local compatibility shim or rename the current Data Machine ability behind a WPSG-owned wrapper.
