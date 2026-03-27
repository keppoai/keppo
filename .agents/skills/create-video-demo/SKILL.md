---
name: create-video-demo
description: Record a short Playwright-based product demo video for significant UI or user-visible functionality changes. Use when Codex needs to show a workflow in motion for a PR, either by recording an existing targeted E2E spec or by creating a disposable one-off Playwright spec that captures the changed behavior in under a minute, then uploading the final video to Vercel Blob and preparing a PR comment body that says "Demo at commit {hash}" with a 1-2 sentence summary and durable hosted link.
---

# Create Video Demo

Create a short, reviewer-friendly demo artifact without bloating the test suite or pretending screenshots are enough for motion-heavy changes.

## Workflow

1. Decide whether the change needs a demo.
   Record a demo when the PR introduces or substantially changes UI, navigation, onboarding, form flows, interaction states, or other user-visible product behavior.
2. Pick the capture path.
   Prefer reusing an existing targeted Playwright spec when it already covers the changed journey cleanly.
   Create a disposable one-off spec only when no existing spec can show the new behavior in a tight, reviewer-friendly sequence.
3. Keep the flow under one minute.
   Trim setup, avoid unrelated screens, and show only the behavior the reviewer needs to judge.
4. Record locally with Playwright.
   Never run the full E2E suite. Run one targeted spec unsandboxed and force video capture on.
5. Export the resulting video into `ux-artifacts/video-demos/`.
6. Generate the PR comment body with the current commit hash and a 1-2 sentence summary.
7. Post a top-level PR comment with the hosted video URL.
   The comment should point to the Vercel Blob URL for durable PR review.

## Choose The Demo Path

### Reuse an existing spec

Use an existing spec when it already:

- Enters the relevant screen quickly
- Shows the changed behavior without unrelated branching
- Finishes in well under a minute

Typical run shape:

```bash
KEPPO_PLAYWRIGHT_VIDEO_MODE=on pnpm run test:e2e:base -- tests/e2e/specs/path/to/spec.ts --project=chromium --workers=1 --output=test-results/video-demo
```

### Create a disposable one-off spec

Create a short-lived spec when the existing suite is too broad or noisy for demo purposes.

Authoring constraints:

- Put it near the relevant area under `tests/e2e/specs/`
- Assert the user-facing change before ending the test
- Keep the browser journey minimal and deterministic
- Prefer backend seeding/helpers over long browser-only setup
- Delete the spec after the video is captured unless it provides lasting regression coverage

## Recording Rules

- Keep the recorded journey under 60 seconds
- Use one worker and one targeted spec
- Do not run the full suite locally
- Run outside the Codex sandbox because local E2E is not reliable there
- Prefer the default Chromium project unless the change is browser-specific
- Do not commit generated video files; `ux-artifacts/video-demos/` is a staging area for upload, not source-controlled product state
- If the first recording is too long, rewrite the flow instead of shipping a long demo

## Export The Video

After the targeted Playwright run finishes, copy the newest recorded video into `ux-artifacts/video-demos/`:

```bash
bash .agents/skills/create-video-demo/scripts/export_latest_video.sh "ux-artifacts/video-demos/<demo-name>.webm"
```

The helper searches the Playwright `test-results` tree and copies the newest video file to the destination you provide.

## Upload The Video

Upload the exported file to Vercel Blob after the final demo-worthy commit exists:

```bash
bash .agents/skills/create-video-demo/scripts/upload_to_vercel_blob.sh \
  --file "ux-artifacts/video-demos/<demo-name>.webm" \
  --pathname "pr-demos/keppo/<pr-number>/$(git rev-parse --short HEAD)-<demo-name>.webm"
```

Requirements:

- `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` must be available in the environment
- Treat demo videos as public reviewer-facing artifacts
- Keep the pathname stable and descriptive so old PR comments remain understandable

The helper uploads directly to the Vercel Blob API in overwrite mode so re-recording the same commit/path updates the durable URL target.

## Prepare The PR Comment

Generate the comment body after the final demo-worthy commit exists:

```bash
bash .agents/skills/create-video-demo/scripts/render_pr_comment.sh \
  --commit "$(git rev-parse --short HEAD)" \
  --summary "Shows the new dashboard empty state, creates the first automation, and lands on the populated success state." \
  --video-url "https://<your-blob>.public.blob.vercel-storage.com/pr-demos/..." \
  --output /tmp/pr-demo-comment.md
```

## Post The Comment

Use this order:

1. Push or update the PR.
2. Upload the video to Vercel Blob.
3. Paste the generated body into a top-level PR comment.
4. Ensure the final comment has this shape:

```md
Demo at commit `abc1234`

Shows the new dashboard empty state, creates the first automation, and lands on the populated success state.

https://<your-blob>.public.blob.vercel-storage.com/pr-demos/...
```

Notes:

- `gh pr comment` can post the body once you already have the Vercel Blob URL.
- Vercel Blob public stores are appropriate only for non-sensitive reviewer-facing demos.
- GitHub will not reliably inline arbitrary external Blob-hosted videos in PR comments, so treat the durable URL as the review surface rather than trying to force an unsupported embedded player.

## Output Requirements

- Video file in `ux-artifacts/video-demos/`
- Runtime under one minute
- Comment starts with `Demo at commit {hash}`
- Summary is 1-2 sentences and names the user-visible behavior
- Comment includes a durable Vercel Blob URL
