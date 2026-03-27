---
name: create-plan
description: Create an implementation plan in plans/ with clear goal, actionable checklists, and specific file references.
---

# Create Plan

Use this skill when the user asks you to create an implementation plan, execution plan, or roadmap for a task.

## Workflow

### Step 1: Deep Discovery (DO NOT SKIP)

**This is a critical plan. Before writing a single line of the plan, you MUST thoroughly interrogate the requirements.** Do not assume you understand the task from a brief description. Plans built on wrong assumptions waste far more time than the questions cost.

**a) Ask clarifying questions aggressively.** Use `AskUserQuestion` to surface hidden assumptions and ambiguity. Do NOT proceed to writing the plan until the user has answered your questions. Ask about:

- **Scope & boundaries:** What exactly is in scope? What is explicitly out of scope? Are there adjacent systems the user does NOT want touched?
- **Success criteria:** How will the user know this work is done and correct? What does "good enough" look like vs. gold-plated?
- **Constraints & preferences:** Are there specific technologies, patterns, or approaches the user wants to use or avoid? Are there performance, compatibility, or timeline constraints?
- **Edge cases & error handling:** What should happen when things go wrong? What are the known edge cases? What failure modes matter most?
- **Dependencies & ordering:** Does this work depend on or block other work? Are there external services, APIs, or teams involved?
- **Existing context:** Has the user already tried an approach that didn't work? Is there prior art, a prototype, or existing code that informs this?
- **User's mental model:** What does the user think the solution looks like? Do they have a preferred architecture or approach in mind, or are they looking for recommendations?

**b) State your assumptions back to the user.** After initial research, explicitly list what you believe to be true and ask the user to confirm or correct. For example: "I'm assuming X, Y, and Z — is that right, or am I off on any of these?"

**c) Ask follow-up questions.** The first round of answers will often reveal new ambiguities. Ask a second round of targeted questions before proceeding. It is better to ask too many questions than to build a plan on shaky foundations.

### Step 2: Research the Codebase

Before writing the plan, thoroughly explore the files and architecture that will be affected. Identify the specific files that need changes, understand existing patterns, and find any constraints or risks. Cross-reference what you find with the user's answers from Step 1 — if the codebase contradicts an assumption, flag it immediately.

### Step 3: Confirm Approach

Before writing the full plan, present a brief summary of your proposed approach (2-5 bullet points) and ask the user to approve the direction. This catches misalignment early before you invest in the detailed plan. Include:

- The high-level approach / architecture
- Which major files or systems will be affected
- Any trade-offs you've identified and which side you're leaning toward
- Anything you're still uncertain about

### Step 4: Write the Plan

Write the plan to `plans/<slug>.md` using the template below. The slug should be a short kebab-case name describing the work (e.g., `add-webhook-retries`, `refactor-auth-flow`).

### Step 5: Review the Plan

Review the plan against the quality checklist before presenting it to the user. Ask the user to review and flag anything that looks wrong or incomplete.

## Template

```markdown
# Plan: <Title>

## Status: Draft
<!-- When completed: change to "## Status: Done", add [PLAN HAS BEEN COMPLETED] and [PLAN DONE AT COMMIT <hash>] here -->

## Goal

<1-3 sentences describing what this plan achieves and what the end state looks like when complete.>

## Problem

<Why this work is needed. What's broken, missing, or suboptimal today.>

## Non-Goals

<Explicit list of things this plan does NOT cover. Helps prevent scope creep.>

## Implementation Plan

### Phase 1: <Phase Name>

**Files changed:**

- `path/to/file.ts`
- `path/to/other-file.ts`

**Steps:**

- [ ] First concrete action item
- [ ] Second concrete action item
- [ ] Third concrete action item

**Verification:** <How to confirm this phase is correct — e.g., which tests to run, what to check.>

### Phase 2: <Phase Name>

...continue for each phase...

## Files Changed

<Summary list of all files created, modified, or deleted across all phases.>

## Risks and Mitigations

| Risk          | Likelihood      | Impact          | Mitigation      |
| ------------- | --------------- | --------------- | --------------- |
| <description> | Low/Medium/High | Low/Medium/High | <how to handle> |

## Definition of Done

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>
```

## Quality Checklist

Before finalizing the plan, verify all of these:

- [ ] **Clear goal and end state.** Someone reading only the Goal section should understand what "done" looks like.
- [ ] **Actionable checklist items.** Every `- [ ]` item is a concrete action (create, modify, add, remove, update), not a vague instruction like "consider" or "think about".
- [ ] **Specific file paths.** Each phase lists the exact files to change. Never include line numbers (they shift as code changes). Do reference function/class/variable names when helpful.
- [ ] **Single-run completable.** The entire plan can be executed in one session without waiting for external events, deployments, manual migrations, or human approvals mid-execution. If the work has external dependencies, explicitly scope them out as non-goals or move them to a clearly marked "post-merge" section outside the checklist.
- [ ] **No deployment/cutover steps in the checklist.** Deploy, canary, rollout, and monitoring steps belong in a separate section (e.g., "Rollout Strategy") outside the main checklist, since they can't be done in-repo.
- [ ] **Verification per phase.** Each phase explains how to confirm it worked (run tests, check build, verify behavior).
- [ ] **Risks identified.** At least consider what could go wrong and how to handle it.
- [ ] **Spec/doc updates included.** If the work changes behavior, architecture, APIs, schema, or runtime requirements, include updating the relevant specs and docs as checklist items (per CLAUDE.md rules).

## Important Constraints

- **No line numbers.** Reference files by path and optionally by function/class/symbol name. Line numbers become stale immediately.
- **Checklist items must be completable in-repo.** Don't include items that require waiting for CI, staging deploys, customer feedback, or other external gates. Those are out of scope for the plan's execution checklist.
- **Keep phases small and independently verifiable.** Each phase should be testable on its own. If a phase fails, earlier phases should still be valid.
- **Match the codebase's existing patterns.** Read how similar things are done before proposing a new approach. Reference existing code as precedent where relevant.
- **Include an iteration log table** at the bottom of the plan (empty initially) for tracking execution progress. Each iteration records the commit hash(es) produced during that cycle:

```markdown
## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
```

**Commit column:** After each `$commit`, run `git rev-parse --short HEAD` and record the hash. Multiple commits in one iteration are comma-separated. Use "—" if no commits were made.

**Plan completion:** When the plan is fully done:
1. Commit remaining work with `$commit`.
2. Get the final hash: `git rev-parse --short HEAD`.
3. Change `## Status: Draft` to `## Status: Done`.
4. Add `[PLAN HAS BEEN COMPLETED]` on the line after the Status heading.
5. Add `[PLAN DONE AT COMMIT <hash>]` on the next line using the final commit hash.
