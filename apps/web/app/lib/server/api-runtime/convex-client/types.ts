import type { FunctionReturnType } from "convex/server";
import { refs } from "./refs.js";

/** Helper: extract element type from an array type. */
type ArrayItem<T> = T extends readonly (infer U)[] ? U : never;

// ---------------------------------------------------------------------------
// Derived return types — kept in sync with Convex function signatures
// automatically via FunctionReturnType.
// ---------------------------------------------------------------------------

export type CredentialAuthResult = FunctionReturnType<typeof refs.authenticateCredential>;

export type WorkspaceCodeModeContext = FunctionReturnType<typeof refs.getWorkspaceCodeModeContext>;

export type MaintenanceTickResult = FunctionReturnType<typeof refs.runMaintenanceTick>;

export type ScheduledMaintenanceSweepResult = FunctionReturnType<
  typeof refs.scheduledMaintenanceSweepWithHeartbeat
>;

export type ConvexHealthProbe = FunctionReturnType<typeof refs.probeConvexHealth>;

export type CronHealthRow = ArrayItem<FunctionReturnType<typeof refs.checkCronHealth>>;

export type DeadLetterEntry = ArrayItem<FunctionReturnType<typeof refs.listPendingDeadLetters>>;

export type RateLimitHealthSummary = FunctionReturnType<typeof refs.summarizeRateLimitHealth>;

// These types are consumed via Zod schema parsing (parseConvexPayload), so
// they must match the Zod boundary types rather than the raw Convex returns.
export type ApprovedActionDispatch = {
  actionId: string;
  workspaceId: string;
  idempotencyKey: string;
  createdAt: string;
  e2eNamespace?: string | undefined;
};

export type ApprovedActionScheduleResult = {
  dispatched: boolean;
  reason: string;
  messageId?: string | undefined;
};

export type ExecuteApprovedActionResult = {
  status: FunctionReturnType<typeof refs.executeApprovedAction>["status"];
  action: Record<string, unknown>;
};

export type FeatureFlagRecord = ArrayItem<FunctionReturnType<typeof refs.listAllFeatureFlags>>;

export type AuditErrorRecord = ArrayItem<FunctionReturnType<typeof refs.listRecentAuditErrors>>;
