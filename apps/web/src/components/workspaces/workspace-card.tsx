import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Workspace } from "@/lib/types";
import {
  formatWorkspaceStatus,
  getDefaultActionBehaviorMeta,
  getWorkspacePolicyModeMeta,
} from "@/lib/workspace-view-model";

interface WorkspaceCardProps {
  workspace: Workspace;
  isSelected: boolean;
  onSelect: () => void;
}

export function WorkspaceCard({ workspace, isSelected, onSelect }: WorkspaceCardProps) {
  const policyMode = getWorkspacePolicyModeMeta(workspace.policy_mode);
  const defaultBehavior = getDefaultActionBehaviorMeta(workspace.default_action_behavior);

  return (
    <Card
      data-testid="workspace-card"
      data-workspace-id={workspace.id}
      data-workspace-name={workspace.name}
      className={`cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={onSelect}
    >
      <CardHeader>
        <CardTitle>{workspace.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Automation mode</span>
            <Badge variant={policyMode.badgeVariant}>{policyMode.shortLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{policyMode.description}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="text-sm font-medium">{formatWorkspaceStatus(workspace.status)}</span>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Default behavior</span>
            <span className="text-sm">{defaultBehavior.label}</span>
            <span className="text-xs text-muted-foreground">{defaultBehavior.description}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">MCP access</span>
            <span className="text-sm">Credential ready on demand</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
