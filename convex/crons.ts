import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
const checkScheduledAutomationsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:checkScheduledAutomationsWithHeartbeat",
);
const reconcileProviderTriggerSubscriptionsRef = makeFunctionReference<"action">(
  "cron_heartbeats:reconcileProviderTriggerSubscriptionsWithHeartbeat",
);
const reapStaleRunsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:reapStaleRunsWithHeartbeat",
);
const scheduledMaintenanceSweepRef = makeFunctionReference<"action">(
  "cron_heartbeats:scheduledMaintenanceSweepWithHeartbeat",
);
const runAbuseHeuristicsRef = makeFunctionReference<"mutation">("abuse:runHeuristics");
const archiveHotLogsRef = makeFunctionReference<"action">(
  "cron_heartbeats:archiveHotLogsWithHeartbeat",
);
const expireColdLogsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:expireColdLogsWithHeartbeat",
);
const processAutomationTriggerEventsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:processAutomationTriggerEventsWithHeartbeat",
);
const expirePurchasedCreditsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:expirePurchasedCreditsWithHeartbeat",
);
const expirePurchasedAutomationRunTopupsRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:expirePurchasedAutomationRunTopupsWithHeartbeat",
);
const expireInviteCodePromosRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:expireInviteCodePromosWithHeartbeat",
);
const purgeExpiredApiDedupeKeysRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:purgeExpiredApiDedupeKeysWithHeartbeat",
);
const autoRetryDlqRef = makeFunctionReference<"mutation">(
  "cron_heartbeats:autoRetryDlqWithHeartbeat",
);
const syntheticCanaryRef = makeFunctionReference<"action">(
  "cron_heartbeats:syntheticCanaryWithHeartbeat",
);

crons.interval("automation-scheduler-check", { minutes: 1 }, checkScheduledAutomationsRef, {
  limit: 200,
});
crons.interval(
  "automation-provider-trigger-reconcile",
  { minutes: 1 },
  reconcileProviderTriggerSubscriptionsRef,
  {
    limit: 100,
  },
);
crons.interval(
  "automation-trigger-event-processor",
  { minutes: 1 },
  processAutomationTriggerEventsRef,
  {
    limit: 50,
  },
);
crons.interval("automation-stale-run-reaper", { minutes: 1 }, reapStaleRunsRef, { limit: 250 });
crons.interval("maintenance-sweep", { minutes: 2 }, scheduledMaintenanceSweepRef, {});
crons.interval("abuse-heuristics", { minutes: 15 }, runAbuseHeuristicsRef, {});
crons.interval("automation-hot-log-archival", { hours: 1 }, archiveHotLogsRef, {
  limit: 50,
  scanLimit: 500,
});
crons.interval("automation-cold-log-expiry", { hours: 1 }, expireColdLogsRef, {
  limit: 50,
  scanLimit: 500,
});
crons.interval("ai-credit-expiry", { hours: 1 }, expirePurchasedCreditsRef, {});
crons.interval(
  "automation-run-topup-expiry",
  { hours: 1 },
  expirePurchasedAutomationRunTopupsRef,
  {},
);
crons.interval("invite-promo-expiry", { hours: 1 }, expireInviteCodePromosRef, {});
crons.interval("api-dedupe-expiry-cleanup", { minutes: 15 }, purgeExpiredApiDedupeKeysRef, {
  limit: 250,
});
crons.interval("dlq-auto-retry", { minutes: 5 }, autoRetryDlqRef, { limit: 20 });
crons.interval("synthetic-canary", { minutes: 5 }, syntheticCanaryRef, {});

export default crons;
