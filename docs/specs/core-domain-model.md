# Core domain model

Keppo is multi-tenant by organization. Most tables are keyed by `org_id` or `workspace_id`, with the workspace acting as the main boundary for MCP access, rules, integrations, custom servers, and automations.

## Terms

- Organization: the top-level Better Auth tenant; billing, invites, and platform access are org-scoped.
- Workspace: the operational boundary for MCP credentials, enabled providers, custom servers, rules, approvals, and automations.
- Integration: a provider connection plus account/credential state and rollout metadata.
- Tool call: one attempted built-in or custom-tool execution.
- Action: a persisted write request that may require approval before execution.
- Approval: the recorded human or automatic decision for an action.
- Automation run: one sandboxed execution of an automation configuration.
- Custom MCP server: an org-managed remote MCP endpoint whose tools can be discovered and selectively enabled per workspace.

## Tenancy and access

- Better Auth organization membership is the identity source.
- `subscriptions`, `usage_meters`, `invite_codes`, `invite_code_redemptions`, `invites`, `org_suspensions`, and `retention_policies` track org-level access and lifecycle.
- `workspaces` stores policy mode, default action behavior, optional Code Mode enablement, and workspace status.
- `workspace_credentials` stores bearer or client credentials for MCP access. Automation-issued workspace credentials may also carry metadata that ties the credential back to a specific `automation_run_id`; those credentials are run-scoped, revoked when the run becomes terminal, and rejected if MCP auth can no longer resolve that run as active in the same workspace.

## Provider and tool access

- `integrations`, `integration_accounts`, and `integration_credentials` store provider connection state and encrypted credentials.
- `integration_accounts.metadata.automation_trigger_lifecycle` stores per-provider, per-trigger polling state for connected accounts. Current examples include Gmail history cursors/watch metadata, Reddit recent inbox message ids, and X recent mention post ids.
- `workspace_integrations` enables or disables providers per workspace.
- `custom_mcp_servers`, `custom_mcp_tools`, and `workspace_custom_servers` model remote MCP server registration, discovered tools, and workspace enablement.
- `org_ai_keys` stores sandbox runner credentials for automation execution.

## Tool metadata and gating

- Every built-in and discovered custom tool carries canonical `capability`, `risk_level`, and `requires_approval` metadata.
- The runtime decision order is:
  1. CEL deny rule
  2. CEL approve rule
  3. Per-workspace tool auto-approval
  4. Workspace default `auto_approve_all`
  5. Policy agent when `policy_mode = rules_plus_agent`
  6. Manual approval
- `rules_first` still evaluates the policy agent for explanation, but it does not auto-approve or auto-deny.
- Decision outcomes are `approve`, `deny`, or `pending`.
- Matched rule snapshots, policy traces, and final approval rows are persisted for auditability.

## Actions, approvals, and policy

- `workspaces`
  - `id`, `org_id`, `slug`, `name`
  - `status` (active, disabled)
  - `policy_mode` (manual_only, rules_first, rules_plus_agent)
  - `default_action_behavior` (require_approval, allow_if_rule_matches, auto_approve_all)
  - `code_mode_enabled` (optional bool in storage; runtime default is `true`)
  - `created_at`
  - indexes: `by_custom_id`, `by_org`, `by_org_status`, `by_org_slug`, `by_created_at`
  - `slug` is unique within an org, reserved against route-owned words (`settings`, `admin`, `login`, `invites`, `health`), and is the canonical workspace URL key for dashboard routes.
- `code_mode_tool_index`
  - `tool_name`, `provider`, `capability`, `risk_level`, `requires_approval`
  - `provider` uses canonical provider ids (`google`, `stripe`, `slack`, `github`, `notion`, `reddit`, `x`, `custom`)
  - `capability` uses canonical tool capability values (`read`, `write`)
  - `risk_level` uses canonical action risk values (`low`, `medium`, `high`, `critical`)
  - `description`, `action_type`, `input_schema_json`, `embedding`
  - indexes: `by_tool_name`, `by_provider`, `search_description`, `vector_description`
- `workspace_credentials`
  - `id`, `workspace_id`
  - `type` (bearer_token, oauth_client, mtls) depending on transport and client
  - `hashed_secret`, `last_used_at`, `revoked_at`
