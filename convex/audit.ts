import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./_auth";
import { extractAuditActionId } from "./audit_shared";
import {
  AUDIT_ERROR_EVENT_TYPES,
  type AuditActorType,
  type AuditEventType,
} from "./domain_constants";
import {
  auditActorTypeValidator,
  auditEventTypeValidator,
  jsonRecordValidator,
} from "./validators";

const MAX_AUDIT_RESULTS = 100;
const MAX_AUDIT_SCAN = 400;

const scanRecentAuditEvents = async (
  ctx: QueryCtx,
  orgId: string,
  filters:
    | {
        from?: string;
        to?: string;
        actor?: string;
        eventType?: string;
        provider?: string;
        actionId?: string;
      }
    | undefined,
) => {
  const actorFilter = filters?.actor?.trim().toLowerCase();
  const eventTypeFilter = filters?.eventType?.trim().toLowerCase();
  const providerFilter = filters?.provider?.trim().toLowerCase();
  const actionIdFilter = filters?.actionId?.trim();

  const matches: Array<{
    id: string;
    org_id: string;
    actor_type: AuditActorType;
    actor_id: string;
    event_type: AuditEventType;
    payload: Record<string, unknown>;
    created_at: string;
  }> = [];
  const queryByCreated = () =>
    ctx.db
      .query("audit_events")
      .withIndex("by_org_created", (q) => {
        const base = q.eq("org_id", orgId);
        if (filters?.from && filters?.to) {
          return base.gte("created_at", filters.from).lte("created_at", filters.to);
        }
        if (filters?.from) {
          return base.gte("created_at", filters.from);
        }
        if (filters?.to) {
          return base.lte("created_at", filters.to);
        }
        return base;
      })
      .order("desc");

  const indexedRows = actionIdFilter
    ? await ctx.db
        .query("audit_events")
        .withIndex("by_org_action_created", (q) => {
          const base = q.eq("org_id", orgId).eq("action_id", actionIdFilter);
          if (filters?.from && filters?.to) {
            return base.gte("created_at", filters.from).lte("created_at", filters.to);
          }
          if (filters?.from) {
            return base.gte("created_at", filters.from);
          }
          if (filters?.to) {
            return base.lte("created_at", filters.to);
          }
          return base;
        })
        .order("desc")
        .take(MAX_AUDIT_SCAN)
    : await queryByCreated().take(MAX_AUDIT_SCAN);

  const candidateRows = [...indexedRows];
  if (actionIdFilter && indexedRows.length < MAX_AUDIT_SCAN) {
    const seen = new Set(indexedRows.map((row) => row.id));
    const legacyRows = await queryByCreated().take(MAX_AUDIT_SCAN);
    candidateRows.push(...legacyRows.filter((row) => !seen.has(row.id)));
  }
  candidateRows.sort((left, right) => right.created_at.localeCompare(left.created_at));

  for (const row of candidateRows) {
    if (actorFilter) {
      const actorText = `${row.actor_type}:${row.actor_id}`.toLowerCase();
      if (!actorText.includes(actorFilter)) {
        continue;
      }
    }

    if (providerFilter) {
      const payloadText = JSON.stringify(row.payload ?? {}).toLowerCase();
      if (!payloadText.includes(providerFilter)) {
        continue;
      }
    }

    if (eventTypeFilter && !row.event_type.toLowerCase().includes(eventTypeFilter)) {
      continue;
    }

    if (actionIdFilter && extractAuditActionId(row.payload) !== actionIdFilter) {
      continue;
    }

    matches.push({
      id: row.id,
      org_id: row.org_id,
      actor_type: row.actor_type,
      actor_id: row.actor_id,
      event_type: row.event_type,
      payload: row.payload,
      created_at: row.created_at,
    });

    if (matches.length >= MAX_AUDIT_RESULTS) {
      break;
    }
  }

  return matches;
};

const auditEventValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  actor_type: auditActorTypeValidator,
  actor_id: v.string(),
  event_type: auditEventTypeValidator,
  payload: jsonRecordValidator,
  created_at: v.string(),
});

export const listForCurrentOrg = query({
  args: {
    filters: v.optional(
      v.object({
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        actor: v.optional(v.string()),
        eventType: v.optional(v.string()),
        provider: v.optional(v.string()),
        actionId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.array(auditEventValidator),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    return await scanRecentAuditEvents(ctx, auth.orgId, args.filters);
  },
});

export const listRecentErrors = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(auditEventValidator),
  handler: async (ctx, args) => {
    const limit =
      args.limit !== undefined && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(100, Math.floor(args.limit)))
        : 50;
    const rows = await Promise.all(
      AUDIT_ERROR_EVENT_TYPES.map((eventType) =>
        ctx.db
          .query("audit_events")
          .withIndex("by_event_type_created", (q) => q.eq("event_type", eventType))
          .order("desc")
          .take(limit),
      ),
    );

    return rows
      .flat()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        org_id: row.org_id,
        actor_type: row.actor_type,
        actor_id: row.actor_id,
        event_type: row.event_type,
        payload: row.payload,
        created_at: row.created_at,
      }));
  },
});
