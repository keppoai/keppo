import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";

type AutomationPromptModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
};

export function AutomationPromptModal({
  open,
  onOpenChange,
  workspaceId,
}: AutomationPromptModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>Create automation</DialogTitle>
          <DialogDescription>
            Guided automation builder for the current workspace.
          </DialogDescription>
        </DialogHeader>
        <AutomationPromptBox
          workspaceId={workspaceId}
          variant="compact"
          onCreated={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
