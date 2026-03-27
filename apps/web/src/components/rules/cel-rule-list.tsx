import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { CelRule } from "@/lib/types";

interface CelRuleListProps {
  rules: CelRule[];
  onToggleEnabled: (ruleId: string, enabled: boolean) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
  onUpdate: (
    ruleId: string,
    patch: {
      name?: string;
      description?: string;
      expression?: string;
      effect?: "approve" | "deny";
      enabled?: boolean;
    },
  ) => Promise<void>;
  onTest: (expression: string, context: Record<string, unknown>) => Promise<boolean>;
}

export function CelRuleList({
  rules,
  onToggleEnabled,
  onDelete,
  onUpdate,
  onTest,
}: CelRuleListProps) {
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [expressionDraft, setExpressionDraft] = useState("");
  const [effectDraft, setEffectDraft] = useState<"approve" | "deny">("deny");
  const [testContext, setTestContext] = useState(
    '{"tool":{"name":"stripe.issueRefund"},"action":{"preview":{"amount":25}}}',
  );
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editingRule = useMemo(
    () => rules.find((rule) => rule.id === editingRuleId) ?? null,
    [rules, editingRuleId],
  );

  const parseContext = (
    raw: string,
  ): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
    if (!raw.trim()) {
      return { ok: true, value: {} };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, message: "Test context must be a JSON object" };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, message: "Invalid JSON in test context" };
    }
  };

  const openEditor = (rule: CelRule): void => {
    setEditingRuleId(rule.id);
    setNameDraft(rule.name ?? "");
    setDescriptionDraft(rule.description ?? "");
    setExpressionDraft(rule.expression ?? "");
    setEffectDraft(rule.effect === "approve" ? "approve" : "deny");
    setError(null);
    setTestResult(null);
  };

  const closeEditor = (): void => {
    setEditingRuleId(null);
    setError(null);
    setTestResult(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>CEL Rules</CardTitle>
        <CardDescription>
          {rules.length} {rules.length === 1 ? "rule" : "rules"} configured
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No CEL rules configured yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Expression</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule, index) => (
                <TableRow key={rule.id ?? index}>
                  <TableCell className="font-medium">{rule.name ?? "Unnamed"}</TableCell>
                  <TableCell
                    className="max-w-[300px] truncate font-mono text-xs"
                    title={rule.expression ?? ""}
                  >
                    {rule.expression ?? ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.effect === "deny" ? "destructive" : "default"}>
                      {rule.effect ?? "unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const ruleId = rule.id ?? "";
                        if (!ruleId) {
                          return;
                        }
                        void onToggleEnabled(ruleId, !(rule.enabled !== false));
                      }}
                    >
                      {rule.enabled !== false ? "Enabled" : "Disabled"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor(rule)}
                      >
                        Edit/Test
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          const ruleId = rule.id ?? "";
                          if (!ruleId) {
                            return;
                          }
                          void onDelete(ruleId);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={Boolean(editingRule)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit CEL Rule</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-name">Name</Label>
              <Input
                id="edit-rule-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-rule-description">Description</Label>
              <Input
                id="edit-rule-description"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-rule-expression">Expression</Label>
              <Textarea
                id="edit-rule-expression"
                className="min-h-24 font-mono text-sm"
                value={expressionDraft}
                onChange={(event) => setExpressionDraft(event.currentTarget.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-rule-effect">Effect</Label>
              <NativeSelect
                id="edit-rule-effect"
                value={effectDraft}
                onChange={(event) => {
                  setEffectDraft(event.currentTarget.value === "approve" ? "approve" : "deny");
                }}
              >
                <option value="deny">Deny</option>
                <option value="approve">Approve</option>
              </NativeSelect>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-rule-context">Test Context (JSON)</Label>
              <Textarea
                id="edit-rule-context"
                className="min-h-20 font-mono text-xs"
                value={testContext}
                onChange={(event) => setTestContext(event.currentTarget.value)}
              />
            </div>

            {(error || testResult) && (
              <p className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
                {error ?? testResult}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setError(null);
                setTestResult(null);
                const parsed = parseContext(testContext);
                if (!parsed.ok) {
                  setError(parsed.message);
                  return;
                }
                try {
                  const result = await onTest(expressionDraft, parsed.value);
                  setTestResult(
                    result
                      ? "Expression matched test context"
                      : "Expression did not match test context",
                  );
                } catch (value) {
                  setError(value instanceof Error ? value.message : "Failed to test rule");
                }
              }}
            >
              Test
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!editingRule) {
                  return;
                }
                setError(null);
                try {
                  await onUpdate(editingRule.id, {
                    name: nameDraft.trim(),
                    description: descriptionDraft.trim(),
                    expression: expressionDraft.trim(),
                    effect: effectDraft,
                  });
                  closeEditor();
                } catch (value) {
                  setError(value instanceof Error ? value.message : "Failed to update rule");
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
