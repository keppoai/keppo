---
name: promptify
description: Turn a bug description, feature request, rough idea, or issue summary into a short implementation prompt with exact file references and a precise description of what to change. Use when the user wants a tighter prompt for another agent or coding pass and values brevity over planning prose.
---

# Promptify

Convert vague product or engineering requests into a compact build prompt. Keep it sharp, concrete, and easy for another coding agent to execute.

## Workflow

1. Read the request and inspect only the code needed to ground it.
2. Identify the smallest set of files that are likely in scope.
3. Infer the concrete change:
   - current behavior or gap
   - desired behavior
   - exact code areas to modify
   - constraints or non-goals worth preserving
4. Produce a concise prompt, not a plan:
   - no throat-clearing
   - no long rationale
   - no speculative alternatives unless ambiguity is material

## Output

Return a short prompt in this shape:

```md
<one-sentence goal>

Change:
- <precise change 1>
- <precise change 2>

Files:
- `path/to/file` — <why this file matters>
- `path/to/file` — <why this file matters>

Constraints:
- <important guardrail>
- <important non-goal>
```

## Heuristics

- Prefer 2-5 files, not an exhaustive inventory.
- Name symbols, routes, components, tests, or functions when they make the task unambiguous.
- Include tests only when they should be added or updated.
- If file ownership is unclear, say `Likely files:` instead of pretending certainty.
- If the request is underspecified, make the prompt concrete by stating the most reasonable implementation assumption in one line.

## Do Not

- Write a multi-phase plan.
- Explain the whole architecture.
- List every related file in the repo.
- Pad the prompt with generic advice like "follow existing patterns" unless a specific pattern matters.

## Standard

Less is more. The result should feel like something a strong engineer would paste directly into a coding agent.
