import { useState } from "react";
import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFaviconBadge } from "@/hooks/use-favicon-badge";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { DisabledNotificationBell } from "@/components/notifications/disabled-notification-bell";

export function NotificationBell({ enabled = true }: { enabled?: boolean }) {
  const [limit, setLimit] = useState(10);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(limit, {
    enabled,
    includeSettings: false,
  });
  useFaviconBadge(unreadCount);

  if (!enabled) {
    return <DisabledNotificationBell />;
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          />
        }
      >
        <BellIcon className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          canLoadMore={notifications.length >= limit}
          onLoadMore={() => setLimit((current) => current + 10)}
        />
      </PopoverContent>
    </Popover>
  );
}
