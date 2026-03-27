import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import { createConvexTestHarness } from "./harness";

const refs = {
  reset: makeFunctionReference<"mutation">("e2e:reset"),
  resetNamespace: makeFunctionReference<"mutation">("e2e:resetNamespace"),
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
};

const drainGlobalReset = async (t: ReturnType<typeof createConvexTestHarness>): Promise<void> => {
  let tableIndex = 0;
  let cursor: string | null = null;
  while (true) {
    const result = await t.mutation(refs.reset, { tableIndex, cursor });
    if (result.done) {
      return;
    }
    tableIndex = result.tableIndex;
    cursor = result.cursor;
  }
};

const drainNamespaceReset = async (
  t: ReturnType<typeof createConvexTestHarness>,
  namespace: string,
): Promise<void> => {
  let tableIndex = 0;
  let cursor: string | null = null;
  while (true) {
    const result = await t.mutation(refs.resetNamespace, {
      namespace,
      tableIndex,
      cursor,
    });
    if (result.done) {
      return;
    }
    tableIndex = result.tableIndex;
    cursor = result.cursor;
  }
};

const findAuthUserByEmail = async (
  t: ReturnType<typeof createConvexTestHarness>,
  email: string,
): Promise<{ _id: string } | null> => {
  return (await t.run(async (ctx) => {
    return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id: string } | null;
  })) as { _id: string } | null;
};

const countOrgRows = async (
  t: ReturnType<typeof createConvexTestHarness>,
  orgId: string,
): Promise<{ subscriptions: number; workspaces: number }> => {
  return await t.run(async (ctx) => {
    const [subscriptions, workspaces] = await Promise.all([
      ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
      ctx.db
        .query("workspaces")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    ]);
    return {
      subscriptions: subscriptions.length,
      workspaces: workspaces.length,
    };
  });
};

beforeEach(() => {
  vi.stubEnv("KEPPO_E2E_MODE", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2e reset pagination", () => {
  it("continues into Better Auth cleanup before reporting done", async () => {
    const t = createConvexTestHarness();
    const email = "e2e-reset-global@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_e2e_reset_global",
      email,
      name: "E2E Reset Global",
    });

    expect(await findAuthUserByEmail(t, email)).toBeTruthy();
    expect(await countOrgRows(t, orgId)).toEqual({
      subscriptions: 1,
      workspaces: 1,
    });

    await drainGlobalReset(t);

    expect(await findAuthUserByEmail(t, email)).toBeNull();
    expect(await countOrgRows(t, orgId)).toEqual({
      subscriptions: 0,
      workspaces: 0,
    });
  });

  it("continues namespace cleanup into Better Auth component tables", async () => {
    const t = createConvexTestHarness();
    const namespace = "e2e-reset-namespace";
    const namespacedEmail = `${namespace}@example.com`;
    const controlEmail = "e2e-reset-control@example.com";

    await t.mutation(refs.seedUserOrg, {
      userId: `usr_${namespace}`,
      email: namespacedEmail,
      name: `Reset ${namespace}`,
    });
    const controlOrgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_e2e_reset_control",
      email: controlEmail,
      name: "Reset Control",
    });

    expect(await findAuthUserByEmail(t, namespacedEmail)).toBeTruthy();
    expect(await findAuthUserByEmail(t, controlEmail)).toBeTruthy();

    await drainNamespaceReset(t, namespace);

    expect(await findAuthUserByEmail(t, namespacedEmail)).toBeNull();
    expect(await findAuthUserByEmail(t, controlEmail)).toBeTruthy();
    expect(await countOrgRows(t, controlOrgId)).toEqual({
      subscriptions: 1,
      workspaces: 1,
    });
  });
});
