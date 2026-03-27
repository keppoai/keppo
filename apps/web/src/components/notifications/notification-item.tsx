import { formatDistanceToNow } from "date-fns";
import { AlertTriangleIcon, CreditCardIcon, ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardNotification } from "@/hooks/use-notifications";

type NotificationItemProps = {
  notification: DashboardNotification;
  onClick: (notification: DashboardNotification) => void;
};

const iconForEvent = (eventType: DashboardNotification["event_type"]) => {
  if (eventType === "approval_needed") {
    return ShieldCheckIcon;
  }
  if (eventType.startsWith("tool_")) {
    return AlertTriangleIcon;
  }
  return CreditCardIcon;
};

export function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const Icon = iconForEvent(notification.event_type);
  const relative = formatDistanceToNow(new Date(notification.created_at), { addSuffix: true });

  return (
    <button
      type="button"
      data-testid="notification-item"
      data-notification-id={notification.id}
      data-notification-event-type={notification.event_type}
      onClick={() => onClick(notification)}
      className={cn(
        "w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50",
        notification.read_at === null ? "border-primary/25 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">{notification.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{notification.body}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{relative}</p>
        </div>
        {notification.read_at === null && <span className="mt-1 h-2 w-2 rounded-full bg-red-500" />}
      </div>
    </button>
  );
}
