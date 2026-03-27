import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  getWorkspaceForMember,
  requireOrgMember,
  requireWorkspaceRole,
  type BaseCtx,
} from "../../convex/_auth";
import { USER_ROLE, WORKSPACE_STATUS } from "../../convex/domain_constants";

type MembershipRow = { id: string; role: string; createdAt: number } | null;
type UserRow = { id: string; name: string; email: string } | null;

type FakeAuthParams = {
  identity: UserIdentity | null;
  workspaceOrgId?: string | null;
  workspaceStatus?: string;
  membership?: MembershipRow;
  user?: UserRow;
  firstMemberOrgId?: string | null;
  activeSuspension?: boolean;
};

const createAuthCtx = (params: FakeAuthParams) => {
  return {
    auth: {
      getUserIdentity: async () => params.identity,
    },
    runQuery: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("orgId" in args && "userId" in args) {
        return params.membership;
      }
      if ("userId" in args && !("orgId" in args)) {
        if (params.user) {
          return params.user;
        }
        return params.firstMemberOrgId ? { orgId: params.firstMemberOrgId } : null;
      }
      return null;
    },
    db: {
      query: (table: string) => {
        if (table === "org_suspensions") {
          return {
            withIndex: () => ({
              collect: async () =>
                params.activeSuspension
                  ? [
                      {
                        lifted_at: null,
                      },
                    ]
                  : [],
            }),
          };
        }
        if (table === "workspaces") {
          return {
            withIndex: () => ({
              unique: async () =>
                params.workspaceOrgId
                  ? {
                      id: "workspace_test",
                      org_id: params.workspaceOrgId,
                      status: params.workspaceStatus ?? WORKSPACE_STATUS.active,
                    }
                  : null,
            }),
          };
        }
        throw new Error(`Unexpected table lookup: ${table}`);
      },
    },
  } as unknown as BaseCtx;
};

const createIdentity = (overrides?: Partial<UserIdentity>): UserIdentity => {
  return {
    issuer: "https://example.test",
    subject: "usr_auth_test",
    tokenIdentifier: "token_auth_test",
    activeOrganizationId: "org_auth_test",
    ...overrides,
  };
};

describe("auth guard helpers", () => {
  it("requireOrgMember returns auth context for allowed roles", async () => {
    const ctx = createAuthCtx({
      identity: createIdentity(),
      membership: {
        id: "member_1",
        role: USER_ROLE.admin,
        createdAt: Date.now(),
      },
      user: {
        id: "usr_auth_test",
        name: "Tester",
        email: "tester@example.com",
      },
      activeSuspension: false,
    });

    const auth = await requireOrgMember(ctx, [USER_ROLE.admin]);
    expect(auth.orgId).toBe("org_auth_test");
    expect(auth.role).toBe(USER_ROLE.admin);
    expect(auth.user?.email).toBe("tester@example.com");
  });

  it("requireOrgMember rejects suspended organizations", async () => {
    const ctx = createAuthCtx({
      identity: createIdentity(),
      membership: {
        id: "member_1",
        role: USER_ROLE.owner,
        createdAt: Date.now(),
      },
      user: {
        id: "usr_auth_test",
        name: "Tester",
        email: "tester@example.com",
      },
      activeSuspension: true,
    });

    await expect(requireOrgMember(ctx)).rejects.toThrow("OrgSuspended");
  });

  it("requireWorkspaceRole returns workspace-scoped auth context", async () => {
    const ctx = createAuthCtx({
      identity: createIdentity(),
      workspaceOrgId: "org_auth_test",
      membership: {
        id: "member_1",
        role: USER_ROLE.viewer,
        createdAt: Date.now(),
      },
      user: {
        id: "usr_auth_test",
        name: "Tester",
        email: "tester@example.com",
      },
      activeSuspension: false,
    });

    const auth = await requireWorkspaceRole(ctx, "workspace_test", [USER_ROLE.viewer]);
    expect(auth.workspace.id).toBe("workspace_test");
    expect(auth.role).toBe(USER_ROLE.viewer);
  });

  it("requireWorkspaceRole rejects when workspace role is missing", async () => {
    const ctx = createAuthCtx({
      identity: createIdentity(),
      workspaceOrgId: "org_auth_test",
      membership: null,
      user: {
        id: "usr_auth_test",
        name: "Tester",
        email: "tester@example.com",
      },
      activeSuspension: false,
    });

    await expect(
      requireWorkspaceRole(ctx, "workspace_test", [USER_ROLE.owner, USER_ROLE.admin]),
    ).rejects.toThrow("Forbidden");
  });

  it("getWorkspaceForMember returns disabled workspaces without throwing", async () => {
    const ctx = createAuthCtx({
      identity: createIdentity(),
      workspaceOrgId: "org_auth_test",
      workspaceStatus: WORKSPACE_STATUS.disabled,
      membership: {
        id: "member_1",
        role: USER_ROLE.viewer,
        createdAt: Date.now(),
      },
      user: {
        id: "usr_auth_test",
        name: "Tester",
        email: "tester@example.com",
      },
      activeSuspension: false,
    });

    const auth = await getWorkspaceForMember(ctx, "workspace_test");
    expect(auth?.workspace.status).toBe(WORKSPACE_STATUS.disabled);
  });
});
