import { integrationDetailRoute } from "./integrations.$provider";
import { useEffect, useMemo, useState } from "react";
import { createLazyRoute, Link } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { jsonRecordSchema } from "@keppo/shared/providers/boundaries/common";
import { GOOGLE_PROVIDER_ID } from "@keppo/shared/provider-ids";
import {
  getProviderDetailUi,
  getProviderMetadataEditorDefaults,
  getProviderUiDefaults,
  getProviderWriteToolDefaultInput,
  type ProviderMetadataEditorConfig,
  type ProviderUiField,
} from "@keppo/shared/providers-ui";
import { useAuth } from "@/hooks/use-auth";
import { useIntegrations } from "@/hooks/use-integrations";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { fullTimestamp, relativeTime } from "@/lib/format";
import {
  formatIntegrationErrorDiagnostic,
  getIntegrationUnhealthyReason,
  isIntegrationCredentialExpired,
  isIntegrationReconnectRequired,
} from "@/lib/integration-health";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import {
  getActionStatusView,
  getProviderDeprecation,
  getProviderCatalogEntry,
  getProviderIntegration,
  getProviderWriteTools,
  isWorkspaceProviderEnabled,
  normalizeProviderValue,
  resolveIntegrationProviderRoute,
} from "@/lib/provider-view-model";
import type { ProviderCatalogEntry } from "@/lib/types";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

const toDefaultGenericInput = (toolName: string): Record<string, unknown> => {
  return getProviderWriteToolDefaultInput(toolName);
};

const toRecord = (value: unknown): Record<string, unknown> => {
  const parsed = jsonRecordSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }
  return parsed.data;
};

const stableJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
};

const getFieldValue = (values: Record<string, unknown>, field: ProviderUiField): string => {
  const raw = values[field.id];
  if (raw === undefined || raw === null) {
    return "";
  }

  if (field.type === "json") {
    if (typeof raw === "string") {
      return raw;
    }
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return "";
    }
  }

  return String(raw);
};

const setFieldValue = (
  values: Record<string, unknown>,
  fieldId: string,
  value: string,
): Record<string, unknown> => {
  return {
    ...values,
    [fieldId]: value,
  };
};

const isKnownActionStatus = (
  value: string | undefined,
): value is
  | "succeeded"
  | "failed"
  | "rejected"
  | "pending"
  | "approved"
  | "executing"
  | "expired"
  | "still_pending" => {
  return (
    value === "succeeded" ||
    value === "failed" ||
    value === "rejected" ||
    value === "pending" ||
    value === "approved" ||
    value === "executing" ||
    value === "expired" ||
    value === "still_pending"
  );
};

const getFieldInputType = (field: ProviderUiField): string => {
  if (field.type === "email") {
    return "email";
  }
  if (field.type === "number") {
    return "number";
  }
  return "text";
};

type GoogleIncomingEmailTriggerHealth = {
  activeMode: "webhook" | "polling" | null;
  watchTopicName: string | null;
  watchExpiration: string | null;
  historyCursor: string | null;
  lastSyncAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
};

const parseGoogleIncomingEmailTriggerHealth = (
  metadata: Record<string, unknown>,
): GoogleIncomingEmailTriggerHealth | null => {
  const lifecycleRoot =
    metadata.automation_trigger_lifecycle &&
    typeof metadata.automation_trigger_lifecycle === "object" &&
    !Array.isArray(metadata.automation_trigger_lifecycle)
      ? (metadata.automation_trigger_lifecycle as Record<string, unknown>)
      : null;
  const providerRoot =
    lifecycleRoot?.google &&
    typeof lifecycleRoot.google === "object" &&
    !Array.isArray(lifecycleRoot.google)
      ? (lifecycleRoot.google as Record<string, unknown>)
      : null;
  const triggerRoot =
    providerRoot?.incoming_email &&
    typeof providerRoot.incoming_email === "object" &&
    !Array.isArray(providerRoot.incoming_email)
      ? (providerRoot.incoming_email as Record<string, unknown>)
      : null;
  if (!triggerRoot) {
    return null;
  }

  const asNullableString = (value: unknown): string | null => {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  };

  const activeMode = asNullableString(triggerRoot.active_mode);

  return {
    activeMode: activeMode === "webhook" || activeMode === "polling" ? activeMode : null,
    watchTopicName: asNullableString(triggerRoot.watch_topic_name),
    watchExpiration: asNullableString(triggerRoot.watch_expiration),
    historyCursor: asNullableString(triggerRoot.history_cursor),
    lastSyncAt: asNullableString(triggerRoot.last_sync_at),
    lastPollAt: asNullableString(triggerRoot.last_poll_at),
    lastError: asNullableString(triggerRoot.last_error),
  };
};

