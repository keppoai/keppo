import { useMemo, useState } from "react";
import { AlertTriangleIcon, BellRingIcon, MailIcon, SmartphoneIcon, TrashIcon } from "lucide-react";
import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpText } from "@/components/ui/help-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useApprovalSoundPreference } from "@/hooks/use-approval-alerts";
import { useNotifications } from "@/hooks/use-notifications";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { type UserFacingError, toUserFacingError } from "@/lib/user-facing-errors";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

type EndpointPreferenceMap = Record<string, boolean>;

const parsePreferences = (value: string | undefined): EndpointPreferenceMap => {
  if (!value) {
    return {};
  }
  try {
    const parsed = parseJsonValue(value);
    if (!isJsonRecord(parsed)) {
      return {};
    }
    const result: EndpointPreferenceMap = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "boolean") {
        result[key] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
};

export function NotificationPreferences() {
  const {
    endpoints,
    eventDefinitions,
    registerEmailEndpoint,
    removeEndpoint,
    setEndpointPreferences,
    toggleEndpoint,
  } = useNotifications(10, {
    includeInbox: false,
  });
  const { isSupported, isSubscribed, permission, subscribe, unsubscribe } = usePushNotifications();
  const { enabled: soundNotificationsEnabled, setEnabled: setSoundNotificationsEnabled } =
    useApprovalSoundPreference();

  const [emailInput, setEmailInput] = useState("");
  const [busyEndpointId, setBusyEndpointId] = useState<string | null>(null);
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  const emailEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpoint.type === "email"),
    [endpoints],
  );
  const pushEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpoint.type === "push"),
    [endpoints],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Manage email and push notification delivery preferences.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <UserFacingErrorView error={error} /> : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MailIcon className="h-4 w-4" />
              Email endpoints
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={emailInput}
              placeholder="name@example.com"
              onChange={(event) => {
                setEmailInput(event.target.value);
              }}
            />
            <Button
              type="button"
              disabled={isAddingEmail || emailInput.trim().length === 0}
              onClick={async () => {
                setError(null);
                setIsAddingEmail(true);
                try {
                  await registerEmailEndpoint(emailInput.trim());
                  setEmailInput("");
                } catch (caught) {
                  setError(
                    toUserFacingError(caught, {
                      fallback: "Failed to add email endpoint.",
                    }),
                  );
                } finally {
                  setIsAddingEmail(false);
                }
              }}
            >
              Add email
            </Button>
          </div>
          <HelpText>
            Add a mailbox that should receive approvals and operator alerts even when the dashboard
            is closed.
          </HelpText>

          <div className="space-y-2">
            {emailEndpoints.length === 0 ? (
              <p className="text-xs text-muted-foreground">No email endpoints configured.</p>
            ) : (
              emailEndpoints.map((endpoint) => {
                const isOptimisticEndpoint = endpoint.id.startsWith("optimistic:");
                return (
                  <div key={endpoint.id} className="rounded-md border p-3">
                    {isOptimisticEndpoint ? (
                      <HelpText className="mb-3">Saving this endpoint...</HelpText>
                    ) : null}
                    {endpoint.delivery_warning ? (
                      <Alert variant="warning" className="mb-3">
                        <AlertTriangleIcon className="size-4" />
                        <AlertTitle>Recent delivery failures</AlertTitle>
                        <AlertDescription>
                          {endpoint.delivery_warning.consecutive_failure_count >= 2
                            ? `${endpoint.delivery_warning.consecutive_failure_count} delivery attempts in a row failed for this address.`
                            : `${endpoint.delivery_warning.recent_failure_count} recent delivery attempts failed for this address.`}{" "}
                          Confirm the mailbox is still valid, then disable and re-enable this
                          endpoint after fixing the issue.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{endpoint.destination}</p>
                        <p className="text-xs text-muted-foreground">Email notification endpoint</p>
                        {endpoint.delivery_warning ? (
                          <HelpText className="mt-1">
                            Last failure: {endpoint.delivery_warning.last_error}
                          </HelpText>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={endpoint.enabled}
                          disabled={isOptimisticEndpoint}
                          onCheckedChange={(checked) => {
                            setError(null);
                            void toggleEndpoint(endpoint.id, checked).catch((caught) => {
                              setError(
                                toUserFacingError(caught, {
                                  fallback: "Failed to update notification endpoint.",
                                }),
                              );
                            });
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isOptimisticEndpoint}
                          onClick={() => {
                            setError(null);
                            void removeEndpoint(endpoint.id).catch((caught) => {
                              setError(
                                toUserFacingError(caught, {
                                  fallback: "Failed to remove email endpoint.",
                                }),
                              );
                            });
                          }}
                          aria-label="Remove email endpoint"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="space-y-2">
                      {eventDefinitions
                        .filter((eventDefinition) => eventDefinition.channels.includes("email"))
                        .map((eventDefinition) => {
                          const preferences = parsePreferences(endpoint.notification_preferences);
                          const key = `email:${eventDefinition.id}`;
                          const checked = preferences[key] ?? true;
                          return (
                            <div
                              key={eventDefinition.id}
                              className="flex items-center justify-between gap-2"
                            >
                              <Label className="text-xs">{eventDefinition.title}</Label>
                              <Switch
                                checked={checked}
                                onCheckedChange={(nextChecked) => {
                                  const nextPreferences = {
                                    ...preferences,
                                    [key]: nextChecked,
                                  };
                                  setBusyEndpointId(endpoint.id);
                                  setError(null);
                                  void setEndpointPreferences(endpoint.id, nextPreferences)
                                    .catch((caught) => {
                                      setError(
                                        toUserFacingError(caught, {
                                          fallback: "Failed to update notification preferences.",
                                        }),
                                      );
                                    })
                                    .finally(() => {
                                      setBusyEndpointId(null);
                                    });
                                }}
                                disabled={busyEndpointId === endpoint.id || isOptimisticEndpoint}
                              />
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <SmartphoneIcon className="h-4 w-4" />
                Push notifications
              </div>
              <p className="text-xs text-muted-foreground">
                Permission: <span className="font-medium">{permission}</span>
              </p>
            </div>
            <Button
              type="button"
              variant={isSubscribed ? "secondary" : "default"}
              disabled={!isSupported}
              onClick={() => {
                setError(null);
                if (isSubscribed) {
                  void unsubscribe().catch((caught) => {
                    setError(
                      toUserFacingError(caught, {
                        fallback: "Failed to disable push notifications.",
                      }),
                    );
                  });
                } else {
                  void subscribe().catch((caught) => {
                    setError(
                      toUserFacingError(caught, {
                        fallback: "Failed to enable push notifications.",
                      }),
                    );
                  });
                }
              }}
            >
              {isSubscribed ? "Disable push" : "Enable push notifications"}
            </Button>
          </div>

          {!isSupported && (
            <p className="text-xs text-muted-foreground">
              Push notifications are not supported in this browser.
            </p>
          )}

          {pushEndpoints.map((endpoint) => {
            const preferences = parsePreferences(endpoint.notification_preferences);
            return (
              <div key={endpoint.id} className="rounded-md border p-3">
                {endpoint.delivery_warning ? (
                  <Alert variant="warning" className="mb-3">
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>Recent push delivery failures</AlertTitle>
                    <AlertDescription>
                      Keppo could not reach this browser endpoint repeatedly. Refresh the page or
                      re-grant notification permission, then re-enable push notifications.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground">{endpoint.destination}</p>
                  <Switch
                    checked={endpoint.enabled}
                    onCheckedChange={(checked) => {
                      setError(null);
                      void toggleEndpoint(endpoint.id, checked).catch((caught) => {
                        setError(
                          toUserFacingError(caught, {
                            fallback: "Failed to update push endpoint.",
                          }),
                        );
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  {eventDefinitions
                    .filter((eventDefinition) => eventDefinition.channels.includes("push"))
                    .map((eventDefinition) => {
                      const key = `push:${eventDefinition.id}`;
                      const checked = preferences[key] ?? true;
                      return (
                        <div
                          key={eventDefinition.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <Label className="text-xs">{eventDefinition.title}</Label>
                          <Switch
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              const nextPreferences = {
                                ...preferences,
                                [key]: nextChecked,
                              };
                              setError(null);
                              void setEndpointPreferences(endpoint.id, nextPreferences).catch(
                                (caught) => {
                                  setError(
                                    toUserFacingError(caught, {
                                      fallback: "Failed to update push preferences.",
                                    }),
                                  );
                                },
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <BellRingIcon className="h-4 w-4" />
            Delivery behavior
          </div>
          <p className="mt-1">
            Event notifications are sent immediately. In-app notifications are shown in the header
            bell, sidebar badge, document title, and favicon badge.
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border bg-background p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Sound notifications</p>
              <p className="text-xs text-muted-foreground">
                Play a subtle chime when new approvals arrive in real time.
              </p>
            </div>
            <Switch
              checked={soundNotificationsEnabled}
              onCheckedChange={(checked) => {
                setSoundNotificationsEnabled(checked);
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
