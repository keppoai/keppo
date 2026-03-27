import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  getDefaultActionBehaviorMeta,
  getWorkspacePolicyModeMeta,
} from "@/lib/workspace-view-model";

const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required."),
  policy_mode: z.enum(["manual_only", "rules_first", "rules_plus_agent"]),
  default_action_behavior: z.enum([
    "require_approval",
    "allow_if_rule_matches",
    "auto_approve_all",
  ]),
});

type WorkspaceCreateValues = z.infer<typeof workspaceCreateSchema>;

interface WorkspaceCreateFormProps {
  onSubmit: (values: WorkspaceCreateValues) => Promise<void>;
}

export function WorkspaceCreateForm({ onSubmit }: WorkspaceCreateFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const {
    register,
    watch,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WorkspaceCreateValues>({
    resolver: zodResolver(workspaceCreateSchema),
    defaultValues: {
      name: "",
      policy_mode: "manual_only",
      default_action_behavior: "require_approval",
    },
  });

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values);
        reset();
      })}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-name">Name</Label>
        <Input id="workspace-name" placeholder="Customer support" {...register("name")} />
        <p className="text-xs text-muted-foreground">
          Use the team or workflow name operators will recognize later.
        </p>
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>
      <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
        <p className="text-sm font-medium text-foreground">Recommended defaults</p>
        <p className="mt-1 text-sm text-muted-foreground">
          New workspaces start in manual review mode and require approval for every action.
        </p>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-medium">
          <span>Customize automation behavior</span>
          <span className="text-xs text-muted-foreground">
            {advancedOpen ? "Hide" : "Optional"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-policy-mode">Policy mode</Label>
            <NativeSelect id="workspace-policy-mode" {...register("policy_mode")}>
              <option value="manual_only">Manual review only</option>
              <option value="rules_first">Rules guide decisions</option>
              <option value="rules_plus_agent">Rules and policy agent</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {getWorkspacePolicyModeMeta(watch("policy_mode")).description}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-default-behavior">Default action behavior</Label>
            <NativeSelect id="workspace-default-behavior" {...register("default_action_behavior")}>
              <option value="require_approval">Require approval</option>
              <option value="allow_if_rule_matches">Allow when a rule matches</option>
              <option value="auto_approve_all">Auto-approve all</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {getDefaultActionBehaviorMeta(watch("default_action_behavior")).description}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button type="submit" className="w-fit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create Workspace"}
      </Button>
    </form>
  );
}
