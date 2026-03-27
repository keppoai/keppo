import { type FormEvent, useEffect, useRef, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAdmin } from "@/hooks/use-admin";
import { adminFlagsRoute } from "./_admin.flags";

export const adminFlagsRouteLazy = createLazyRoute(adminFlagsRoute.id)({
  component: AdminFlagsPage,
});

function AdminFlagsPage() {
  const {
    flags,
    dogfoodOrgs,
    flagsLoaded,
    dogfoodOrgsLoaded,
    setFlagEnabled,
    addDogfoodOrg,
    removeDogfoodOrg,
    seedDefaultFlags,
  } = useAdmin();
  const [orgIdInput, setOrgIdInput] = useState("");
  const [isAddingOrg, setIsAddingOrg] = useState(false);
  const hasSeededRef = useRef(false);

  useEffect(() => {
    if (!flagsLoaded || hasSeededRef.current) {
      return;
    }
    hasSeededRef.current = true;
    if (flags.length === 0) {
      void seedDefaultFlags();
    }
  }, [flags.length, flagsLoaded, seedDefaultFlags]);

  const handleAddDogfoodOrg = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const orgId = orgIdInput.trim();
    if (!orgId) {
      return;
    }

    setIsAddingOrg(true);
    try {
      await addDogfoodOrg(orgId);
      setOrgIdInput("");
    } finally {
      setIsAddingOrg(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Feature Flags</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Manage platform rollout switches and the dogfood organization allowlist.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Toggle dogfood features globally.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!flagsLoaded ? (
            <p className="text-sm text-muted-foreground">Loading feature flags...</p>
          ) : flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feature flags configured yet.</p>
          ) : (
            flags.map((flag) => (
              <div
                key={flag.id}
                className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="font-medium">{flag.label}</p>
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                  <p className="font-mono text-xs text-muted-foreground">{flag.key}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`flag-${flag.key}`}>
                    {flag.enabled ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id={`flag-${flag.key}`}
                    checked={flag.enabled}
                    onCheckedChange={(checked) => {
                      void setFlagEnabled(flag.key, checked);
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dogfood Organizations</CardTitle>
          <CardDescription>
            Organizations in this list receive enabled dogfood features.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => void handleAddDogfoodOrg(event)}
          >
            <Label htmlFor="dogfood-org-id">Organization ID</Label>
            <Input
              id="dogfood-org-id"
              placeholder="org_123"
              value={orgIdInput}
              onChange={(event) => setOrgIdInput(event.currentTarget.value)}
            />
            <Button type="submit" disabled={isAddingOrg || orgIdInput.trim().length === 0}>
              Add
            </Button>
          </form>

          {!dogfoodOrgsLoaded ? (
            <p className="text-sm text-muted-foreground">Loading dogfood organizations...</p>
          ) : dogfoodOrgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No organizations are in the dogfood group.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {dogfoodOrgs.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs sm:text-sm">{org.org_id}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void removeDogfoodOrg(org.org_id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export { AdminFlagsPage };
