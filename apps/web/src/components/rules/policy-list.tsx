import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Policy } from "@/lib/types";
import { type UserFacingError, toUserFacingError } from "@/lib/user-facing-errors";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

interface PolicyListProps {
  policies: Policy[];
  onToggleEnabled: (policyId: string, enabled: boolean) => Promise<void>;
  onUpdate: (policyId: string, patch: { text?: string; enabled?: boolean }) => Promise<void>;
}

export function PolicyList({ policies, onToggleEnabled, onUpdate }: PolicyListProps) {
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyTextDraft, setPolicyTextDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const editingPolicy = useMemo(
    () => policies.find((policy) => policy.id === editingPolicyId) ?? null,
    [policies, editingPolicyId],
  );

  const closeEditor = () => {
    if (saving) {
      return;
    }
    setEditingPolicyId(null);
    setPolicyTextDraft("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Policies</CardTitle>
        <CardDescription>
          {policies.length} {policies.length === 1 ? "policy" : "policies"} configured
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <UserFacingErrorView error={error} variant="compact" /> : null}
        {policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No policies configured yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {policies.map((policy, index) => (
              <div key={policy.id ?? index} className="rounded-md border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Label
                    htmlFor={`policy-enabled-${policy.id ?? index}`}
                    className="text-xs text-muted-foreground"
                  >
                    Enabled
                  </Label>
                  <Switch
                    id={`policy-enabled-${policy.id ?? index}`}
                    aria-label={`Toggle policy ${policy.id ?? index}`}
                    checked={policy.enabled !== false}
                    onCheckedChange={(checked: boolean) => {
                      const policyId = policy.id ?? "";
                      if (!policyId) {
                        return;
                      }
                      setError(null);
                      void onToggleEnabled(policyId, checked).catch((caught) => {
                        setError(
                          toUserFacingError(caught, {
                            fallback: "Failed to update policy state.",
                          }),
                        );
                      });
                    }}
                  />
                </div>
                <blockquote className="border-l-2 border-muted-foreground/30 pl-4 text-sm italic">
                  {policy.text ?? "No text"}
                </blockquote>
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const policyId = policy.id ?? "";
                      if (!policyId) {
                        return;
                      }
                      setEditingPolicyId(policyId);
                      setPolicyTextDraft(policy.text ?? "");
                    }}
                  >
                    Edit
                  </Button>
                </div>
                {(policy.created_at !== undefined || policy.id !== undefined) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {policy.id !== undefined && <span>ID: {policy.id}</span>}
                    {policy.id !== undefined && policy.created_at !== undefined && (
                      <span> &middot; </span>
                    )}
                    {policy.created_at !== undefined && <span>Created: {policy.created_at}</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={editingPolicyId !== null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Policy</DialogTitle>
            <DialogDescription>
              Update policy text used by the workspace decision pipeline.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="policy-text-edit">Policy text</Label>
            <Textarea
              id="policy-text-edit"
              rows={8}
              value={policyTextDraft}
              onChange={(event) => setPolicyTextDraft(event.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !editingPolicy}
              onClick={async () => {
                if (!editingPolicy?.id) {
                  return;
                }
                const nextText = policyTextDraft.trim();
                if (!nextText) {
                  setError(
                    toUserFacingError(new Error("Policy text cannot be empty."), {
                      fallback: "Policy text cannot be empty.",
                    }),
                  );
                  return;
                }
                setSaving(true);
                try {
                  setError(null);
                  await onUpdate(editingPolicy.id, { text: nextText });
                  closeEditor();
                } catch (error) {
                  setError(toUserFacingError(error, { fallback: "Failed to update policy." }));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
