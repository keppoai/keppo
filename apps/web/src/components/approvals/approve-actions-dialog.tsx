import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ApproveActionsDialogRunSummary = {
  runId: string;
  label: string;
  pendingCount: number;
};

type ApproveActionsDialogProps = {
  open: boolean;
  pendingCount: number;
  actionTypes: string[];
  runSummaries: ApproveActionsDialogRunSummary[];
  criticalRiskCount: number;
  highRiskCount: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ApproveActionsDialog({
  open,
  pendingCount,
  actionTypes,
  runSummaries,
  criticalRiskCount,
  highRiskCount,
  submitting,
  onConfirm,
  onCancel,
}: ApproveActionsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Approve {pendingCount} action{pendingCount === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            {pendingCount > 0
              ? "This will approve every pending action still in this selection and queue them for execution immediately."
              : "No pending actions remain in this selection."}
          </DialogDescription>
        </DialogHeader>
        {pendingCount > 0 ? (
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Selection summary
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {actionTypes.map((actionType) => (
                <Badge key={actionType} variant="outline">
                  {actionType}
                </Badge>
              ))}
              {criticalRiskCount > 0 ? (
                <Badge variant="destructive">{criticalRiskCount} critical</Badge>
              ) : null}
              {highRiskCount > 0 ? <Badge variant="warning">{highRiskCount} high</Badge> : null}
            </div>
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              {runSummaries.map((run) => (
                <p key={run.runId}>
                  {run.label}: {run.pendingCount} pending
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting || pendingCount === 0}>
            {submitting ? "Approving..." : `Approve ${pendingCount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
