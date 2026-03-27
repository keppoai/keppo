import { queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getOrgById = queryGeneric({
  args: {
    orgId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.string(),
      slug: v.string(),
      metadata: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organization", args.orgId);
    if (!orgId) {
      return null;
    }
    const org = await ctx.db.get(orgId);
    if (!org || !("slug" in org)) {
      return null;
    }
    return {
      id: String(org._id),
      name: String(org.name),
      slug: String(org.slug),
      metadata: typeof org.metadata === "string" ? org.metadata : null,
      createdAt: Number(org.createdAt),
    };
  },
});

export const getMemberByOrgAndUser = queryGeneric({
  args: {
    orgId: v.string(),
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      role: v.string(),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.orgId))
      .collect();
    const member = rows.find((row) => row.userId === args.userId) ?? null;
    if (!member) {
      return null;
    }
    return {
      id: String(member._id),
      role: String(member.role),
      createdAt: Number(member.createdAt),
    };
  },
});

export const getUserById = queryGeneric({
  args: {
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId("user", args.userId);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (!user || !("email" in user)) {
      return null;
    }
    return {
      id: String(user._id),
      name: String(user.name),
      email: String(user.email),
    };
  },
});

export const listOrgMembers = queryGeneric({
  args: {
    orgId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      userId: v.string(),
      role: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.orgId))
      .collect();
    return rows.map((row) => ({
      id: String(row._id),
      userId: String(row.userId),
      role: String(row.role),
      createdAt: Number(row.createdAt),
    }));
  },
});

export const countOrgMembers = queryGeneric({
  args: {
    orgId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) => q.eq("organizationId", args.orgId))
      .collect();
    return rows.length;
  },
});

export const getFirstMemberForUser = queryGeneric({
  args: {
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      orgId: v.string(),
      role: v.string(),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    const member = rows[0] ?? null;
    if (!member) {
      return null;
    }
    return {
      id: String(member._id),
      orgId: String(member.organizationId),
      role: String(member.role),
      createdAt: Number(member.createdAt),
    };
  },
});
