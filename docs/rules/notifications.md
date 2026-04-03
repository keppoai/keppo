# Notification Rules

## Event creation

- `packages/shared/src/notifications.ts` is the source of truth for event IDs, templates, channels, and CTA routes.
- Usage-threshold events must be deduplicated per org, billing period, and threshold crossing.
- Notification side effects must not mask the primary domain outcome. If the user-facing result is "limit reached", "action approved", or another canonical state, emit the notification best-effort and preserve the original result/error even when notification creation fails.
- In-app notifications can be written as sent immediately; channel-delivered notifications should begin pending.

## Delivery lifecycle

- `notification_events` must track attempts and terminal failure state.
- Retry only retryable failures and cap retries at three attempts.
- Disable push endpoints when the push provider reports an expired or unregistered subscription.

## Preferences and session trust

- Endpoint-level event preferences are optional and default to enabled.
- Derive `userId` and `orgId` for push registration from the authenticated API session, never from caller-controlled body fields.
- Validate push subscription endpoints before persistence and revalidate them immediately before delivery; reject non-HTTPS, loopback, private, link-local, metadata, and DNS-resolved internal destinations fail-closed.

## Badge semantics

- The unread count source of truth is the Convex unread-count query.
- Bell badge, sidebar badge, document title, and favicon badge must all use that same unread count.
- The shared unread-count query backs display-only badges, so keep it bounded to the UI display cap instead of scanning the full unread history under load.
- Test-only notification endpoint lookups must use the narrowest exact index available (for example org + type + destination), not broad org scans plus in-memory filtering.