- `tool_calls` records incoming execution attempts.
- `actions` and `approvals` persist the approval-required write lifecycle.
- `cel_rules`, `cel_rule_matches`, `tool_auto_approvals`, `policies`, `policy_decisions`, and `poll_trackers` store gating inputs and outcomes.
- `policy_mode` values remain `manual_only`, `rules_first`, and `rules_plus_agent`.
- The current policy agent is deterministic and heuristic rather than model-backed; in `rules_plus_agent` it can approve, deny, or escalate, and in `rules_first` it remains advisory only.

## Automations and Code Mode

- `automations`, `automation_config_versions`, `automation_runs`, `automation_run_logs`, and `automation_trigger_events` store automation definitions and executions.
- `automation_runs` persists lifecycle state separately from operator-facing outcome reporting. Each run may store one final outcome object (`outcome_success`, plain-text `outcome_summary`, `outcome_source`, `outcome_recorded_at`) so the UI can show what the agent claims it accomplished even when lifecycle `status` is only a transport/runtime state. Synthesized fallback outcomes follow the final terminal lifecycle state, and terminal failure states override any earlier stale success outcome so operators never see contradictory success-on-failure state.
- `automation_run_logs` may append a final structured `system` event with `kind=automation_outcome` so grouped timeline views render the recorded or synthesized outcome inline with the rest of the run transcript.
- `automations` stores operator-facing prose in `description`, an optional workflow diagram definition in `mermaid_content`, and the `mermaid_prompt_hash` that records which prompt revision last generated or manually aligned the diagram. Detail views derive Mermaid staleness by comparing the current config prompt hash to `mermaid_prompt_hash`.
- `automation_config_versions` stores trigger, runner, model, prompt, and network settings, but not per-automation AI key mode; execution mode is derived from org billing, available bundled credits, and active org BYO keys at save/run time.
- `automation_config_versions.provider_trigger` stores the canonical provider trigger contract: `provider_id`, `trigger_key`, schema version, structured filter payload, delivery preferences, and the last known subscription health snapshot for that automation config.
- `automation_trigger_events` stores normalized provider deliveries across both webhooks and polling with the same envelope shape: canonical `event_provider`, `trigger_key`, `delivery_mode`, provider event ids/types, match status, skip reason, and the config snapshot used for dispatch.
- `code_mode_tool_index` stores the searchable tool index used by `search_tools` and `execute_code`.

## Billing, notifications, and operations

- `invite_codes`
  - `code`, `label`, optional `grant_tier`, `active`, `use_count`
  - `grant_tier` defaults to `free` for legacy launch-gate codes and may also be `starter` or `pro` for one-month paid promos
- `invite_code_redemptions`
  - `org_id`, `invite_code_id`, `grant_tier`, `status`, `redeemed_by`, `redeemed_at`, `expires_at`, `updated_at`
  - free-code redemptions keep history alongside paid promos; paid promo rows use `active`, `expired`, and `converted` to drive billing state and expiry/conversion jobs
- `subscriptions.invite_code_id` remains historical invite attribution on the subscription row and is intentionally separate from time-bounded paid promo rows
- `ai_credits` and `ai_credit_purchases` track prompt-generation credits.
- `notification_endpoints` and `notification_events` store delivery preferences and events.
- `audit_events`, `provider_metrics`, `feature_flags`, `cron_heartbeats`, `dead_letter_queue`, `rate_limits`, `abuse_flags`, `credential_auth_failures`, `credential_usage_observations`, and `sensitive_blobs` cover observability and protection.
- `audit_events` stores an optional denormalized `action_id` so action timelines and audit filters can use `by_org_action_created` instead of scanning `payload.action_id`.

## Canonical enums

- Providers: `google`, `stripe`, `slack`, `github`, `notion`, `reddit`, `x`, `custom`
- Policy modes: `manual_only`, `rules_first`, `rules_plus_agent`
- Default action behaviors: `require_approval`, `allow_if_rule_matches`, `auto_approve_all`
- Tool capabilities: `read`, `write`
- Risk levels: `low`, `medium`, `high`, `critical`
