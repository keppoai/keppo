# Error Messaging Rules

- User-facing errors must start with human guidance, not raw backend prose. The first visible copy should explain what happened in plain language and what the operator should do next.
- Backend and API boundaries that drive UI error states must emit stable machine-readable identifiers such as `error_code`, typed envelopes, or `<code>: <message>` prefixes. Frontend code must map those identifiers into product copy instead of string-scraping ad hoc prose.
- Authenticated operator surfaces may expose short technical details, but they must stay collapsed by default, visually subordinate to the guidance, and easy to copy for support/debugging.
- Public or anonymous routes must stay sanitized. Never show raw exception strings, stack traces, bearer tokens, callback parameters, secrets, or opaque provider payloads on those routes even if the underlying error object contains them.
- Toasts are for compact summaries only. If a flow needs troubleshooting context or multi-step recovery guidance, render the shared inline error surface near the failing form, panel, or page state.
- Dense list/table surfaces may show short normalized summaries, but full error detail must route to a richer inline or detail-panel surface rather than truncating raw backend strings in place.
- New user-facing failure modes require tests that lock the contract down: machine-readable code at the boundary when applicable, human-friendly summary in UI, collapsed technical details for operator surfaces, and sanitization for public surfaces.
