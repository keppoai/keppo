self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Keppo",
      body: event.data.text(),
    };
  }

  const title = typeof payload.title === "string" ? payload.title : "Keppo Notification";
  const body = typeof payload.body === "string" ? payload.body : "You have a new notification.";
  const icon = typeof payload.icon === "string" ? payload.icon : "/keppo-icon-192.png";
  const badge = typeof payload.badge === "string" ? payload.badge : "/keppo-icon-192.png";
  const url = typeof payload.url === "string" ? payload.url : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    event.notification && event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    }),
  );
});
