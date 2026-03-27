# UX Rules

## Design system

- Reuse the shared dashboard tokens in `apps/web/src/styles.css` instead of inventing one-off colors, radii, or fonts.
- The current product look is warm stone neutrals plus sage primary and amber secondary accents.
- Primary type is `Plus Jakarta Sans Variable`; monospace is `IBM Plex Mono`.
- Dark mode should continue to flow from shared CSS variables, not per-component theme forks.

## Layout and responsiveness

- Keep the authenticated shell consistent: sidebar, breadcrumb header, and workspace-aware content area.
- Preserve shell continuity during auth bootstrap and workspace switches. A route can show a structured loading state in the content area, but the surrounding chrome should stay visible so operators never hit a blank frame.
- Workspace-scoped links rendered from org-scoped surfaces must resolve against the active or last-known workspace, and malformed workspace URLs must self-heal to a valid workspace route instead of leaving the shell stuck in a pending state.
- Dashboard route-level lazy loading must keep auth/layout wrappers eager and provide an explicit pending state at the route boundary so code-split navigation does not flash empty content inside the shell.
- Mobile remains first-class: touch targets at least 44px, forms stack vertically, tables scroll or collapse cleanly, and hover-only affordances need an always-visible mobile equivalent.
- Empty, loading, warning, and error states must be explicit; do not hide unavailable capability silently.

## Motion

- Use Framer Motion for meaningful UI transitions and layout changes.
- Use `tw-animate-css` only for simple utility loops such as spinners or pulses.
- Respect reduced-motion preferences and avoid decorative motion on high-frequency interactions.
- Theme switches should not flash or animate through distracting intermediate states.

## Forms and feedback

- Async actions need pending, success, and error states that are visible without reading logs.
- Prefer inline validation and stable error copy over toast-only failures.
- Use the shared user-facing error presentation pattern for product failures: human summary first, actionable next steps second, and collapsed technical details only where operator troubleshooting is appropriate.
- Labels must remain explicit; placeholders are supplemental, not the only affordance.
- Destructive actions should look destructive and require deliberate intent.
- Routes or components that fire side-effecting requests on mount must guard against duplicate execution under React StrictMode/remounts.
- Staged async builders must preserve draft state across entrypoints, keep layout stable while generating, and make dependency/setup steps explicitly skippable instead of forcing users into hidden detours.
- Global command surfaces must earn their shortcut. If a page exposes `Cmd+K` / `Ctrl+K`, the palette should support the operator's main jumps and actions for that surface instead of acting as a thin wrapper around one modal.

## Accessibility and performance

- Preserve keyboard navigation, visible focus states, semantic headings, and accessible names for controls.
- Avoid layout shift and hydration flashes; loading states should hold structure.
- Real-time UI should update without forcing users to reload or lose context.
- Streaming operational logs should prefer append-only updates and grouped render units over remounting per-line fragments. If adjacent events represent one thought/config/result sequence, merge them in the view model and keep the raw log tab as the faithful fallback.
- Dashboard summaries and charts must be truthful. If live data is unavailable or empty, render an explicit unavailable/empty state instead of synthetic filler metrics or randomized series.
- Overviews and onboarding panels must help the user decide what to do next. Prefer readiness milestones, blocking issues, and next actions over disconnected vanity counts.
- When operators author structured content such as Markdown with Mermaid fences, render it faithfully or degrade to a clearly labeled fallback. Never expose raw authoring syntax on a polished detail surface when the product can render it safely.

## Validation

- For UI changes, capture a screenshot artifact through E2E and run the `$design-critique` workflow before calling the work complete.
- For staged builders or other multi-step async flows, capture the screenshot from an in-progress or decision-heavy step (not only the empty state) so the critique covers hierarchy, expectation-setting, and transition quality.
