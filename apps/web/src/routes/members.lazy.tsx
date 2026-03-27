import { membersRoute } from "./members";
import { FormEvent, useCallback, useMemo, useState } from "react";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRouteParams } from "@/hooks/use-route-params";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { showUserFacingErrorToast } from "@/lib/show-user-facing-error-toast";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { createInvite } from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TierLimitBanner } from "@/components/ui/tier-limit-banner";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { parseTierLimitError, type TierLimitError } from "@/lib/convex-errors";

type Role = "owner" | "admin" | "approver" | "viewer";
type MemberRow = {
  membership_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  email: string;
  name: string;
};
type PendingInviteRow = {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
};

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  approver: "Approver",
  viewer: "Viewer",
};

const roleOptionsByRole: Record<Role, Role[]> = {
  owner: ["owner", "admin", "approver", "viewer"],
  admin: ["admin", "approver", "viewer"],
  approver: [],
  viewer: [],
};

const LIST_MEMBERS_REF = makeFunctionReference<"query">("invites:listMembers");
const LIST_PENDING_INVITES_REF = makeFunctionReference<"query">("invites:listPendingInvites");

const parseDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
};

export const membersRouteLazy = createLazyRoute(membersRoute.id)({
  component: MembersPage,
});

function MembersPage() {
  const navigate = useNavigate();
  const runtime = useDashboardRuntime();
  const auth = useAuth();
  const { buildOrgPath, buildWorkspacePath } = useRouteParams();
  const currentUserId = auth.session?.user?.id ?? "";
  const currentRole = auth.getRole();
  const canManage = auth.canManage();
  const isOwner = currentRole === "owner";
  const orgId = auth.getOrgId() ?? "";

  const convex = runtime.useConvex();
  const [fallbackMembers, setFallbackMembers] = useState<MemberRow[]>([]);
  const [fallbackPendingInvites, setFallbackPendingInvites] = useState<PendingInviteRow[]>([]);
  const membersQuery = useQuery(LIST_MEMBERS_REF, auth.isAuthenticated ? {} : "skip") as
    | MemberRow[]
    | undefined;
  const pendingInvitesQuery = useQuery(
    LIST_PENDING_INVITES_REF,
    auth.isAuthenticated && canManage ? {} : "skip",
  ) as PendingInviteRow[] | undefined;
  const members = membersQuery ?? fallbackMembers;
  const pendingInvites = pendingInvitesQuery ?? fallbackPendingInvites;
  const billing = useQuery(
    makeFunctionReference<"query">("billing:getCurrentOrgBilling"),
    auth.isAuthenticated ? {} : "skip",
  );

  const revokeInvite = useMutation(makeFunctionReference<"mutation">("invites:revokeInvite"));
  const removeMember = useMutation(makeFunctionReference<"mutation">("invites:removeMember"));
  const updateMemberRole = useMutation(
    makeFunctionReference<"mutation">("invites:updateMemberRole"),
  );
  const leaveOrg = useMutation(makeFunctionReference<"mutation">("invites:leaveOrg"));

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>(isOwner ? "viewer" : "approver");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<UserFacingError | null>(null);
  const [tierLimitError, setTierLimitError] = useState<TierLimitError | null>(null);
  const [pendingRoleByUser, setPendingRoleByUser] = useState<Record<string, Role>>({});
  const [removeTargetUserId, setRemoveTargetUserId] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  const refreshMemberTables = useCallback(async (): Promise<void> => {
    if (!auth.isAuthenticated) {
      setFallbackMembers([]);
      setFallbackPendingInvites([]);
      return;
    }

    const [nextMembers, nextPendingInvites] = await Promise.all([
      convex.query(LIST_MEMBERS_REF, {}),
      canManage ? convex.query(LIST_PENDING_INVITES_REF, {}) : Promise.resolve([]),
    ]);

    setFallbackMembers(nextMembers as MemberRow[]);
    setFallbackPendingInvites(nextPendingInvites as PendingInviteRow[]);
  }, [auth.isAuthenticated, canManage, convex]);

  const ownerCount = useMemo(
    () => members.filter((member) => member.role === "owner").length,
    [members],
  );
  const inviteRoleOptions = roleOptionsByRole[currentRole];
  const maxMembers = billing?.limits.max_members;
  const isUnlimited = typeof maxMembers === "number" && !Number.isFinite(maxMembers);
  const atLimit =
    typeof maxMembers === "number" && Number.isFinite(maxMembers)
      ? members.length + pendingInvites.length >= maxMembers
      : false;
  const isSoleOwner =
    members.find((member) => member.user_id === currentUserId)?.role === "owner" && ownerCount <= 1;

  const removeTarget = members.find((member) => member.user_id === removeTargetUserId) ?? null;

  const onInviteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!orgId || !currentUserId) {
      setInviteError(
        toUserFacingError(new Error("Missing organization context."), {
          fallback: "Missing organization context.",
        }),
      );
      return;
    }
    if (!canManage) {
      setInviteError(
        toUserFacingError(new Error("Only owners and admins can invite members."), {
          fallback: "Only owners and admins can invite members.",
        }),
      );
      return;
    }

    setIsInviting(true);
    setInviteError(null);
    setTierLimitError(null);
    try {
      const payload = await createInvite({
        orgId,
        inviterUserId: currentUserId,
        inviterName: String(auth.session?.user?.name ?? auth.session?.user?.email ?? "A teammate"),
        email: inviteEmail,
        role: inviteRole,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      if (!payload.inviteId) {
        throw new Error("Invite was not created.");
      }
      setInviteEmail("");
      setInviteRole(inviteRoleOptions[0] ?? "viewer");
      toast.success("Invitation sent.");
      void refreshMemberTables().catch((error) => {
        showUserFacingErrorToast(error, {
          fallback:
            "Invitation sent, but the member list did not refresh. Reload the page to confirm.",
        });
      });
    } catch (error) {
      const limit = parseTierLimitError(error);
      if (limit) {
        setTierLimitError(limit);
        setInviteError(null);
        return;
      }
      setInviteError(toUserFacingError(error, { fallback: "Failed to send invitation." }));
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Members</h1>
          <p className="text-muted-foreground">Manage your organization's team.</p>
        </div>
        <div className="text-sm text-muted-foreground text-right">
          <div>
            {members.length + pendingInvites.length} of{" "}
            {typeof maxMembers === "number" ? (isUnlimited ? "unlimited" : maxMembers) : "-"}{" "}
            members
          </div>
          <a href={buildOrgPath("/settings/billing")} className="underline underline-offset-4">
            Open billing
          </a>
        </div>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>Invite people to collaborate in this organization.</CardDescription>
          </CardHeader>
          <CardContent>
            {tierLimitError ? (
              <TierLimitBanner
                limit={tierLimitError}
                billingPath={buildOrgPath("/settings/billing")}
                className="mb-4"
              />
            ) : null}
            {inviteError ? <UserFacingErrorView error={inviteError} /> : null}
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onInviteSubmit}>
              <Input
                type="email"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(event) => {
                  setInviteEmail(event.currentTarget.value);
                }}
                required
                className="sm:max-w-sm"
              />
              <NativeSelect
                value={inviteRole}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (
                    next === "owner" ||
                    next === "admin" ||
                    next === "approver" ||
                    next === "viewer"
                  ) {
                    setInviteRole(next);
                  }
                }}
              >
                {inviteRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="submit"
                disabled={isInviting || atLimit || inviteRoleOptions.length === 0}
              >
                Send Invite
              </Button>
            </form>
            {atLimit && (
              <p className="mt-2 text-sm text-destructive">
                Member limit reached. Upgrade your plan or remove a member before inviting more.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>{ROLE_LABELS[invite.role]}</TableCell>
                    <TableCell>{parseDate(invite.created_at)}</TableCell>
                    <TableCell>{parseDate(invite.expires_at)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">Pending</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void revokeInvite({ inviteId: invite.id })
                            .then(async () => {
                              await refreshMemberTables();
                              toast.success("Invite revoked.");
                            })
                            .catch((error) => {
                              showUserFacingErrorToast(error, {
                                fallback: "Failed to revoke invite.",
                              });
                            });
                        }}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pendingInvites.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No pending invitations.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const selectedRole = pendingRoleByUser[member.user_id] ?? member.role;
                return (
                  <TableRow key={member.membership_id}>
                    <TableCell>{member.name}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                    </TableCell>
                    <TableCell>{parseDate(member.joined_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isOwner && !isSelf && (
                          <>
                            <NativeSelect
                              value={selectedRole}
                              onChange={(event) => {
                                const next = event.currentTarget.value;
                                if (
                                  next === "owner" ||
                                  next === "admin" ||
                                  next === "approver" ||
                                  next === "viewer"
                                ) {
                                  setPendingRoleByUser((prev) => ({
                                    ...prev,
                                    [member.user_id]: next,
                                  }));
                                }
                              }}
                              className="h-8 w-28"
                            >
                              {roleOptionsByRole.owner.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </NativeSelect>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={selectedRole === member.role}
                              onClick={() => {
                                void updateMemberRole({
                                  userId: member.user_id,
                                  newRole: selectedRole,
                                })
                                  .then(async () => {
                                    await refreshMemberTables();
                                    toast.success("Member role updated.");
                                  })
                                  .catch((error) => {
                                    showUserFacingErrorToast(error, {
                                      fallback: "Failed to update member role.",
                                    });
                                  });
                              }}
                            >
                              Change Role
                            </Button>
                          </>
                        )}
                        {canManage && !isSelf && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setRemoveTargetUserId(member.user_id);
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {auth.isAuthenticated && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={isSoleOwner}
            onClick={() => {
              setLeaveDialogOpen(true);
            }}
          >
            Leave Organization
          </Button>
        </div>
      )}

      <AlertDialog
        open={removeTargetUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTargetUserId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `Remove ${removeTarget.email} from this organization?`
                : "Remove this member from the organization?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!removeTargetUserId) {
                  return;
                }
                void removeMember({ userId: removeTargetUserId })
                  .then(async () => {
                    await refreshMemberTables();
                    toast.success("Member removed.");
                    setRemoveTargetUserId(null);
                  })
                  .catch((error) => {
                    showUserFacingErrorToast(error, {
                      fallback: "Failed to remove member.",
                    });
                  });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          setLeaveDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to this workspace until someone invites you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void leaveOrg()
                  .then(async () => {
                    await refreshMemberTables();
                    toast.success("You left the organization.");
                    void navigate({ to: buildWorkspacePath() });
                  })
                  .catch((error) => {
                    showUserFacingErrorToast(error, {
                      fallback: "Failed to leave organization.",
                    });
                  });
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
