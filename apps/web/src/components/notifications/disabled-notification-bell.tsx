import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DisabledNotificationBell() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative"
      aria-label="Notifications"
      disabled
    >
      <BellIcon className="h-4 w-4" />
    </Button>
  );
}