function ProviderEventHealthCard({
  health,
  connected,
}: {
  health: GoogleIncomingEmailTriggerHealth | null;
  connected: boolean;
}) {
  const deliveryLabel = health?.activeMode ?? (connected ? "polling" : null);
  const watchHealthy = Boolean(
    health?.watchTopicName && health.watchExpiration && !health.lastError,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail Event Delivery</CardTitle>
        <CardDescription>
          Incoming-email automations prefer Gmail push delivery and fall back to polling when push
          is unavailable or degraded.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Integration connected" : "Reconnect required"}
          </Badge>
          {deliveryLabel ? (
            <Badge variant="outline" className="capitalize">
              {deliveryLabel}
            </Badge>
          ) : null}
          {watchHealthy ? <Badge variant="secondary">Push watch active</Badge> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border bg-muted/20 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Push delivery
            </p>
            <p className="mt-2 text-sm font-semibold">
              {health?.watchTopicName ? "Configured" : "Polling fallback only"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health?.watchExpiration
                ? `Watch expires ${relativeTime(health.watchExpiration)} (${fullTimestamp(health.watchExpiration)})`
                : "Push delivery is not configured for this workspace yet, so Gmail will fall back to polling."}
            </p>
          </div>

          <div className="rounded-2xl border bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Sync position
            </p>
            <p className="mt-2 text-sm font-semibold font-mono">
              {health?.historyCursor ?? "Not initialized"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health?.lastPollAt
                ? `Last poll ${relativeTime(health.lastPollAt)}`
                : "Polling has not advanced yet."}
            </p>
          </div>
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Last lifecycle sync:</span>{" "}
            <span>{health?.lastSyncAt ? fullTimestamp(health.lastSyncAt) : "Never"}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Last poll:</span>{" "}
            <span>{health?.lastPollAt ? fullTimestamp(health.lastPollAt) : "Never"}</span>
          </div>
          {health?.lastError ? (
            <div>
              <span className="font-medium text-foreground">Last trigger error:</span>{" "}
              <span>{health.lastError}</span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export const integrationDetailRouteLazy = createLazyRoute(integrationDetailRoute.id)({
  component: IntegrationDetailPage,
});

function IntegrationDetailsHeader({
  provider,
  connected,
  needsReconnect,
  externalAccountId,
  scopes,
  status,
  expiresAt,
  hasRefreshToken,
  lastHealth,
  lastHealthy,
  lastWebhook,
  lastErrorCode,
  lastErrorCategory,
  degradedReason,
}: {
  provider: string;
  connected: boolean;
  needsReconnect: boolean;
  externalAccountId: string | null;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  hasRefreshToken: boolean;
  lastHealth: string | null | undefined;
  lastHealthy: string | null | undefined;
  lastWebhook: string | null | undefined;
  lastErrorCode: string | null | undefined;
  lastErrorCategory: string | null | undefined;
  degradedReason: string | null | undefined;
}) {
  const connectionLabel = connected
    ? "Connected"
    : needsReconnect
      ? "Needs reconnect"
      : "Not connected";
  const accountLabel = externalAccountId ?? "No account linked yet";
  const isExpired = isIntegrationCredentialExpired({
    credentialExpiresAt: expiresAt,
    hasRefreshToken,
  });
  const hasRecentHealthFailure = Boolean(lastHealth && lastHealthy && lastHealth > lastHealthy);
  const unhealthyReason = getIntegrationUnhealthyReason({
    isExpired,
    degradedReason,
    lastErrorCode,
    lastErrorCategory,
    hasRecentHealthFailure,
  });
  const errorDiagnostic = formatIntegrationErrorDiagnostic({
    lastErrorCode,
    lastErrorCategory,
  });
  const healthSummary = unhealthyReason
    ? unhealthyReason
    : connected
      ? "Connection looks healthy."
      : needsReconnect
        ? "Reconnect the provider before testing actions."
        : "Connect the provider before testing actions.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{`${provider} Integration`}</CardTitle>
        <CardDescription>
          Review connection health, workspace readiness, and the operator-facing account context.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">Connection:</span>{" "}
          <Badge variant={connected ? "default" : "destructive"}>{connectionLabel}</Badge>
          <span className="ml-2">{status}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Account:</span>{" "}
          <span className={externalAccountId ? "font-mono" : undefined}>{accountLabel}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Available scopes:</span>{" "}
          <span>{scopes.length > 0 ? scopes.join(", ") : "None"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Credential expiry:</span>{" "}
          <span>{expiresAt ?? "Unknown"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Last health check:</span>{" "}
          <span>{lastHealth ?? "Never"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Last successful check:</span>{" "}
          <span>{lastHealthy ?? "Never"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Last webhook:</span>{" "}
          <span>{lastWebhook ?? "Never"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Health summary:</span>{" "}
          <span>{healthSummary}</span>
        </div>
        {unhealthyReason ? (
          <div>
            <span className="font-medium text-foreground">Why unhealthy:</span>{" "}
            <span>{unhealthyReason}</span>
          </div>
        ) : null}
        {errorDiagnostic ? (
          <div>
            <span className="font-medium text-foreground">Diagnostic:</span>{" "}
            <span>{errorDiagnostic}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IntegrationDetailPage() {
  const runtime = useDashboardRuntime();
  const { buildWorkspacePath, integrationProvider } = useRouteParams();
  const provider = integrationProvider ?? "";
  const { integrations } = useIntegrations();
  const providerCatalogRaw = runtime.useQuery(
    makeFunctionReference<"query">("integrations:providerCatalog"),
    {},
  );
  const providerCatalog = useMemo<ProviderCatalogEntry[]>(() => {
    return parseProviderCatalogPayload(providerCatalogRaw ?? []);
  }, [providerCatalogRaw]);

  const routeResolution = useMemo(
    () =>
      resolveIntegrationProviderRoute(
        provider,
        providerCatalog.map((entry) => entry.provider),
      ),
    [provider, providerCatalog],
  );

  const canonicalProvider =
    routeResolution.status === "canonical" ? routeResolution.providerId : null;

  const providerCatalogEntry = useMemo(() => {
    if (!canonicalProvider) {
      return null;
    }
    return getProviderCatalogEntry(providerCatalog, canonicalProvider);
  }, [canonicalProvider, providerCatalog]);

  const writeTools = useMemo(
    () => getProviderWriteTools(providerCatalogEntry),
    [providerCatalogEntry],
  );
  const providerDeprecation = useMemo(
    () => getProviderDeprecation(providerCatalogEntry),
    [providerCatalogEntry],
  );
  const hasWriteCapability = writeTools.length > 0;

  const providerUi = useMemo(() => {
    if (!canonicalProvider) {
      return null;
    }
    return getProviderDetailUi(canonicalProvider);
  }, [canonicalProvider]);

  const normalizedProvider = canonicalProvider ?? normalizeProviderValue(provider);
  const providerLabel = canonicalProvider
    ? getProviderMeta(canonicalProvider).label
    : routeResolution.status === "non_canonical"
      ? getProviderMeta(routeResolution.canonicalProviderId).label
      : capitalize(normalizedProvider);

  const { selectedWorkspaceId, selectedWorkspaceIntegrations } = useWorkspace();
  const auth = useAuth();
  const { canApprove } = auth;
  const signedInUserEmail = auth.session?.user?.email ?? null;

  const integration = useMemo(() => {
    if (!canonicalProvider) {
      return null;
    }
    return getProviderIntegration(integrations, canonicalProvider);
  }, [canonicalProvider, integrations]);

  const connected = integration?.connected === true;
  const isExpired = isIntegrationCredentialExpired({
    credentialExpiresAt: integration?.credential_expires_at,
    hasRefreshToken: integration?.has_refresh_token,
  });
  const needsReconnect = isIntegrationReconnectRequired({
    status: integration?.status,
    credentialExpiresAt: integration?.credential_expires_at,
    hasRefreshToken: integration?.has_refresh_token,
    lastErrorCategory: integration?.last_error_category,
  });
  const integrationMetadata = useMemo(
    () => toRecord(integration?.metadata),
    [integration?.metadata],
  );
  const googleIncomingEmailHealth = useMemo(() => {
    if (canonicalProvider !== GOOGLE_PROVIDER_ID) {
      return null;
    }
    return parseGoogleIncomingEmailTriggerHealth(integrationMetadata);
  }, [canonicalProvider, integrationMetadata]);
  const uiContext = useMemo(
    () => ({
      externalAccountId: integration?.external_account_id ?? null,
      signedInUserEmail,
      integrationMetadata,
    }),
    [integration?.external_account_id, integrationMetadata, signedInUserEmail],
  );

  const workspaceProviderEnabled = canonicalProvider
    ? isWorkspaceProviderEnabled(selectedWorkspaceIntegrations, canonicalProvider)
    : false;

  const createTestAction = runtime.useMutation(
    makeFunctionReference<"mutation">("actions:createTestAction"),
  );
  const approveAction = runtime.useMutation(
    makeFunctionReference<"mutation">("actions:approveAction"),
  );
  const updateIntegrationMetadata = runtime.useMutation(
    makeFunctionReference<"mutation">("integrations:updateMetadata"),
  );

  const [actionId, setActionId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<UserFacingError | null>(null);
  const [selectedWriteTool, setSelectedWriteTool] = useState("");
  const [actionFormValues, setActionFormValues] = useState<Record<string, unknown>>({});
  const [metadataEditorValues, setMetadataEditorValues] = useState<
    Record<string, Record<string, unknown>>
  >({});

  const actionDetail = runtime.useQuery(
    makeFunctionReference<"query">("actions:getActionDetail"),
    actionId ? { actionId } : "skip",
  );

  useEffect(() => {
    if (!providerUi || !canonicalProvider) {
      setActionFormValues({});
      setMetadataEditorValues({});
      return;
    }

    const nextActionDefaults = getProviderUiDefaults(canonicalProvider, uiContext);
    setActionFormValues((previous) =>
      stableJson(previous) === stableJson(nextActionDefaults) ? previous : nextActionDefaults,
    );

    const editorDefaults: Record<string, Record<string, unknown>> = {};
    for (const editor of providerUi.metadataEditors) {
      editorDefaults[editor.id] = getProviderMetadataEditorDefaults(editor, uiContext);
    }
    setMetadataEditorValues((previous) =>
      stableJson(previous) === stableJson(editorDefaults) ? previous : editorDefaults,
    );
  }, [canonicalProvider, providerUi, uiContext]);

  useEffect(() => {
    if (!providerUi) {
      setSelectedWriteTool("");
      return;
    }

    if (providerUi.fixedToolName || writeTools.length === 0) {
      setSelectedWriteTool("");
      return;
    }

    setSelectedWriteTool((current) => {
      if (current && writeTools.some((tool) => tool.name === current)) {
        return current;
      }
      return writeTools[0]?.name ?? "";
    });
  }, [providerUi, writeTools]);

  useEffect(() => {
    if (!providerUi || providerUi.fixedToolName || !selectedWriteTool) {
      return;
    }

    setActionFormValues((previous) => ({
      ...previous,
      payload: toDefaultGenericInput(selectedWriteTool),
    }));
  }, [providerUi, selectedWriteTool]);

  useEffect(() => {
    if (!actionDetail?.action) {
      return;
    }

    if (!isKnownActionStatus(actionDetail.action.status)) {
      return;
    }

    const status = actionDetail.action.status;
    if (status === "succeeded") {
      setFeedbackError(null);
      setFeedback(`${providerLabel} action succeeded.`);
      return;
    }
    if (status === "failed") {
      setFeedbackError(null);
      setFeedback(`${providerLabel} action failed. Check result details for exact error.`);
      return;
    }
    if (status === "rejected") {
      setFeedbackError(null);
      setFeedback(`${providerLabel} action was rejected.`);
    }
  }, [actionDetail?.action?.status, providerLabel]);

  const actionStatus = isKnownActionStatus(actionDetail?.action?.status)
    ? actionDetail.action.status
    : null;
  const actionResult = actionDetail?.action.result_redacted;
  const actionPayloadPreview = actionDetail?.action.payload_preview;
  const actionStatusView = getActionStatusView(actionStatus);

  if (routeResolution.status !== "canonical") {
    return (
      <Empty className="rounded-xl border py-12">
        <EmptyHeader>
          <EmptyIllustration
            src="/illustrations/not-found.png"
            alt="Illustration for an unsupported integration route"
          />
          <EmptyTitle>Integration route not available</EmptyTitle>
          <EmptyDescription>
            {routeResolution.status === "non_canonical"
              ? `${capitalize(routeResolution.input)} is an alias. Open ${getProviderMeta(routeResolution.canonicalProviderId).label} instead so links stay stable.`
              : `${capitalize(routeResolution.input)} is not in the current provider catalog for this dashboard build.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to={buildWorkspacePath("/integrations")}>
            <Button variant="outline">Back to integrations</Button>
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  if (!integration || !providerUi) {
    return (
      <Empty className="rounded-xl border py-12">
        <EmptyHeader>
          <EmptyIllustration
            src="/illustrations/not-found.png"
            alt="Illustration for a missing integration"
          />
          <EmptyTitle>Integration not found</EmptyTitle>
          <EmptyDescription>
            Select a connected provider from the integrations page to inspect health, metadata, or
            test actions.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to={buildWorkspacePath("/integrations")}>
            <Button variant="outline">Back to integrations</Button>
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  const actionDisabledReason = !connected
    ? needsReconnect
      ? `${providerLabel} needs reconnect before test actions can run.`
      : `${providerLabel} is not connected.`
    : !workspaceProviderEnabled
      ? `${providerLabel} is disabled for the selected workspace.`
      : !hasWriteCapability
        ? `${providerLabel} does not expose write actions.`
        : !canApprove()
          ? "You do not have permission to run test actions."
          : null;

  const handleSubmit = async () => {
    if (!selectedWorkspaceId) {
      setFeedbackError(null);
      setFeedback("No workspace selected.");
      return;
    }
    if (actionDisabledReason) {
      setFeedbackError(null);
      setFeedback(actionDisabledReason);
      return;
    }

    let actionRequest: { toolName: string; input: Record<string, unknown> };

    try {
      actionRequest = providerUi.buildActionRequest(actionFormValues, {
        selectedWriteTool: selectedWriteTool || null,
        availableWriteTools: writeTools.map((tool) => tool.name),
      });
    } catch (error) {
      setFeedback(null);
      setFeedbackError(toUserFacingError(error, { fallback: "Invalid action input." }));
      return;
    }

    if (!writeTools.some((tool) => tool.name === actionRequest.toolName)) {
      setFeedbackError(null);
      setFeedback(`Tool ${actionRequest.toolName} is not available for ${providerLabel}.`);
      return;
    }

    setIsSubmitting(true);
    setFeedbackError(null);
    setFeedback("Creating test action...");
    try {
      const created = await createTestAction({
        workspaceId: selectedWorkspaceId,
        tool_name: actionRequest.toolName,
        input: actionRequest.input,
      });
      await approveAction({
        actionId: created.action_id,
        reason: `Manual test action from ${providerLabel} integration page`,
      });
      setActionId(created.action_id);
      setFeedback("Action created and approved. Waiting for execution...");
    } catch (error) {
      setFeedback(null);
      setFeedbackError(toUserFacingError(error, { fallback: "Failed to start test action." }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveMetadata = async (editor: ProviderMetadataEditorConfig) => {
    if (!canApprove()) {
      return;
    }
    if (!canonicalProvider) {
      return;
    }

    const values = metadataEditorValues[editor.id] ?? {};

    try {
      setFeedbackError(null);
      await updateIntegrationMetadata({
        provider: canonicalProvider,
        metadata: editor.buildMetadataPatch(values),
      });
      setFeedback(editor.successMessage);
    } catch (error) {
      setFeedback(null);
      setFeedbackError(
        toUserFacingError(error, {
          fallback: `Failed to save ${editor.title}.`,
        }),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{providerLabel} Integration</h1>
          <p className="text-muted-foreground">Open and run provider actions from here.</p>
        </div>
        <Link to={buildWorkspacePath("/integrations")}>
          <Button variant="outline">Back</Button>
        </Link>
      </div>

      <IntegrationDetailsHeader
        provider={providerLabel}
        connected={connected}
        needsReconnect={needsReconnect}
        externalAccountId={integration.external_account_id}
        scopes={integration.scopes}
        status={integration.status}
        expiresAt={integration.credential_expires_at}
        hasRefreshToken={integration.has_refresh_token ?? false}
        lastHealth={integration.last_health_check_at}
        lastHealthy={integration.last_successful_health_check_at}
        lastWebhook={integration.last_webhook_at}
        lastErrorCode={integration.last_error_code}
        lastErrorCategory={integration.last_error_category}
        degradedReason={integration.degraded_reason}
      />

      {canonicalProvider === GOOGLE_PROVIDER_ID && googleIncomingEmailHealth ? (
        <ProviderEventHealthCard health={googleIncomingEmailHealth} connected={connected} />
      ) : null}

      {providerDeprecation ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTitle>{`${providerLabel} is ${providerDeprecation.status}`}</AlertTitle>
          <AlertDescription>
            <p>{providerDeprecation.message}</p>
            {providerDeprecation.sunsetAt ? (
              <p>{`Sunset at ${providerDeprecation.sunsetAt}`}</p>
            ) : null}
            {providerDeprecation.replacementProvider ? (
              <p>{`Recommended replacement: ${providerDeprecation.replacementProvider}`}</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!workspaceProviderEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>{providerLabel} is not enabled for this workspace</CardTitle>
            <CardDescription>
              Turn on {providerLabel} in workspace settings before using provider-specific test
              actions or metadata controls from this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to={buildWorkspacePath("/workspaces")}>
              <Button variant="outline" size="sm">
                Open workspace settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {!connected ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Reconnect {providerLabel} to continue</CardTitle>
            <CardDescription>
              Keppo can show saved metadata here, but test actions stay disabled until the provider
              account is connected again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to={buildWorkspacePath("/integrations")}>
              <Button variant="outline" size="sm">
                Open integrations
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {feedbackError ? <UserFacingErrorView error={feedbackError} /> : null}

      {providerUi.metadataEditors.map((editor) => {
        const values = metadataEditorValues[editor.id] ?? {};

        return (
          <Card key={editor.id}>
            <CardHeader>
              <CardTitle>{editor.title}</CardTitle>
              <CardDescription>{editor.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {editor.fields.map((field) => {
                const fieldId = `${editor.id}-${field.id}-${normalizedProvider}`;
                const disabled = isSubmitting || !connected || !workspaceProviderEnabled;

                if (field.type === "checkboxes" && field.options) {
                  const checkboxMap =
                    values[field.id] &&
                    typeof values[field.id] === "object" &&
                    !Array.isArray(values[field.id])
                      ? (values[field.id] as Record<string, boolean>)
                      : {};

                  const setCheckboxValue = (optionValue: string, checked: boolean) => {
                    setMetadataEditorValues((previous) => {
                      const prevEditorValues = previous[editor.id] ?? {};
                      const prevCheckboxMap =
                        prevEditorValues[field.id] &&
                        typeof prevEditorValues[field.id] === "object" &&
                        !Array.isArray(prevEditorValues[field.id])
                          ? (prevEditorValues[field.id] as Record<string, boolean>)
                          : {};
                      return {
                        ...previous,
                        [editor.id]: {
                          ...prevEditorValues,
                          [field.id]: {
                            ...prevCheckboxMap,
                            [optionValue]: checked,
                          },
                        },
                      };
                    });
                  };

                  const setAllCheckboxes = (checked: boolean) => {
                    const nextMap = Object.fromEntries(
                      (field.options ?? []).map((opt) => [opt.value, checked]),
                    );
                    setMetadataEditorValues((previous) => ({
                      ...previous,
                      [editor.id]: {
                        ...previous[editor.id],
                        [field.id]: nextMap,
                      },
                    }));
                  };

                  return (
                    <div key={field.id} className="grid gap-2">
                      <Label>{field.label}</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-xs"
                          disabled={disabled}
                          onClick={() => setAllCheckboxes(true)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-xs"
                          disabled={disabled}
                          onClick={() => setAllCheckboxes(false)}
                        >
                          Select none
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {field.options.map((option) => {
                          const optionId = `${fieldId}-${option.value}`;
                          return (
                            <label
                              key={option.value}
                              htmlFor={optionId}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Checkbox
                                id={optionId}
                                checked={checkboxMap[option.value] === true}
                                onCheckedChange={(checked) =>
                                  setCheckboxValue(option.value, checked === true)
                                }
                                disabled={disabled}
                              />
                              {option.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const value = getFieldValue(values, field);

                return (
                  <div key={field.id} className="grid gap-2">
                    <Label htmlFor={fieldId}>{field.label}</Label>
                    {field.type === "textarea" || field.type === "json" ? (
                      <Textarea
                        id={fieldId}
                        value={value}
                        onChange={(event) => {
                          setMetadataEditorValues((previous) => ({
                            ...previous,
                            [editor.id]: setFieldValue(
                              previous[editor.id] ?? {},
                              field.id,
                              event.target.value,
                            ),
                          }));
                        }}
                        rows={field.type === "json" ? 8 : 4}
                        className={field.type === "json" ? "font-mono" : undefined}
                        placeholder={field.placeholder}
                        disabled={disabled}
                      />
                    ) : (
                      <Input
                        id={fieldId}
                        type={getFieldInputType(field)}
                        value={value}
                        onChange={(event) => {
                          setMetadataEditorValues((previous) => ({
                            ...previous,
                            [editor.id]: setFieldValue(
                              previous[editor.id] ?? {},
                              field.id,
                              event.target.value,
                            ),
                          }));
                        }}
                        placeholder={field.placeholder}
                        required={field.required}
                        disabled={disabled}
                      />
                    )}
                  </div>
                );
              })}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSaveMetadata(editor)}
                  disabled={
                    isSubmitting || !connected || !workspaceProviderEnabled || !canApprove()
                  }
                >
                  {editor.submitLabel}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {hasWriteCapability ? (
        <Card>
          <CardHeader>
            <CardTitle>{providerUi.panelTitle}</CardTitle>
            <CardDescription>{providerUi.panelDescription}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!providerUi.fixedToolName ? (
              <div className="grid gap-2">
                <Label htmlFor="provider-write-tool">Write tool</Label>
                <select
                  id="provider-write-tool"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={selectedWriteTool}
                  onChange={(event) => setSelectedWriteTool(event.target.value)}
                  disabled={isSubmitting || !connected || !workspaceProviderEnabled}
                >
                  {writeTools.map((tool) => (
                    <option key={tool.name} value={tool.name}>
                      {tool.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {providerUi.fields.map((field) => {
              const fieldId = `${normalizedProvider}-${field.id}`;
              const value = getFieldValue(actionFormValues, field);
              const disabled = isSubmitting || !connected || !workspaceProviderEnabled;

              return (
                <div key={field.id} className="grid gap-2">
                  <Label htmlFor={fieldId}>{field.label}</Label>
                  {field.type === "textarea" || field.type === "json" ? (
                    <Textarea
                      id={fieldId}
                      value={value}
                      onChange={(event) => {
                        setActionFormValues((previous) =>
                          setFieldValue(previous, field.id, event.target.value),
                        );
                      }}
                      rows={field.type === "json" ? 10 : 6}
                      className={field.type === "json" ? "font-mono" : undefined}
                      placeholder={field.placeholder}
                      disabled={disabled}
                    />
                  ) : (
                    <Input
                      id={fieldId}
                      type={getFieldInputType(field)}
                      value={value}
                      onChange={(event) => {
                        setActionFormValues((previous) =>
                          setFieldValue(previous, field.id, event.target.value),
                        );
                      }}
                      placeholder={field.placeholder}
                      required={field.required}
                      disabled={disabled}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Provider test actions</CardTitle>
            <CardDescription>
              {providerLabel} has no write-capable tools in the provider catalog, so write actions
              are unavailable.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          <Button
            onClick={() => void handleSubmit()}
            disabled={Boolean(actionDisabledReason) || isSubmitting}
          >
            {isSubmitting ? "Running..." : "Run test action"}
          </Button>
          <Badge variant={actionStatusView.badgeVariant}>{actionStatusView.label}</Badge>
          {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
          {!feedback && !feedbackError && actionDisabledReason ? (
            <p className="text-sm text-muted-foreground">{actionDisabledReason}</p>
          ) : null}
        </CardContent>
      </Card>

      {actionId ? (
        <Card>
          <CardHeader>
            <CardTitle>Latest action</CardTitle>
            <CardDescription>Action ID: {actionId}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {actionPayloadPreview ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">Payload preview</p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(actionPayloadPreview, null, 2)}
                </pre>
              </div>
            ) : null}
            {actionResult ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">Execution result</p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(actionResult, null, 2)}
                </pre>
              </div>
            ) : null}
            {!actionDetail ? (
              <p className="text-sm text-muted-foreground">
                Waiting for action execution status...
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export { IntegrationDetailPage };
