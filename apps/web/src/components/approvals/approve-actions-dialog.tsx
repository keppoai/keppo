import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ApproveActionsDialogProps = {
  open: boolean;
  pendingCount: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ApproveActionsDialog({
  open,
  pendingCount,
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
