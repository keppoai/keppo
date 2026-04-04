# Demo Video Rules

## Scope

- Apply these rules to reviewer-facing PR demo videos, not to debugging recordings or failure artifacts.
- Keep demo capture logic separate from regression coverage when the reviewer-friendly flow needs slower pacing, extra holds, or post-processing.

## Capture

- Start on the product surface the reviewer needs to judge. Do not ship browser boot, blank white frames, login/setup noise, or unrelated navigation before the changed UI appears.
- Prefer a targeted demo-only Playwright flow when the regression spec is too fast or too broad for review.
- Keep the full demo under 60 seconds and show only the changed behavior plus the minimum context needed to understand it.

## Pacing

- Record key interactions at reviewer speed, not test speed. Hold long enough before and after the important click, transition, or result so a human can understand what changed.
- The main changed behavior should stay on screen long enough to read its labels, hierarchy, and outcome without pausing the video manually.
- If the workflow includes repeated similar actions, slow only the moments that carry review value and trim redundant dead time elsewhere.

## Review

- Review the final exported clip before upload. Verify the opening frame, pacing, readability of key labels, and that the main behavior is visible long enough to judge.
- If the opening frames are dead air or the pace is unreadable, trim or re-record the demo and review it again. Do not post the first mechanically successful capture.
- Use the repo-owned review tooling to sample frames when direct playback is inconvenient, and keep reworking the artifact until the review surface is clear.

## Upload

- Upload only the final reviewed clip to the PR.
- Treat reviewer-facing demo videos as public artifacts and avoid recording sensitive data.
