# Plan: Update Session-Log Endpoint For Cross-Job Issue-Agent Artifacts

## Status: Draft

<!-- When completed: change to "## Status: Done", add [PLAN HAS BEEN COMPLETED] and [PLAN DONE AT COMMIT <hash>] here -->

## Goal

Extend the session-log upload service so `issue-agent` can move agent-produced artifacts from a read-only runner into a fresh trusted runner without falling back to GitHub artifacts or same-runner privileged steps. When complete, `issue-agent-issue-to-pr.yml` can upload a git bundle and metadata through the existing upload API family, and the trusted job can download and validate those exact files before push and PR creation.

## Problem

`issue-agent-plan.yml` can separate the agent run from the write-scoped comment-posting step today because the only required outputs are small comment bodies that fit in job outputs. `issue-agent-issue-to-pr.yml` cannot do the same yet because the trusted job needs the agent's commit graph, PR metadata, optional demo metadata, and session-log links on a new runner. The current session-log service only documents prepare/upload/complete plus human-facing `viewer_url` links; it does not document an authenticated raw-download contract or a machine-readable manifest format that a trusted workflow can consume safely.

## Non-Goals

- Replacing the current upload path for recent-review/security-review workflows.
- Migrating `fix-pr.yml` in the same change, even though the endpoint contract should be reusable there.
- Exposing uploaded artifacts publicly or weakening the existing bearer-auth boundary.
- Using `actions/upload-artifact` for agent workspaces, prompt files, or session logs.

## Implementation Plan

### Phase 1: Define the cross-job artifact contract

**Files changed:**

- `docs/github-session-log-upload-api.md`
- `plans/update-session-logs-endpoint.md`

**Steps:**

- [ ] Extend the API doc with an authenticated raw-download flow for uploaded artifacts, including the exact endpoint shape, auth model, cache behavior, and error codes.
- [ ] Define which non-log artifacts `issue-agent-issue-to-pr.yml` is allowed to upload through explicit extra roots: a git bundle, PR metadata JSON, optional demo metadata, and any comment body files needed by the trusted job.
- [ ] Document the integrity contract for downloads so the trusted job must verify `artifact_id`, `relative_path`, `size_bytes`, and `sha256_hex` against the uploaded manifest before using any downloaded file.
- [ ] Decide whether the download path returns raw bytes directly, a short-lived signed blob URL, or a manifest of signed URLs, and record that choice explicitly so the workflow code does not guess.

**Verification:** Review the updated contract and confirm it is sufficient for a trusted job to reconstruct agent outputs without reading mutable workspace state from the agent runner.

### Phase 2: Teach the workflow helpers to publish and restore explicit artifacts

**Files changed:**

- `scripts/issue-agent/upload-session-logs.sh`
- `scripts/issue-agent/download-uploaded-artifacts.sh`
- `tests/scripts/upload-session-logs.test.ts`
- `tests/scripts/download-uploaded-artifacts.test.ts`

**Steps:**

- [ ] Extend `upload-session-logs.sh` to optionally write a machine-readable response manifest to disk so later workflow steps can pass artifact ids and expected hashes across jobs without scraping markdown comments.
- [ ] Add a dedicated download helper that takes the saved manifest, downloads each expected artifact through the new API contract, and fails closed on auth, hash, size, or path mismatches.
- [ ] Keep default agent-home discovery unchanged so existing recent-review/security-review workflows keep uploading only scoped session logs unless explicit extra roots are configured.
- [ ] Add focused tests for duplicate uploads, partial download failures, hash mismatches, and refusal to write outside the requested destination directory.

**Verification:** Run the focused script tests and confirm the helpers can round-trip an uploaded artifact manifest without leaking tokens or accepting tampered content.

### Phase 3: Split `do-issue` into untrusted and trusted jobs

**Files changed:**

- `.github/workflows/issue-agent-issue-to-pr.yml`
- `scripts/issue-agent/prepare-branch.sh`
- `scripts/issue-agent/validate-pr-metadata.mjs`
- `scripts/issue-agent/export-pr-metadata.mjs`
- `docs/rules/github-security.md`
- `docs/dev-setup.md`

**Steps:**

- [ ] Replace the single `run` job with a read-only agent job that prepares the local branch, runs the agent, creates a git bundle plus metadata files, and uploads those explicit artifacts through the session-log service.
- [ ] Add a fresh trusted job on a clean runner that checks out the base revision, downloads the uploaded git bundle and metadata, verifies them against the saved manifest, applies the bundle, and only then performs validation, branch push, PR creation or update, comment posting, and demo publication.
- [ ] Keep session-log comment posting optional and isolated so a log-comment failure cannot hide the main `do-issue` success or failure signal.
- [ ] Update docs and security rules to state that cross-job issue-agent handoff now depends on the authenticated artifact download contract instead of a same-runner trusted-helper refresh.

**Verification:** Validate the workflow YAML with the repo formatter or linter, and dry-run the helper scripts locally with fixture manifests to confirm the trusted job receives only the intended files.

## Files Changed

- `plans/update-session-logs-endpoint.md`
- `docs/github-session-log-upload-api.md`
- `scripts/issue-agent/upload-session-logs.sh`
- `scripts/issue-agent/download-uploaded-artifacts.sh`
- `tests/scripts/upload-session-logs.test.ts`
- `tests/scripts/download-uploaded-artifacts.test.ts`
- `.github/workflows/issue-agent-issue-to-pr.yml`
- `scripts/issue-agent/prepare-branch.sh`
- `scripts/issue-agent/validate-pr-metadata.mjs`
- `scripts/issue-agent/export-pr-metadata.mjs`
- `docs/rules/github-security.md`
- `docs/dev-setup.md`

## Risks and Mitigations

| Risk                                                                                                             | Likelihood | Impact | Mitigation                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The download API exposes raw uploaded artifacts too broadly.                                                     | Medium     | High   | Require the same bearer auth as upload or short-lived signed URLs, disable public caching, and keep artifact ids unguessable.                       |
| The trusted job applies a tampered or incomplete git bundle.                                                     | Medium     | High   | Verify `artifact_id`, `relative_path`, `size_bytes`, and `sha256_hex` against the upload manifest before applying any file.                         |
| Large issue-agent diffs exceed the artifact limits or bundle format assumptions.                                 | Medium     | Medium | Define explicit bundle size caps up front, keep the upload helper limits configurable, and fail with clear workflow errors when a run exceeds them. |
| The new contract solves `issue-agent` but diverges from `fix-pr`, leaving two different trust-boundary patterns. | Medium     | Medium | Keep the helper and API contract generic enough for both workflows and call out reuse explicitly in docs and rules.                                 |

## Definition of Done

- [ ] The session-log service documents an authenticated machine-download contract for uploaded artifacts.
- [ ] Workflow helpers can upload explicit non-log artifacts and restore them with integrity checks on a different runner.
- [ ] `issue-agent-issue-to-pr.yml` no longer mixes the agent run and write-scoped post-agent steps on the same runner.
- [ ] Docs and security rules describe the new cross-job artifact handoff pattern.

## Iteration Log

| Iteration | Timestamp           | Summary                                                                                                                                  | Commit | Errors/Issues                                                   |
| --------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| 1         | 2026-04-07 00:00 PT | Drafted the endpoint and workflow follow-up needed to move `do-issue` onto separate untrusted and trusted jobs without GitHub artifacts. | —      | The current upload API has no documented raw-download contract. |
