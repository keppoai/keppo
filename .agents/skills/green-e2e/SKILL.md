---
name: green-e2e
description: Run the full E2E suite and fix root-cause failures in application code (not test hacks).
---

# Green E2E

Use this skill when the user asks to get the end-to-end suite green.

## Workflow

1. Confirm we are in the repository root.
2. Run the full E2E command:
   - `pnpm test:e2e`
3. For each failure, fix the underlying application or infra behavior (not test assertions, unless the test is incorrect).
4. Re-run `pnpm test:e2e` after each meaningful fix.
5. Repeat until the suite completes successfully.
