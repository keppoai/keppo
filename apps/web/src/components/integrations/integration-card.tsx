import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { IntegrationDetail, ProviderCatalogEntry } from "@/lib/types";
import { getProviderMeta } from "./provider-icons";
import {
  CheckCircle2Icon,
  AlertTriangleIcon,
  ChevronRightIcon,
  UnplugIcon,
  PlugIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  formatIntegrationErrorDiagnostic,
  isIntegrationCredentialExpired,
  getIntegrationUnhealthyReason,
  isIntegrationReconnectRequired,
} from "@/lib/integration-health";

interface IntegrationCardProps {
  provider: string;
  integration: IntegrationDetail | null;
  configuration?: ProviderCatalogEntry["configuration"];
  deprecation?: ProviderCatalogEntry["deprecation"];
  canManage: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onTest: () => Promise<{ ok: boolean; detail: string }>;
  onOpen: () => void;
}

export function IntegrationCard({
  provider,
  integration,
  configuration,
  deprecation,
  canManage,
  onConnect,
  onDisconnect,
  onOpen,
}: IntegrationCardProps) {
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const meta = getProviderMeta(provider);
  const connected = integration?.connected === true;
  const isExpired = isIntegrationCredentialExpired({
    credentialExpiresAt: integration?.credential_expires_at,
    hasRefreshToken: integration?.has_refresh_token,
  });
  const status = integration?.status ?? "disconnected";
  const needsReconnect = isIntegrationReconnectRequired({
    status,
    credentialExpiresAt: integration?.credential_expires_at,
    hasRefreshToken: integration?.has_refresh_token,
    lastErrorCategory: integration?.last_error_category,
  });
  const hasIntegrationRecord = integration !== null && status !== "disconnected";
  const isDegraded = status === "degraded" || isExpired;
  const providerLabel = meta.label;
  const unhealthyReason = getIntegrationUnhealthyReason({
    isExpired,
    degradedReason: integration?.degraded_reason,
    lastErrorCode: integration?.last_error_code,
    lastErrorCategory: integration?.last_error_category,
    hasRecentHealthFailure:
      Boolean(integration?.last_health_check_at) &&
      Boolean(integration?.last_successful_health_check_at) &&
      (integration?.last_health_check_at ?? "") >
        (integration?.last_successful_health_check_at ?? ""),
  });
  const errorDiagnostic = formatIntegrationErrorDiagnostic({
    lastErrorCode: integration?.last_error_code,
    lastErrorCategory: integration?.last_error_category,
  });
  const statusSummary = connected
    ? isDegraded
      ? `${providerLabel} is connected, but automations should not rely on it until this issue is fixed.`
      : `${providerLabel} is ready for automations in this workspace.`
    : needsReconnect
      ? `${providerLabel} needs attention before automations can use it again.`
      : `Connect ${providerLabel} before automations can use its tools.`;
  const statusDetail = connected
    ? isDegraded
      ? (unhealthyReason ?? "Recent health checks found a provider issue.")
      : configuration?.status === "misconfigured"
        ? configuration.message
        : deprecation?.message
          ? deprecation.message
          : (integration?.external_account_id ?? "Connected")
    : needsReconnect
      ? (unhealthyReason ?? "Reconnect the provider to restore access.")
      : meta.description;

  const Icon = meta.icon;

  return (
    <>
      <div className="group relative flex max-w-2xl items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50">
        {/* Clickable overlay covering the card for navigation */}
        {hasIntegrationRecord && (
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-testid={`open-${provider}`}
            onClick={onOpen}
            aria-label={`Open ${providerLabel} details`}
          />
        )}

        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${meta.color}`}
        >
          <Icon className="size-6" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{providerLabel}</span>
            {configuration?.status === "misconfigured" && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide text-amber-700"
              >
                warning
              </Badge>
            )}
            {deprecation && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {deprecation.status}
              </Badge>
            )}
            {connected && !isDegraded ? (
              <CheckCircle2Icon className="size-3.5 text-emerald-500" />
            ) : null}
            {isDegraded ? <AlertTriangleIcon className="size-3.5 text-amber-500" /> : null}
          </div>
          <span className="text-sm text-foreground">{statusSummary}</span>
          <span className="truncate text-xs text-muted-foreground">{statusDetail}</span>
          {connected && isDegraded && errorDiagnostic ? (
            <span className="truncate text-xs text-amber-700 dark:text-amber-400">
              Diagnostic: {errorDiagnostic}
            </span>
          ) : null}
          {deprecation ? (
            <span className="truncate text-xs text-amber-700 dark:text-amber-400">
              Provider notice: {deprecation.message}
            </span>
          ) : null}
          {configuration?.status === "misconfigured" ? (
            <span className="truncate text-xs text-amber-700 dark:text-amber-400">
              Setup issue: {configuration.message}
            </span>
          ) : null}
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-1.5">
          {connected || needsReconnect ? (
            <>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 sm:size-8 text-muted-foreground hover:text-destructive"
                  data-testid={`disconnect-${provider}`}
                  onClick={() => setDisconnectDialogOpen(true)}
                  title="Disconnect"
                >
                  <UnplugIcon className="size-4" />
                </Button>
              ) : null}
              {needsReconnect && canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3 text-sm sm:h-7 sm:px-2 sm:text-xs"
                  data-testid={`connect-${provider}`}
                  onClick={onConnect}
                >
                  <RefreshCwIcon className="mr-1 size-3" />
                  Reconnect
                </Button>
              ) : null}
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </>
          ) : canManage ? (
            <Button
              size="sm"
              className="h-10 px-3 text-sm sm:h-7 sm:px-2 sm:text-xs"
              data-testid={`connect-${provider}`}
              onClick={onConnect}
            >
              <PlugIcon className="mr-1 size-3" />
              Connect
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {providerLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Automations in this workspace will lose access to {providerLabel} tools until you
              reconnect the account. Existing runs stay in history, but future runs may fail if they
              still depend on this provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDisconnectDialogOpen(false);
                onDisconnect();
              }}
            >
              Disconnect provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Smaller card for unconfigured providers shown only in dev mode */
export function UnconfiguredIntegrationCard({
  provider,
  configuration,
  deprecation,
  canManage,
  onConnect,
}: {
  provider: string;
  configuration?: ProviderCatalogEntry["configuration"];
  deprecation?: ProviderCatalogEntry["deprecation"];
  canManage: boolean;
  onConnect: () => void;
}) {
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card p-3 shadow-sm">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
        <Icon className="size-5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{meta.label}</span>
          {configuration?.status === "misconfigured" && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-amber-700">
              warning
            </Badge>
          )}
          {deprecation && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {deprecation.status}
            </Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground sm:text-xs">{meta.description}</span>
        {configuration?.status === "misconfigured" && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {configuration.message}
          </span>
        )}
        {deprecation && (
          <span className="text-xs text-amber-700 dark:text-amber-400">{deprecation.message}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canManage ? (
          <Button
            size="sm"
            className="h-10 px-3 text-sm sm:h-7 sm:px-2 sm:text-xs"
            data-testid={`connect-${provider}`}
            onClick={onConnect}
          >
            <PlugIcon className="mr-1 size-3" />
            Connect
          </Button>
        ) : null}
        {configuration?.status === "misconfigured" ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Needs env
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
