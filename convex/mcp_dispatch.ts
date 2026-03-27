import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { convexActionDispatchStateSchema } from "@keppo/shared/providers/boundaries/convex-schemas";
import { parseConvexPayload } from "@keppo/shared/providers/boundaries/error-boundary";
import { internalMutation } from "./_generated/server";
import { ACTION_STATUS } from "./domain_constants";
import { validationMessage } from "./safe_convex";

const refs = {
  executeApprovedAction: makeFunctionReference<"action">("mcp_node:executeApprovedAction"),
  getActionState: makeFunctionReference<"query">("mcp:getActionState"),
};

export const scheduleApprovedAction = internalMutation({
  args: {
    actionId: v.string(),
    source: v.optional(v.string()),
  },
  returns: v.object({
    dispatched: v.boolean(),
    reason: v.string(),
    messageId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const stateRaw = await ctx.runQuery(refs.getActionState, { actionId: args.actionId });
    if (stateRaw === null) {
      return {
        dispatched: false,
        reason: "action_not_found",
      };
    }

    const state = parseConvexPayload(convexActionDispatchStateSchema, stateRaw, {
      message: validationMessage(
        "mcp_dispatch.scheduleApprovedAction",
        `Dispatch state payload for ${args.actionId} failed validation.`,
      ),
    });

    if (state.action.status !== ACTION_STATUS.approved) {
      return {
        dispatched: false,
        reason: `action_status_${state.action.status}`,
      };
    }

    const messageId = await ctx.scheduler.runAfter(0, refs.executeApprovedAction, {
      actionId: args.actionId,
    });

    const source = args.source?.trim();
    return {
      dispatched: true,
      reason: source ? `scheduled_${source}` : "scheduled",
      messageId,
    };
  },
});
