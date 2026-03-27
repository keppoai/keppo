import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DashboardNotification } from "@/hooks/use-notifications";
import { useRouteParams } from "@/hooks/use-route-params";
import { NotificationItem } from "@/components/notifications/notification-item";

type NotificationPanelProps = {
  notifications: DashboardNotification[];
  unreadCount: number;
  onMarkRead: (eventId: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
};

export function NotificationPanel({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  canLoadMore = false,
  onLoadMore,
}: NotificationPanelProps) {
  const navigate = useNavigate();
  const { buildWorkspacePath, scopePath } = useRouteParams();

  const handleClick = async (notification: DashboardNotification) => {
    if (notification.read_at === null) {
      await onMarkRead(notification.id);
    }
    const ctaUrl = notification.cta_url;
    if (ctaUrl && ctaUrl.startsWith("/")) {
      await navigate({ to: scopePath(ctaUrl) });
      return;
    }
    await navigate({ to: buildWorkspacePath() });
  };

  return (
    <div className="w-[360px]" data-testid="notification-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Notifications</p>
          <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={unreadCount === 0}
          onClick={() => {
            void onMarkAllRead();
          }}
        >
          Mark all read
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No notifications
        </div>
      ) : (
        <ScrollArea className="h-[360px] pr-2">
          <div className="space-y-2 pb-1">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={(item) => {
                  void handleClick(item);
                }}
              />
            ))}
            {canLoadMore ? (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onLoadMore}
                >
                  View all notifications
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
