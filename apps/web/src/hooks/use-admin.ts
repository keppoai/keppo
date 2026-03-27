import { useCallback } from "react";
import { makeFunctionReference } from "convex/server";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

const adminGetAccessRef = makeFunctionReference<"query">("admin:getAccess");
const adminListFeatureFlagsRef = makeFunctionReference<"query">("admin:listFeatureFlags");
const adminListDogfoodOrgsRef = makeFunctionReference<"query">("admin:listDogfoodOrgs");
const adminListInviteCodesRef = makeFunctionReference<"query">("admin:listInviteCodes");
const adminPlatformOverviewRef = makeFunctionReference<"query">("admin:platformOverview");
const adminListOrgsWithUsageRef = makeFunctionReference<"query">("admin:listOrgsWithUsage");
const adminListOrgsForAbuseRef = makeFunctionReference<"query">("admin:listOrgsForAbuse");
const adminListAllSuspensionsRef = makeFunctionReference<"query">("admin:listAllSuspensions");
const adminSetFeatureFlagEnabledRef = makeFunctionReference<"mutation">(
  "admin:setFeatureFlagEnabled",
);
const adminAddDogfoodOrgRef = makeFunctionReference<"mutation">("admin:addDogfoodOrg");
const adminRemoveDogfoodOrgRef = makeFunctionReference<"mutation">("admin:removeDogfoodOrg");
const adminSeedDefaultFlagsRef = makeFunctionReference<"mutation">("admin:seedDefaultFlags");
const abuseSuspendOrgManualRef = makeFunctionReference<"mutation">("abuse:suspendOrgManual");
const abuseUnsuspendOrgManualRef = makeFunctionReference<"mutation">("abuse:unsuspendOrgManual");
const adminGetOrgUsageDetailRef = makeFunctionReference<"query">("admin:getOrgUsageDetail");
const adminCreateInviteCodeRef = makeFunctionReference<"mutation">("admin:createInviteCode");
const adminSetInviteCodeActiveRef = makeFunctionReference<"mutation">("admin:setInviteCodeActive");
const adminGetOrgDeletionPreviewRef = makeFunctionReference<"query">("admin:getOrgDeletionPreview");
const adminGetUserDeletionPreviewRef = makeFunctionReference<"query">(
  "admin:getUserDeletionPreview",
);
const adminHardDeleteOrganizationRef = makeFunctionReference<"mutation">(
  "admin:hardDeleteOrganization",
);
const adminHardDeleteUserRef = makeFunctionReference<"mutation">("admin:hardDeleteUser");

type FeatureFlagRow = {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

type DogfoodOrgRow = {
  id: string;
  org_id: string;
};

type InviteCodeRow = {
  id: string;
  code: string;
  label: string;
  grant_tier: "free" | "starter" | "pro";
  active: boolean;
  use_count: number;
  created_by: string;
  created_at: string;
};

type AdminAccess = {
  canAccessAdminPage: boolean;
  canAccessAdminHealth: boolean;
  isPlatformAdmin: boolean;
};

type PlatformOverview = {
  totalOrganizations: number;
  totalUsers: number;
  activeAutomationRuns: number;
  suspendedOrganizations: number;
};

type UsageSummaryRow = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  tier: string;
  subscriptionStatus: string;
  toolCalls: number;
  totalToolCallTimeMs: number;
  aiCreditsUsed: number;
  aiCreditsTotal: number;
  automationRuns: number;
  activeAutomationRuns: number;
  isSuspended: boolean;
};

type UsageDetail = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  subscription: {
    tier: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  usageHistory: Array<{
    periodStart: string;
    periodEnd: string;
    toolCalls: number;
    totalToolCallTimeMs: number;
    aiCreditsUsed: number;
    aiCreditsTotal: number;
    purchasedAiCreditsRemaining: number;
  }>;
  aiCredits: {
    allowanceUsed: number;
    allowanceTotal: number;
    purchasedRemaining: number;
    totalAvailable: number;
  };
  activeRuns: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    startedAt: string;
  }>;
  memberCount: number;
  workspaceCount: number;
  suspensionHistory: Array<{
    id: string;
    orgId: string;
    orgName: string;
    reason: string;
    suspendedBy: string;
    suspendedAt: string;
    liftedAt: string | null;
    liftedBy: string | null;
  }>;
};

