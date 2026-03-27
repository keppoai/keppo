import { type FormEvent, useMemo, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { resolveInviteGrantTier } from "@keppo/shared/contracts/billing";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdmin } from "@/hooks/use-admin";
import { adminInviteCodesRoute } from "./_admin.invite-codes";

export const adminInviteCodesRouteLazy = createLazyRoute(adminInviteCodesRoute.id)({
  component: AdminInviteCodesPage,
});

function AdminInviteCodesPage() {
  const { inviteCodes, inviteCodesLoaded, createInviteCode, setInviteCodeActive } = useAdmin();
  const [label, setLabel] = useState("");
  const [grantTier, setGrantTier] = useState<"free" | "starter" | "pro">("free");
  const [isCreating, setIsCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);

  const sortedInviteCodes = useMemo(
    () => [...inviteCodes].sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [inviteCodes],
  );

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextLabel = label.trim();
    if (!nextLabel) {
      return;
    }

    setIsCreating(true);
    try {
      const created = await createInviteCode(nextLabel, grantTier);
      setLastCreatedCode(created?.code ?? null);
      setLabel("");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Invite Codes</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Create launch-access codes, track redemption volume, and pause individual codes without
          rotating existing access.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Invite Code</CardTitle>
          <CardDescription>
            Free codes permanently satisfy launch access. Starter and Pro codes grant one calendar
            month of complimentary access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end"
            onSubmit={(event) => void handleCreate(event)}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-code-label">Label</Label>
              <Input
                id="invite-code-label"
                placeholder="Beta batch 1"
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-code-grant-tier">Grant tier</Label>
              <NativeSelect
                id="invite-code-grant-tier"
                value={grantTier}
                onChange={(event) =>
                  setGrantTier(event.currentTarget.value as "free" | "starter" | "pro")
                }
              >
                <NativeSelectOption value="free">Free access</NativeSelectOption>
                <NativeSelectOption value="starter">Starter for 1 month</NativeSelectOption>
                <NativeSelectOption value="pro">Pro for 1 month</NativeSelectOption>
              </NativeSelect>
            </div>
            <Button type="submit" disabled={isCreating || label.trim().length === 0}>
              Generate code
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            {grantTier === "free"
              ? "Free codes unlock the invite gate permanently and do not expire."
              : `${grantTier === "starter" ? "Starter" : "Pro"} codes unlock one month of complimentary paid access before the org falls back to Free unless Stripe checkout starts.`}
          </p>

          {lastCreatedCode ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/18 bg-primary/8 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Most recent code</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.24em] text-primary">
                  {lastCreatedCode}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(lastCreatedCode);
                }}
              >
                <CopyIcon className="mr-2 size-4" />
                Copy code
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Invite Codes</CardTitle>
          <CardDescription>
            Newest-first inventory with status and redemption count.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!inviteCodesLoaded ? (
            <p className="text-sm text-muted-foreground">Loading invite codes...</p>
          ) : sortedInviteCodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invite codes created yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Grant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uses</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedInviteCodes.map((inviteCode) => {
                    const grantTier = resolveInviteGrantTier(inviteCode.grant_tier);
                    return (
                      <TableRow key={inviteCode.id}>
                        <TableCell className="font-mono text-sm font-semibold tracking-[0.22em]">
                          {inviteCode.code}
                        </TableCell>
                        <TableCell>{inviteCode.label}</TableCell>
                        <TableCell>
                          <Badge variant={grantTier === "free" ? "secondary" : "outline"}>
                            {grantTier === "free"
                              ? "Free"
                              : `${grantTier === "starter" ? "Starter" : "Pro"} · 1 month`}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={inviteCode.active ? "outline" : "secondary"}>
                            {inviteCode.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>{inviteCode.use_count.toLocaleString()}</TableCell>
                        <TableCell>
                          {new Date(inviteCode.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <Switch
                              aria-label={`Toggle ${inviteCode.code}`}
                              checked={inviteCode.active}
                              onCheckedChange={(checked) => {
                                void setInviteCodeActive(inviteCode.id, checked);
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export { AdminInviteCodesPage };
