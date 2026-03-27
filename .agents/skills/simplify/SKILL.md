---
name: simplify
description: Make existing code simpler to read, understand, and maintain without changing functionality. By default, target the current uncommitted code unless the user points to a different file, diff, or area. Use when the user asks to simplify, clean up, refactor for clarity, reduce duplication, or improve code structure while preserving behavior.
---

# Simplify Code

Use this skill when the goal is a behavior-preserving refactor. Unless the user says otherwise, assume the target is the current uncommitted diff.

## Outcomes

- Reduce complexity without changing observable behavior.
- Make the next edit easier for a human to reason about.
- Keep diffs focused and reviewable.

## Workflow

1. Start from the current uncommitted changes by default:
   - inspect `git diff --stat` and `git diff`
   - if the user named a specific target, use that instead
2. Read the affected code and identify why it is hard to maintain:
   - duplication
   - deeply nested control flow
   - unclear naming
   - mixed responsibilities
   - dead branches or indirection
3. Confirm the current behavior from tests, nearby usage, or both before changing structure.
4. Prefer the smallest refactor that materially improves readability:
   - extract a helper
   - inline unnecessary abstraction
   - rename symbols for intent
   - collapse repetitive branches
   - separate data shaping from side effects
5. Preserve external contracts exactly unless the user explicitly asks otherwise:
   - inputs and outputs
   - side effects
   - error behavior
   - public APIs
   - test expectations
6. Add or update focused tests when they are needed to lock behavior before or after the refactor.
7. Verify with the narrowest relevant test or typecheck command for the touched area.

## Heuristics

- Prefer explicit code over clever code.
- Prefer one obvious path over condition-heavy branching.
- Prefer local helpers when reuse is file-local.
- Remove dead code only when you can show it is unused or redundant.
- Avoid bundling style churn with structural improvement unless formatting is required to make the result readable.

## Do Not

- Change product behavior, data shape, or user-visible copy unless the user asks.
- Introduce large architectural rewrites when a local cleanup solves the problem.
- Hide complexity behind abstractions that are harder to follow than the original code.
- Split code across more files unless that clearly improves ownership or comprehension.

## Deliverable

Report the simplification in terms of what became easier to understand and how you verified behavior stayed the same.
