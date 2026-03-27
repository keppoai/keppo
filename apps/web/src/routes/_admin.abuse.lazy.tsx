import { useMemo, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAdmin } from "@/hooks/use-admin";
import { adminAbuseRoute } from "./_admin.abuse";

export const adminAbuseRouteLazy = createLazyRoute(adminAbuseRoute.id)({
  component: AdminAbusePage,
});

function AdminAbusePage() {
  const {
    abuseOrgs,
    abuseOrgsLoaded,
    getOrgDeletionPreview,
    getUserDeletionPreview,
    hardDeleteOrganization,
    hardDeleteUser,
    suspensionHistory,
    suspensionHistoryLoaded,
    suspendOrgManual,
    unsuspendOrgManual,
  } = useAdmin();
  const [dialogState, setDialogState] = useState<
    | { type: "suspend"; orgId: string; orgName: string }
    | { type: "unsuspend"; orgId: string; orgName: string }
    | null
  >(null);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [orgLookup, setOrgLookup] = useState("");
  const [orgDeleteConfirm, setOrgDeleteConfirm] = useState("");
  const [orgDeleteError, setOrgDeleteError] = useState<string | null>(null);
  const [orgDeletePreview, setOrgDeletePreview] = useState<Awaited<
    ReturnType<typeof getOrgDeletionPreview>
  > | null>(null);
  const [orgDeleteLoading, setOrgDeleteLoading] = useState(false);
  const [orgDeleteSaving, setOrgDeleteSaving] = useState(false);
  const [userLookup, setUserLookup] = useState("");
  const [userDeleteConfirm, setUserDeleteConfirm] = useState("");
  const [userDeleteError, setUserDeleteError] = useState<string | null>(null);
  const [userDeletePreview, setUserDeletePreview] = useState<Awaited<
    ReturnType<typeof getUserDeletionPreview>
  > | null>(null);
  const [userDeleteLoading, setUserDeleteLoading] = useState(false);
  const [userDeleteSaving, setUserDeleteSaving] = useState(false);

  const blockedUserDeletionMemberships =
    userDeletePreview?.organizationMemberships.filter(
      (membership) => membership.action === "blocked_transfer_required",
    ) ?? [];

  const activeSuspensions = useMemo(
    () => abuseOrgs.filter((org) => org.isSuspended && org.activeSuspension),
    [abuseOrgs],
  );

  const closeDialog = () => {
    setDialogState(null);
    setReason("");
  };

  const loadOrgDeletionPreview = async () => {
    setOrgDeleteError(null);
    setOrgDeleteLoading(true);
    try {
      setOrgDeletePreview(await getOrgDeletionPreview(orgLookup.trim()));
      setOrgDeleteConfirm("");
    } catch (error) {
      setOrgDeletePreview(null);
      setOrgDeleteError(error instanceof Error ? error.message : "Failed to load organization.");
    } finally {
      setOrgDeleteLoading(false);
    }
  };

  const submitOrgDeletion = async () => {
    if (!orgDeletePreview) {
      return;
    }
    setOrgDeleteError(null);
    setOrgDeleteSaving(true);
    try {
      const deleted = await hardDeleteOrganization(orgDeletePreview.orgId);
      toast.success(`${deleted.orgName} deleted`);
      setOrgLookup("");
      setOrgDeleteConfirm("");
      setOrgDeletePreview(null);
    } catch (error) {
      setOrgDeleteError(error instanceof Error ? error.message : "Failed to delete organization.");
    } finally {
      setOrgDeleteSaving(false);
    }
  };

  const loadUserDeletionPreview = async () => {
    setUserDeleteError(null);
    setUserDeleteLoading(true);
    try {
      setUserDeletePreview(await getUserDeletionPreview(userLookup.trim()));
      setUserDeleteConfirm("");
    } catch (error) {
      setUserDeletePreview(null);
      setUserDeleteError(error instanceof Error ? error.message : "Failed to load user.");
    } finally {
      setUserDeleteLoading(false);
    }
  };

  const submitUserDeletion = async () => {
    if (!userDeletePreview) {
      return;
    }
    setUserDeleteError(null);
    setUserDeleteSaving(true);
    try {
      const deleted = await hardDeleteUser(userDeletePreview.userId);
      toast.success(
        deleted.deletedOrgIds.length > 0
          ? `${deleted.email} and ${deleted.deletedOrgIds.length} org(s) deleted`
          : `${deleted.email} deleted`,
      );
      setUserLookup("");
      setUserDeleteConfirm("");
      setUserDeletePreview(null);
    } catch (error) {
      setUserDeleteError(error instanceof Error ? error.message : "Failed to delete user.");
    } finally {
      setUserDeleteSaving(false);
    }
  };

  const submitDialog = async () => {
    if (!dialogState) {
      return;
    }
    setIsSaving(true);
    try {
      if (dialogState.type === "suspend") {
        await suspendOrgManual(dialogState.orgId, reason.trim());
        toast.success(`${dialogState.orgName} suspended`);
      } else {
        await unsuspendOrgManual(dialogState.orgId);
        toast.success(`${dialogState.orgName} restored`);
      }
      closeDialog();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Abuse</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review active suspensions, suspend or restore organizations, and inspect recent suspension
          history.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Suspensions</CardTitle>
          <CardDescription>Organizations currently blocked from platform activity.</CardDescription>
        </CardHeader>
        <CardContent>
          {!abuseOrgsLoaded ? (
            <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading suspension state...
            </div>
          ) : activeSuspensions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No organizations are currently suspended.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {activeSuspensions.map((org) => (
                <div
                  key={org.orgId}
                  className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{org.orgName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{org.orgSlug}</p>
                      <p className="text-sm text-muted-foreground">
                        {org.activeSuspension?.reason}
                      </p>
                    </div>
                    <Badge variant="destructive">Suspended</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {org.activeSuspension
                        ? `Since ${new Date(org.activeSuspension.suspendedAt).toLocaleString()}`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDialogState({
                          type: "unsuspend",
                          orgId: org.orgId,
                          orgName: org.orgName,
                        })
                      }
                    >
                      Unsuspend
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Organizations</CardTitle>
          <CardDescription>
            Manual suspend and restore controls for every organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!abuseOrgsLoaded ? (
            <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading organizations...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>History</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abuseOrgs.map((org) => (
                  <TableRow key={org.orgId}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{org.orgName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{org.orgSlug}</p>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{org.tier}</TableCell>
                    <TableCell>
                      <Badge variant={org.isSuspended ? "destructive" : "outline"}>
                        {org.isSuspended ? "Suspended" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>{org.suspensionHistoryCount}</TableCell>
                    <TableCell>
                      {org.isSuspended ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDialogState({
                              type: "unsuspend",
                              orgId: org.orgId,
                              orgName: org.orgName,
                            })
                          }
                        >
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setDialogState({
                              type: "suspend",
                              orgId: org.orgId,
                              orgName: org.orgName,
                            })
                          }
                        >
                          Suspend
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suspension History</CardTitle>
          <CardDescription>
            Most recent suspension and restoration events across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!suspensionHistoryLoaded ? (
            <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading suspension history...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Suspended By</TableHead>
                  <TableHead>Suspended At</TableHead>
                  <TableHead>Lifted At</TableHead>
                  <TableHead>Lifted By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suspensionHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.orgName}</TableCell>
                    <TableCell className="max-w-[280px]">{entry.reason}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.suspendedBy}</TableCell>
                    <TableCell>{new Date(entry.suspendedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {entry.liftedAt ? new Date(entry.liftedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.liftedBy ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-destructive">Danger Zone</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            These actions permanently delete data across both the app schema and Better Auth. They
            cannot be undone.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-red-500/40 bg-red-500/[0.03]">
            <CardHeader>
              <CardTitle className="text-destructive">Delete Organization</CardTitle>
              <CardDescription>
                Permanently removes the organization, all workspaces, auth memberships, and all
                transitive records. Enter an organization slug or ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-delete-lookup">Organization slug or ID</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="org-delete-lookup"
                    value={orgLookup}
                    onChange={(event) => {
                      setOrgLookup(event.target.value);
                      setOrgDeletePreview(null);
                      setOrgDeleteConfirm("");
                      setOrgDeleteError(null);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        orgLookup.trim().length === 0 ||
                        orgDeleteLoading
                      ) {
                        return;
                      }
                      event.preventDefault();
                      void loadOrgDeletionPreview();
                    }}
                    placeholder="acme-inc or org_123"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadOrgDeletionPreview}
                    disabled={orgDeleteLoading || orgLookup.trim().length === 0}
                  >
                    {orgDeleteLoading ? "Loading..." : "Load Preview"}
                  </Button>
                </div>
              </div>
              {orgDeleteError ? <p className="text-sm text-destructive">{orgDeleteError}</p> : null}

              {orgDeletePreview ? (
                <div className="space-y-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <div className="space-y-1">
                    <p className="font-medium">{orgDeletePreview.orgName}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {orgDeletePreview.orgSlug}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {orgDeletePreview.memberCount} members, {orgDeletePreview.workspaceCount}{" "}
                      workspaces, {orgDeletePreview.automationCount} automations,{" "}
                      {orgDeletePreview.notificationEndpointCount} notification endpoints.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-delete-confirm">
                      Type <code>DELETE_ORG</code> to confirm
                    </Label>
                    <Input
                      id="org-delete-confirm"
                      value={orgDeleteConfirm}
                      onChange={(event) => setOrgDeleteConfirm(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "Enter" ||
                          orgDeleteSaving ||
                          orgDeleteConfirm !== "DELETE_ORG"
                        ) {
                          return;
                        }
                        event.preventDefault();
                        void submitOrgDeletion();
                      }}
                      placeholder="DELETE_ORG"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={submitOrgDeletion}
                    disabled={orgDeleteSaving || orgDeleteConfirm !== "DELETE_ORG"}
                  >
                    {orgDeleteSaving ? "Deleting..." : "Permanently Delete Organization"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-red-500/40 bg-red-500/[0.03]">
            <CardHeader>
              <CardTitle className="text-destructive">Delete User</CardTitle>
              <CardDescription>
                Permanently removes the user, deletes organizations they own alone, and removes
                their memberships from shared organizations. Enter a user email or Better Auth user
                ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="user-delete-lookup">User email or ID</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="user-delete-lookup"
                    value={userLookup}
                    onChange={(event) => {
                      setUserLookup(event.target.value);
                      setUserDeletePreview(null);
                      setUserDeleteConfirm("");
                      setUserDeleteError(null);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        userLookup.trim().length === 0 ||
                        userDeleteLoading
                      ) {
                        return;
                      }
                      event.preventDefault();
                      void loadUserDeletionPreview();
                    }}
                    placeholder="person@example.com or user_123"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadUserDeletionPreview}
                    disabled={userDeleteLoading || userLookup.trim().length === 0}
                  >
                    {userDeleteLoading ? "Loading..." : "Load Preview"}
                  </Button>
                </div>
              </div>
              {userDeleteError ? (
                <p className="text-sm text-destructive">{userDeleteError}</p>
              ) : null}

              {userDeletePreview ? (
                <div className="space-y-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <div className="space-y-1">
                    <p className="font-medium">{userDeletePreview.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {userDeletePreview.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {userDeletePreview.organizationMemberships.length} organization memberships
                      will be reviewed before deleting this user.
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {userDeletePreview.organizationMemberships.map((membership) => (
                      <p key={`${membership.orgId}:${membership.role}`}>
                        {membership.orgName} (<code>{membership.orgSlug}</code>) as{" "}
                        {membership.role}
                        {" · "}
                        {membership.action === "delete_org"
                          ? "organization will be deleted"
                          : membership.action === "remove_membership"
                            ? "membership will be removed"
                            : "ownership transfer required before deletion"}
                      </p>
                    ))}
                  </div>
                  {blockedUserDeletionMemberships.length > 0 ? (
                    <p className="text-sm text-destructive">
                      Transfer ownership or manually delete the blocked organization entries before
                      deleting this user.
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="user-delete-confirm">
                      Type <code>DELETE_USER</code> to confirm
                    </Label>
                    <Input
                      id="user-delete-confirm"
                      value={userDeleteConfirm}
                      onChange={(event) => setUserDeleteConfirm(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "Enter" ||
                          userDeleteSaving ||
                          userDeleteConfirm !== "DELETE_USER" ||
                          blockedUserDeletionMemberships.length > 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        void submitUserDeletion();
                      }}
                      placeholder="DELETE_USER"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={submitUserDeletion}
                    disabled={
                      userDeleteSaving ||
                      userDeleteConfirm !== "DELETE_USER" ||
                      blockedUserDeletionMemberships.length > 0
                    }
                  >
                    {userDeleteSaving ? "Deleting..." : "Permanently Delete User"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={dialogState !== null}
        onOpenChange={(open) => (!open ? closeDialog() : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogState?.type === "suspend"
                ? "Suspend organization?"
                : "Unsuspend organization?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialogState?.type === "suspend"
                ? `This blocks ${dialogState.orgName} from continued platform usage until it is manually restored.`
                : `This restores ${dialogState?.orgName} and allows the organization to resume normal use.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialogState?.type === "suspend" ? (
            <div className="space-y-2">
              <Label htmlFor="suspension-reason">Reason</Label>
              <Textarea
                id="suspension-reason"
                placeholder="Describe why this organization is being suspended."
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving || (dialogState?.type === "suspend" && reason.trim().length === 0)}
              className={
                dialogState?.type === "suspend"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              onClick={(event) => {
                event.preventDefault();
                void submitDialog();
              }}
            >
              {isSaving ? "Saving..." : dialogState?.type === "suspend" ? "Suspend" : "Unsuspend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
