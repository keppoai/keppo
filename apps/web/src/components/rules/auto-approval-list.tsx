import { getProviderAutoApprovalPresets } from "@keppo/shared/providers-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AutoApprovalListProps {
  autoApprovals: Array<Record<string, unknown>>;
  onToggle: (tool: string, enabled: boolean) => void;
  canManage?: boolean;
}

export function AutoApprovalList({
  autoApprovals,
  onToggle,
  canManage = true,
}: AutoApprovalListProps) {
  const presets = getProviderAutoApprovalPresets();

  function isToolEnabled(tool: string): boolean {
    return autoApprovals.some((entry) => entry.tool_name === tool && entry.enabled === true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Auto-Approvals</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {presets.map((preset) => {
            const enabled = isToolEnabled(preset.toolName);
            return (
              <div
                key={preset.toolName}
                data-testid="auto-approval-row"
                data-tool-name={preset.toolName}
                className="flex items-center justify-between gap-4"
              >
                <Label htmlFor={`auto-${preset.toolName}`} className="cursor-pointer">
                  <span className="font-mono text-sm">{preset.toolName}</span>
                </Label>
                <Badge
                  variant={
                    preset.riskLevel === "high" || preset.riskLevel === "critical"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {preset.riskLevel}
                </Badge>
                <Switch
                  id={`auto-${preset.toolName}`}
                  checked={enabled}
                  disabled={!canManage}
                  onCheckedChange={(checked: boolean) => onToggle(preset.toolName, checked)}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
