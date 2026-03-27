import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

export const getDispatchAuditContextArgsValidator = v.object({
  runId: v.string(),
});

export const dispatchAutomationRunArgsValidator = v.object({
  runId: v.string(),
  namespace: v.optional(v.string()),
});

export const terminateAutomationRunArgsValidator = v.object({
  runId: v.string(),
  namespace: v.optional(v.string()),
});

export const buildGetDispatchAuditContextArgs = (runId: string) => ({
  runId,
});

export const buildDispatchAutomationRunArgs = (runId: string, namespace?: string) =>
  namespace === undefined ? { runId } : { runId, namespace };

export const buildTerminateAutomationRunArgs = (runId: string, namespace?: string) =>
  namespace === undefined ? { runId } : { runId, namespace };

export const automationSchedulerRefs = {
  getDispatchAuditContext: makeFunctionReference<"query">(
    "automation_scheduler:getDispatchAuditContext",
  ),
  dispatchAutomationRun: makeFunctionReference<"action">(
    "automation_scheduler:dispatchAutomationRun",
  ),
  terminateAutomationRun: makeFunctionReference<"action">(
    "automation_scheduler:terminateAutomationRun",
  ),
};