type AbuseOrgRow = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  tier: string;
  isSuspended: boolean;
  activeSuspension: {
    id: string;
    reason: string;
    suspendedBy: string;
    suspendedAt: string;
  } | null;
  suspensionHistoryCount: number;
};

type SuspensionHistoryRow = {
  id: string;
  orgId: string;
  orgName: string;
  reason: string;
  suspendedBy: string;
  suspendedAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
};

type OrgDeletionPreview = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  memberCount: number;
  workspaceCount: number;
  automationCount: number;
  notificationEndpointCount: number;
};

type UserDeletionPreview = {
  userId: string;
  name: string;
  email: string;
  organizationMemberships: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    role: string;
    memberCount: number;
    ownerCount: number;
    action: "delete_org" | "remove_membership" | "blocked_transfer_required";
  }>;
};

type OrgDeletionResult = {
  orgId: string;
  orgName: string;
  orgSlug: string;
};

export function useAdmin() {
  const runtime = useDashboardRuntime();
  const convex = runtime.useConvex();
  const access = runtime.useQuery(adminGetAccessRef, {}) as AdminAccess | undefined;
  const canAccessAdminPage = access?.canAccessAdminPage;
  const canAccessAdminHealth = access?.canAccessAdminHealth;
  const isPlatformAdmin = access?.isPlatformAdmin;
  const flagsQuery = runtime.useQuery(
    adminListFeatureFlagsRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as FeatureFlagRow[] | undefined;
  const dogfoodOrgsQuery = runtime.useQuery(
    adminListDogfoodOrgsRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as DogfoodOrgRow[] | undefined;
  const inviteCodesQuery = runtime.useQuery(
    adminListInviteCodesRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as InviteCodeRow[] | undefined;
  const platformOverviewQuery = runtime.useQuery(
    adminPlatformOverviewRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as PlatformOverview | undefined;
  const usageQuery = runtime.useQuery(
    adminListOrgsWithUsageRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as UsageSummaryRow[] | undefined;
  const abuseOrgsQuery = runtime.useQuery(
    adminListOrgsForAbuseRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as AbuseOrgRow[] | undefined;
  const suspensionsQuery = runtime.useQuery(
    adminListAllSuspensionsRef,
    canAccessAdminPage === true ? {} : "skip",
  ) as SuspensionHistoryRow[] | undefined;

  const setFeatureFlagEnabledMutation = runtime.useMutation(adminSetFeatureFlagEnabledRef);
  const addDogfoodOrgMutation = runtime.useMutation(adminAddDogfoodOrgRef);
  const removeDogfoodOrgMutation = runtime.useMutation(adminRemoveDogfoodOrgRef);
  const seedDefaultFlagsMutation = runtime.useMutation(adminSeedDefaultFlagsRef);
  const suspendOrgManualMutation = runtime.useMutation(abuseSuspendOrgManualRef);
  const unsuspendOrgManualMutation = runtime.useMutation(abuseUnsuspendOrgManualRef);
  const createInviteCodeMutation = runtime.useMutation(adminCreateInviteCodeRef);
  const setInviteCodeActiveMutation = runtime.useMutation(adminSetInviteCodeActiveRef);
  const hardDeleteOrganizationMutation = runtime.useMutation(adminHardDeleteOrganizationRef);
  const hardDeleteUserMutation = runtime.useMutation(adminHardDeleteUserRef);
  const getOrgUsageDetail = useCallback(
    async (orgId: string): Promise<UsageDetail> => {
      return (await convex.query(adminGetOrgUsageDetailRef, { orgId })) as UsageDetail;
    },
    [convex],
  );

  const setFlagEnabled = useCallback(
    async (key: string, enabled: boolean): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      await setFeatureFlagEnabledMutation({ key, enabled });
    },
    [canAccessAdminPage, setFeatureFlagEnabledMutation],
  );

  const addDogfoodOrg = useCallback(
    async (orgId: string): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      const value = orgId.trim();
      if (!value) {
        return;
      }
      await addDogfoodOrgMutation({ orgId: value });
    },
    [addDogfoodOrgMutation, canAccessAdminPage],
  );

  const removeDogfoodOrg = useCallback(
    async (orgId: string): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      const value = orgId.trim();
      if (!value) {
        return;
      }
      await removeDogfoodOrgMutation({ orgId: value });
    },
    [canAccessAdminPage, removeDogfoodOrgMutation],
  );

  const seedDefaultFlags = useCallback(async (): Promise<void> => {
    if (canAccessAdminPage !== true) {
      return;
    }
    await seedDefaultFlagsMutation({});
  }, [canAccessAdminPage, seedDefaultFlagsMutation]);

  const suspendOrgManual = useCallback(
    async (orgId: string, reason: string): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      await suspendOrgManualMutation({ orgId, reason });
    },
    [canAccessAdminPage, suspendOrgManualMutation],
  );

  const unsuspendOrgManual = useCallback(
    async (orgId: string): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      await unsuspendOrgManualMutation({ orgId });
    },
    [canAccessAdminPage, unsuspendOrgManualMutation],
  );

  const createInviteCode = useCallback(
    async (
      label: string,
      grantTier: InviteCodeRow["grant_tier"],
    ): Promise<InviteCodeRow | undefined> => {
      if (canAccessAdminPage !== true) {
        return undefined;
      }
      const value = label.trim();
      if (!value) {
        return undefined;
      }
      return (await createInviteCodeMutation({ label: value, grantTier })) as InviteCodeRow;
    },
    [canAccessAdminPage, createInviteCodeMutation],
  );

  const setInviteCodeActive = useCallback(
    async (inviteCodeId: string, active: boolean): Promise<void> => {
      if (canAccessAdminPage !== true) {
        return;
      }
      await setInviteCodeActiveMutation({ inviteCodeId, active });
    },
    [canAccessAdminPage, setInviteCodeActiveMutation],
  );

  const getOrgDeletionPreview = useCallback(
    async (orgLookup: string): Promise<OrgDeletionPreview> => {
      if (canAccessAdminPage !== true) {
        throw new Error("Forbidden");
      }
      return await convex.query(adminGetOrgDeletionPreviewRef, {
        orgLookup,
      });
    },
    [canAccessAdminPage, convex],
  );

  const getUserDeletionPreview = useCallback(
    async (userLookup: string): Promise<UserDeletionPreview> => {
      if (canAccessAdminPage !== true) {
        throw new Error("Forbidden");
      }
      return await convex.query(adminGetUserDeletionPreviewRef, {
        userLookup,
      });
    },
    [canAccessAdminPage, convex],
  );

  const hardDeleteOrganization = useCallback(
    async (orgId: string): Promise<OrgDeletionResult> => {
      if (canAccessAdminPage !== true) {
        throw new Error("Forbidden");
      }
      return await hardDeleteOrganizationMutation({
        orgId,
        confirm: "DELETE_ORG",
      });
    },
    [canAccessAdminPage, hardDeleteOrganizationMutation],
  );

  const hardDeleteUser = useCallback(
    async (userId: string): Promise<{ userId: string; email: string; deletedOrgIds: string[] }> => {
      if (canAccessAdminPage !== true) {
        throw new Error("Forbidden");
      }
      return await hardDeleteUserMutation({
        userId,
        confirm: "DELETE_USER",
      });
    },
    [canAccessAdminPage, hardDeleteUserMutation],
  );

  return {
    canAccessAdminPage,
    canAccessAdminHealth,
    isPlatformAdmin,
    flags: flagsQuery ?? [],
    dogfoodOrgs: dogfoodOrgsQuery ?? [],
    inviteCodes: inviteCodesQuery ?? [],
    platformOverview: platformOverviewQuery,
    usage: usageQuery ?? [],
    usageLoaded: usageQuery !== undefined,
    abuseOrgs: abuseOrgsQuery ?? [],
    abuseOrgsLoaded: abuseOrgsQuery !== undefined,
    suspensionHistory: suspensionsQuery ?? [],
    suspensionHistoryLoaded: suspensionsQuery !== undefined,
    flagsLoaded: flagsQuery !== undefined,
    dogfoodOrgsLoaded: dogfoodOrgsQuery !== undefined,
    inviteCodesLoaded: inviteCodesQuery !== undefined,
    setFlagEnabled,
    addDogfoodOrg,
    removeDogfoodOrg,
    createInviteCode,
    setInviteCodeActive,
    seedDefaultFlags,
    getOrgUsageDetail,
    getOrgDeletionPreview,
    getUserDeletionPreview,
    hardDeleteOrganization,
    hardDeleteUser,
    suspendOrgManual,
    unsuspendOrgManual,
  };
}
