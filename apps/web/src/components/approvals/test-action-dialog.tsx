import { useState } from "react";
import { makeFunctionReference } from "convex/server";
import {
  getDefaultTestActionProviderId,
  getProviderDisplayName,
  getProviderTestActionTemplates,
} from "@keppo/shared/providers-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { FlaskConicalIcon } from "lucide-react";
import { toast } from "sonner";

export function TestActionDialog({ workspaceId }: { workspaceId: string }) {
  const runtime = useDashboardRuntime();
  const { session } = useAuth();
  const userEmail = session?.user?.email ?? "";
  const testProviderId = getDefaultTestActionProviderId();
  const testProviderLabel = testProviderId ? getProviderDisplayName(testProviderId) : "Provider";
  const tools = testProviderId ? getProviderTestActionTemplates(testProviderId) : [];
  const firstTool = tools[0];
  const [open, setOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState(firstTool?.toolName ?? "");

  const hydrateDefaults = (template: (typeof tools)[number]) => {
    const defaults = { ...template.defaults };
    if (userEmail && "to" in defaults) {
      defaults.to = userEmail;
    }
    return defaults;
  };

  const [values, setValues] = useState<Record<string, string>>(() =>
    firstTool ? hydrateDefaults(firstTool) : {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const createTestAction = runtime.useMutation(
    makeFunctionReference<"mutation">("actions:createTestAction"),
  );

  if (!testProviderId || !firstTool) {
    return (
      <Button variant="outline" size="sm" disabled>
        <FlaskConicalIcon className="size-4" />
        Test Action
      </Button>
    );
  }

  const tool = tools.find((entry) => entry.toolName === selectedTool) ?? firstTool;

  const handleToolChange = (toolName: string) => {
    const next = tools.find((entry) => entry.toolName === toolName) ?? firstTool;
    setSelectedTool(next.toolName);
    setValues(hydrateDefaults(next));
  };

  const handleSubmit = async () => {
    if (!workspaceId) return;
    setError(null);
    setLoading(true);
    try {
      const input = tool.buildInput(values);
      await createTestAction({
        workspaceId,
        tool_name: tool.toolName,
        input,
      });
      setOpen(false);
      toast.success("Test action created");
    } catch (error) {
      setError(toUserFacingError(error, { fallback: "Failed to create test action." }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={!workspaceId} />}>
        <FlaskConicalIcon className="size-4" />
        Test Action
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Test {testProviderLabel} Action</DialogTitle>
          <DialogDescription>
            Fire a real {testProviderLabel} tool call through the gating pipeline. If approved, it
            executes against the connected integration.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? <UserFacingErrorView error={error} variant="compact" /> : null}
          <div className="grid gap-2">
            <Label htmlFor="tool-select">Action</Label>
            <NativeSelect
              id="tool-select"
              value={selectedTool}
              onChange={(e) => handleToolChange(e.target.value)}
            >
              {tools.map((entry) => (
                <NativeSelectOption key={entry.toolName} value={entry.toolName}>
                  {entry.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {tool.fields.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={`field-${field.key}`}
                  rows={4}
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              ) : (
                <Input
                  id={`field-${field.key}`}
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => void handleSubmit()} disabled={loading}>
            {loading ? "Sending..." : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
