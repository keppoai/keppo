import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG } from "@keppo/shared/feature-flags";
import {
  completeOpenAiOauth,
  getOpenAiConnectMetadata,
  startBillingCreditsCheckout,
} from "@/lib/server-functions/internal-api";
import { buildBillingReturnUrl } from "@/lib/billing-redirects";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { useGlobalFeatureFlag } from "@/hooks/use-feature-flags";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { parseAiCreditBalance, parseOrgAiKeys, type OrgAiKey } from "@/lib/automations-view-model";
import { fullTimestamp } from "@/lib/format";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

type AiKeyManagerProps = {
  orgId: string | null;
  userEmail: string | null;
};

type CreditPurchase = {
  id: string;
  credits: number;
  credits_remaining: number;
  purchased_at: string;
  expires_at: string;
  status: "active" | "expired" | "depleted";
};

type AutomationKeyUsage = {
  provider: "openai" | "anthropic";
  key_mode: "byok" | "bundled" | "subscription_token";
  count: number;
};

type OpenAiConnectMetadata = {
  oauth_start_url: string;
  localhost_callback_command: string;
  localhost_redirect_uri: string;
};

const parseCreditPurchases = (value: unknown): CreditPurchase[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const status = row.status;
      if (status !== "active" && status !== "expired" && status !== "depleted") {
        return null;
      }
      return {
        id: typeof row.id === "string" ? row.id : "",
        credits: typeof row.credits === "number" ? row.credits : 0,
        credits_remaining: typeof row.credits_remaining === "number" ? row.credits_remaining : 0,
        purchased_at: typeof row.purchased_at === "string" ? row.purchased_at : "",
        expires_at: typeof row.expires_at === "string" ? row.expires_at : "",
        status,
      };
    })
    .filter((purchase): purchase is CreditPurchase => purchase !== null);
};

const parseUsage = (value: unknown): AutomationKeyUsage[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const provider = row.provider;
      const keyMode = row.key_mode;
      if (
        (provider !== "openai" && provider !== "anthropic") ||
        (keyMode !== "byok" && keyMode !== "bundled" && keyMode !== "subscription_token")
      ) {
        return null;
      }
      return {
        provider,
        key_mode: keyMode,
        count: typeof row.count === "number" ? row.count : 0,
      };
    })
    .filter((entry): entry is AutomationKeyUsage => entry !== null);
};

const parseOpenAiConnectMetadata = (value: unknown): OpenAiConnectMetadata => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid OpenAI connect response.");
  }
  const record = value as Record<string, unknown>;
  const oauthStartUrl = typeof record.oauth_start_url === "string" ? record.oauth_start_url : "";
  const localhostCallbackCommand =
    typeof record.localhost_callback_command === "string" ? record.localhost_callback_command : "";
  const localhostRedirectUri =
    typeof record.localhost_redirect_uri === "string" ? record.localhost_redirect_uri : "";

  if (!oauthStartUrl || !localhostCallbackCommand || !localhostRedirectUri) {
    throw new Error("OpenAI connect response is missing required launch metadata.");
  }

  return {
    oauth_start_url: oauthStartUrl,
    localhost_callback_command: localhostCallbackCommand,
    localhost_redirect_uri: localhostRedirectUri,
  };
};

const sortOrgAiKeys = (keys: OrgAiKey[]): OrgAiKey[] =>
  [...keys].sort((left, right) => right.updated_at.localeCompare(left.updated_at));

const formatKeyModeLabel = (
  keyMode: OrgAiKey["key_mode"] | AutomationKeyUsage["key_mode"],
): string => {
  switch (keyMode) {
    case "bundled":
      return "Bundled";
    case "subscription_token":
      return "Subscription login (legacy)";
    default:
      return "Bring your own key";
  }
};

const applyLocalKeyUpsert = (keys: OrgAiKey[], nextKey: OrgAiKey): OrgAiKey[] =>
  sortOrgAiKeys([
    nextKey,
    ...keys
      .filter((key) => key.id !== nextKey.id)
      .map((key) =>
        key.provider === nextKey.provider &&
        key.key_mode === nextKey.key_mode &&
        key.is_active &&
        nextKey.is_active
          ? {
              ...key,
              is_active: false,
              updated_at: nextKey.updated_at,
            }
          : key,
      ),
  ]);

const applyLocalKeyDelete = (keys: OrgAiKey[], keyId: string): OrgAiKey[] =>
  sortOrgAiKeys(keys.filter((key) => key.id !== keyId));

const hasServerCaughtUp = (serverKeys: OrgAiKey[], optimisticKeys: OrgAiKey[]): boolean => {
  const serverKeyById = new Map(serverKeys.map((key) => [key.id, key]));
  return optimisticKeys.every((optimisticKey) => {
    const serverKey = serverKeyById.get(optimisticKey.id);
    return (
      serverKey &&
      serverKey.updated_at >= optimisticKey.updated_at &&
      serverKey.is_active === optimisticKey.is_active &&
      serverKey.key_version >= optimisticKey.key_version &&
      serverKey.key_hint === optimisticKey.key_hint
    );
  });
};

export function AiKeyManager({ orgId, userEmail }: AiKeyManagerProps) {
  const runtime = useDashboardRuntime();
  const subscriptionAuthEnabled = useGlobalFeatureFlag(AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG);
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [keyMode, setKeyMode] = useState<"byok" | "subscription_token">("byok");
  const [rawKey, setRawKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isBuying, setIsBuying] = useState<number | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [isPreparingOpenAiConnect, setIsPreparingOpenAiConnect] = useState(false);
  const [openAiConnectMetadata, setOpenAiConnectMetadata] = useState<OpenAiConnectMetadata | null>(
    null,
  );
  const [openAiOauthCallbackUrl, setOpenAiOauthCallbackUrl] = useState("");
  const [isCompletingOpenAiOauth, setIsCompletingOpenAiOauth] = useState(false);
  const [copiedCallbackCommand, setCopiedCallbackCommand] = useState(false);
  const [optimisticKeys, setOptimisticKeys] = useState<OrgAiKey[] | null>(null);

  const keysRaw = useQuery(
    makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
    orgId ? { org_id: orgId } : "skip",
  );
  const creditsRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    orgId ? { org_id: orgId } : "skip",
  );
  const purchasesRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:listAiCreditPurchases"),
    orgId ? { org_id: orgId } : "skip",
  );
  const usageRaw = useQuery(
    makeFunctionReference<"query">("automations:listOrgAutomationKeyUsage"),
    orgId ? { org_id: orgId } : "skip",
  );

  const upsertMutation = useMutation(
    makeFunctionReference<"mutation">("org_ai_keys:upsertOrgAiKey"),
  );
  const deleteMutation = useMutation(
    makeFunctionReference<"mutation">("org_ai_keys:deleteOrgAiKey"),
  );

  const serverKeys = useMemo(() => parseOrgAiKeys(keysRaw), [keysRaw]);
  const keys = optimisticKeys ?? serverKeys;
  const balance = useMemo(() => parseAiCreditBalance(creditsRaw), [creditsRaw]);
  const purchases = useMemo(() => parseCreditPurchases(purchasesRaw), [purchasesRaw]);
  const usage = useMemo(() => parseUsage(usageRaw), [usageRaw]);
  const needsOpenAiOauth = provider === "openai" && keyMode === "subscription_token";
  const showLegacySubscriptionMode = keyMode === "subscription_token" && !subscriptionAuthEnabled;
  const bundledKeyRows = useMemo(
    () => keys.filter((key) => key.key_mode === "bundled" && key.is_active),
    [keys],
  );
  const bundledRuntimeAvailable = balance?.bundled_runtime_enabled ?? false;
  const activeOpenAiOauthKey = useMemo(
    () =>
      keys.find(
        (key) =>
          key.provider === "openai" &&
          key.key_mode === "subscription_token" &&
          key.credential_kind === "openai_oauth" &&
          key.is_active,
      ) ?? null,
    [keys],
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("ai_key_status");
    const providerParam = url.searchParams.get("ai_key_provider");
    if (providerParam !== "openai" || !status) {
      return;
    }
    if (status === "connected") {
      setError(null);
      setOpenAiConnectMetadata(null);
    } else if (status === "error") {
      setError(
        toUserFacingError(
          new Error(url.searchParams.get("ai_key_error") ?? "OpenAI OAuth connection failed."),
          {
            fallback: "OpenAI OAuth connection failed.",
          },
        ),
      );
    }
    url.searchParams.delete("ai_key_status");
    url.searchParams.delete("ai_key_provider");
    url.searchParams.delete("ai_key_mode");
    url.searchParams.delete("ai_key_error");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (!activeOpenAiOauthKey) {
      return;
    }
    setOpenAiConnectMetadata(null);
    setOpenAiOauthCallbackUrl("");
    setError(null);
  }, [activeOpenAiOauthKey]);

  useEffect(() => {
    if (!optimisticKeys || !hasServerCaughtUp(serverKeys, optimisticKeys)) {
      return;
    }
    setOptimisticKeys(null);
  }, [optimisticKeys, serverKeys]);

  useEffect(() => {
    if (!optimisticKeys) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setOptimisticKeys(null);
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [optimisticKeys]);

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Keys and Credits</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Organization context is unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const savedKey = await upsertMutation({
        org_id: orgId,
        provider,
        key_mode: keyMode,
        raw_key: rawKey,
      });
      setOptimisticKeys((currentKeys) => applyLocalKeyUpsert(currentKeys ?? serverKeys, savedKey));
      setRawKey("");
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to save key." }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    setError(null);
    try {
      await deleteMutation({ key_id: keyId });
      setOptimisticKeys((currentKeys) => applyLocalKeyDelete(currentKeys ?? serverKeys, keyId));
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to remove key." }));
    }
  };

  const handleBuyCredits = async (packageIndex: number) => {
    setError(null);
    setIsBuying(packageIndex);
    try {
      const successUrl = buildBillingReturnUrl(window.location.href, "creditCheckout", "success");
      const cancelUrl = buildBillingReturnUrl(window.location.href, "creditCheckout", "cancel");
      const result = await startBillingCreditsCheckout({
        orgId,
        packageIndex,
        customerEmail: userEmail ?? undefined,
        successUrl,
        cancelUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const record = result as Record<string, unknown>;
      const checkoutUrl = typeof record.checkout_url === "string" ? record.checkout_url : "";
      if (!checkoutUrl) {
        throw new Error("Missing checkout URL from API response.");
      }
      window.location.assign(checkoutUrl);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to start credit checkout.",
        }),
      );
    } finally {
      setIsBuying(null);
    }
  };

  const handlePrepareOpenAiConnect = async () => {
    const returnTo = `${window.location.pathname}${window.location.search || ""}`;
    setError(null);
    setIsPreparingOpenAiConnect(true);
    try {
      const metadata = parseOpenAiConnectMetadata(
        await getOpenAiConnectMetadata({
          return_to: returnTo || "/settings",
          betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
        }),
      );
      setOpenAiConnectMetadata(metadata);
      window.open(metadata.oauth_start_url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to start OpenAI OAuth.",
        }),
      );
    } finally {
      setIsPreparingOpenAiConnect(false);
    }
  };

  const handleCompleteOpenAi = async () => {
    setError(null);
    setIsCompletingOpenAiOauth(true);
    try {
      await completeOpenAiOauth({
        callback_url: openAiOauthCallbackUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      setOpenAiOauthCallbackUrl("");
      setOpenAiConnectMetadata(null);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to complete OpenAI OAuth.",
        }),
      );
    } finally {
      setIsCompletingOpenAiOauth(false);
    }
  };

  const handleCopyOpenAiCallbackCommand = async () => {
    if (!openAiConnectMetadata) {
      return;
    }
    try {
      await navigator.clipboard.writeText(openAiConnectMetadata.localhost_callback_command);
      setCopiedCallbackCommand(true);
      window.setTimeout(() => setCopiedCallbackCommand(false), 1500);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to copy callback command.",
        }),
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>
            Manage bundled access, BYO keys, and legacy subscription login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_20rem]">
            <div className="rounded-2xl border p-5">
              <div className="space-y-1">
                <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Step 1
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-foreground">
                    Choose how this org authenticates AI runs
                  </p>
                  <Badge variant={bundledRuntimeAvailable ? "outline" : "secondary"}>
                    {bundledRuntimeAvailable ? "Bundled available" : "Paid plans only"}
                  </Badge>
                </div>
                <p className="max-w-3xl text-sm leading-6 text-foreground/75">
                  {bundledRuntimeAvailable
                    ? "Paid plans can run automations with Keppo-managed gateway credentials. Add a BYO key here only if you want a fallback path when bundled credits run out."
                    : "Free trial keeps a one-time 20-credit grant for prompt generation only. Add your own API key for runtime, or upgrade to Starter or Pro to unlock bundled execution."}
                </p>
              </div>

              <div className="mt-4 rounded-xl border bg-muted/30 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">Bundled runtime</p>
                  <span className="text-muted-foreground text-xs">Billing-managed credentials</span>
                </div>
                <p className="mt-2 text-foreground/75">
                  {bundledRuntimeAvailable
                    ? "Keppo provisions and rotates bundled gateway credentials automatically. You do not edit bundled keys here."
                    : "Bundled execution is locked on free. This settings form manages BYO and legacy subscription credentials until the org upgrades."}
                </p>
                <p className="mt-2 text-xs text-foreground/65">
                  {bundledKeyRows.length > 0
                    ? `Billing currently manages ${bundledKeyRows.length} active bundled credential${bundledKeyRows.length === 1 ? "" : "s"} for this org.`
                    : bundledRuntimeAvailable
                      ? "Billing reconciliation provisions bundled credentials automatically when the org is eligible."
                      : "Upgrade to Starter or Pro to unlock billing-managed bundled credentials."}
                </p>
              </div>

              <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
                <div className="space-y-1">
                  <Label htmlFor="ai-key-provider">Provider</Label>
                  <NativeSelect
                    className="w-full"
                    id="ai-key-provider"
                    value={provider}
                    onChange={(event) =>
                      setProvider(
                        event.currentTarget.value === "anthropic" ? "anthropic" : "openai",
                      )
                    }
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-key-mode">Mode</Label>
                  <NativeSelect
                    className="w-full"
                    id="ai-key-mode"
                    value={keyMode}
                    onChange={(event) =>
                      setKeyMode(
                        event.currentTarget.value === "subscription_token"
                          ? "subscription_token"
                          : "byok",
                      )
                    }
                  >
                    <option value="byok">Bring your own key</option>
                    {subscriptionAuthEnabled ? (
                      <option value="subscription_token">Subscription login (legacy)</option>
                    ) : null}
                    {showLegacySubscriptionMode ? (
                      <option value="subscription_token">Subscription login (disabled)</option>
                    ) : null}
                  </NativeSelect>
                </div>
                <div className="rounded-lg border bg-background/80 p-3 text-xs leading-5 text-foreground/70 md:col-span-2">
                  Bundled credentials are billing-managed. Use this form only for org-managed keys
                  or legacy OpenAI subscription login when bundled runtime is unavailable.
                </div>
                {needsOpenAiOauth ? (
                  <div className="space-y-3 md:col-span-2">
                    <Label>OpenAI Subscription</Label>
                    <div className="space-y-4 rounded-2xl border border-primary/20 bg-[linear-gradient(180deg,rgba(95,140,90,0.14),rgba(95,140,90,0.03))] p-5 text-sm shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="secondary">Recommended</Badge>
                            <span className="rounded-full border border-primary/20 bg-background/85 px-2.5 py-1 font-medium text-foreground">
                              Helper-first ChatGPT connection
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-lg font-semibold tracking-tight">
                              Connect OpenAI from ChatGPT using the localhost callback flow.
                            </p>
                            <p className="max-w-3xl text-[13px] leading-6 text-foreground/80">
                              Keppo prepares a signed OpenAI auth URL for{" "}
                              <span className="font-mono text-xs">127.0.0.1:1455</span>. Run the
                              local callback listener, finish the browser login, then paste the
                              final localhost callback URL here so Keppo can store the refreshable
                              OAuth credential server-side.
                            </p>
                          </div>
                        </div>
                        <div className="min-w-44 rounded-xl border border-primary/15 bg-background/85 p-3 text-xs">
                          <p className="font-medium text-foreground">What happens next</p>
                          <ol className="mt-2 space-y-1.5 text-foreground/75">
                            <li>1. Prepare the OpenAI connect flow.</li>
                            <li>2. Run the localhost callback command in a terminal.</li>
                            <li>
                              3. Finish ChatGPT sign-in in your browser and paste the callback URL.
                            </li>
                          </ol>
                        </div>
                      </div>

                      <div className="grid gap-3 rounded-xl border border-primary/15 bg-background/85 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            Prepare the direct OAuth flow
                          </p>
                          <p className="text-[13px] leading-6 text-foreground/75">
                            This opens the ChatGPT authorization page in a new tab and reveals the
                            callback command plus the localhost redirect target Keppo expects.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="lg"
                            onClick={() => {
                              void handlePrepareOpenAiConnect();
                            }}
                            disabled={isPreparingOpenAiConnect}
                          >
                            {isPreparingOpenAiConnect
                              ? "Preparing..."
                              : openAiConnectMetadata
                                ? "Open ChatGPT Again"
                                : "Prepare and Open ChatGPT"}
                          </Button>
                        </div>
                      </div>

                      {openAiConnectMetadata ? (
                        <div className="grid gap-3 rounded-xl border border-border/80 bg-background/75 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div className="space-y-2">
                            <p className="font-medium text-foreground">
                              OpenAI connect metadata is ready
                            </p>
                            <p className="text-[13px] leading-6 text-foreground/75">
                              Use this signed browser URL with the localhost callback listener
                              running on your machine. The final pasted callback URL must resolve to
                              the redirect URI below.
                            </p>
                            <div className="space-y-1 text-xs text-foreground/65">
                              <p className="break-all">
                                Redirect URI: {openAiConnectMetadata.localhost_redirect_uri}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                window.open(
                                  openAiConnectMetadata.oauth_start_url,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }}
                            >
                              Open ChatGPT Login
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-3 rounded-md border border-dashed p-3 text-sm">
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium">1. Run the localhost callback command</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                void handleCopyOpenAiCallbackCommand();
                              }}
                              disabled={!openAiConnectMetadata}
                            >
                              {copiedCallbackCommand ? "Copied" : "Copy Command"}
                            </Button>
                          </div>
                          <p className="text-muted-foreground mt-1">
                            Run this in another terminal before finishing the browser auth flow.
                          </p>
                          <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted px-3 py-2 text-xs">
                            <code>
                              {openAiConnectMetadata?.localhost_callback_command ??
                                "Prepare the connection first to get the localhost callback command."}
                            </code>
                          </pre>
                        </div>
                        <div>
                          <p className="font-medium">2. Open the ChatGPT auth URL</p>
                          {openAiConnectMetadata ? (
                            <a
                              className="text-primary mt-1 block break-all underline-offset-4 hover:underline"
                              href={openAiConnectMetadata.oauth_start_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {openAiConnectMetadata.oauth_start_url}
                            </a>
                          ) : (
                            <p className="text-muted-foreground mt-1">
                              Prepare the connection first to get the signed ChatGPT auth URL.
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="openai-callback-url">
                            3. Paste the final localhost callback URL
                          </Label>
                          <Textarea
                            id="openai-callback-url"
                            className="min-h-24 font-mono text-xs"
                            value={openAiOauthCallbackUrl}
                            onChange={(event) =>
                              setOpenAiOauthCallbackUrl(event.currentTarget.value)
                            }
                            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                          />
                          <Button
                            type="button"
                            disabled={
                              isCompletingOpenAiOauth ||
                              openAiOauthCallbackUrl.trim().length === 0 ||
                              !openAiConnectMetadata
                            }
                            onClick={() => {
                              void handleCompleteOpenAi();
                            }}
                          >
                            {isCompletingOpenAiOauth ? "Completing..." : "Complete Connection"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <Label htmlFor="ai-raw-key">API key</Label>
                      <Input
                        id="ai-raw-key"
                        type="password"
                        value={rawKey}
                        onChange={(event) => setRawKey(event.currentTarget.value)}
                        placeholder="Paste API key"
                        required
                      />
                      <p className="text-muted-foreground text-xs">
                        Used only for BYO runs or as fallback when bundled runtime is unavailable.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
                      <p className="text-muted-foreground text-xs leading-5">
                        Add a BYO key only if you want a fallback path outside bundled access.
                      </p>
                      <Button
                        type="submit"
                        size="lg"
                        className="w-full md:w-auto"
                        disabled={isSaving}
                      >
                        {isSaving ? "Saving..." : "Save Key"}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border bg-card p-4">
                <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Current credit pool
                </p>
                <div className="mt-3 space-y-1">
                  <div>
                    <p className="text-2xl font-semibold tracking-tight text-foreground">
                      {balance ? balance.total_available : "-"}
                    </p>
                    <p className="text-muted-foreground text-sm">credits available now</p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {bundledRuntimeAvailable ? "Bundled runtime enabled" : "Generation only"}
                  </p>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Included credits</dt>
                    <dd className="font-medium text-foreground">
                      {balance
                        ? `${balance.allowance_used} / ${balance.allowance_total} used`
                        : "-"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Purchased credits</dt>
                    <dd className="font-medium text-foreground">
                      {balance ? `${balance.purchased_remaining} remaining` : "-"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl bg-muted/20 p-4 text-sm">
                <p className="font-medium text-foreground">What this means</p>
                <p className="mt-2 text-foreground/75">
                  {bundledRuntimeAvailable
                    ? "Bundled runs spend from this shared credit pool."
                    : "Free trial credits cover prompt generation only. Upgrade to Starter or Pro for bundled runtime."}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {keys.length === 0 ? (
              needsOpenAiOauth ? (
                <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">
                      Waiting for your first OpenAI connection
                    </p>
                    <p className="max-w-2xl text-[13px] leading-6 text-foreground/75">
                      Start the helper flow above. After you finish ChatGPT sign-in, this section
                      will switch from setup guidance to an active credential record with validation
                      and expiry details.
                    </p>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                    <div className="rounded-lg border bg-background/80 p-3">
                      <p className="font-medium text-foreground">Launch helper</p>
                      <p className="mt-1 text-foreground/65">
                        Keppo prepares a short-lived handoff for the desktop app.
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background/80 p-3">
                      <p className="font-medium text-foreground">Approve in ChatGPT</p>
                      <p className="mt-1 text-foreground/65">
                        The helper listens on localhost and captures the callback automatically.
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background/80 p-3">
                      <p className="font-medium text-foreground">Return connected</p>
                      <p className="mt-1 text-foreground/65">
                        Keppo refreshes the credential server-side and shows the active key here.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No BYO or legacy subscription credentials configured yet.
                </p>
              )
            ) : (
              keys.map((key) => (
                <div
                  key={key.id}
                  data-testid="ai-key-row"
                  data-ai-key-id={key.id}
                  data-ai-key-provider={key.provider}
                  data-ai-key-mode={key.key_mode}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={key.is_active ? "default" : "outline"}>
                        {key.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <span className="font-medium capitalize">{key.provider}</span>
                      <span className="text-muted-foreground text-sm">
                        {formatKeyModeLabel(key.key_mode)}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {key.key_hint}
                      {key.last_validated_at
                        ? ` · Validated ${fullTimestamp(key.last_validated_at)}`
                        : ""}
                      {key.token_expires_at
                        ? ` · Expires ${fullTimestamp(key.token_expires_at)}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleDelete(key.id);
                    }}
                    disabled={!key.is_active || key.key_mode === "bundled"}
                  >
                    {key.key_mode === "bundled" ? "Billing-managed" : "Remove"}
                  </Button>
                </div>
              ))
            )}
          </div>

          {usage.length > 0 ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-2 font-medium">Automation key mode usage</p>
              <ul className="space-y-1">
                {usage.map((entry) => (
                  <li key={`${entry.provider}:${entry.key_mode}`}>
                    <span className="capitalize">{entry.provider}</span> /{" "}
                    {formatKeyModeLabel(entry.key_mode)}: {entry.count} automation
                    {entry.count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Credits</CardTitle>
          <CardDescription>Monthly allowance plus purchased credit packs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Allowance</dt>
            <dd>{balance ? `${balance.allowance_used} / ${balance.allowance_total} used` : "-"}</dd>
            <dt className="text-muted-foreground">Purchased</dt>
            <dd>{balance ? `${balance.purchased_remaining} credits remaining` : "-"}</dd>
            <dt className="text-muted-foreground">Total available</dt>
            <dd>{balance ? balance.total_available : "-"}</dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void handleBuyCredits(0);
              }}
              disabled={isBuying !== null}
            >
              {isBuying === 0 ? "Opening..." : "Buy 100 credits ($10)"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void handleBuyCredits(1);
              }}
              disabled={isBuying !== null}
            >
              {isBuying === 1 ? "Opening..." : "Buy 250 credits ($25)"}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Purchase history</p>
            {purchases.length === 0 ? (
              <p className="text-muted-foreground text-sm">No purchases recorded.</p>
            ) : (
              purchases.map((purchase) => (
                <div key={purchase.id} className="rounded border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={purchase.status === "active" ? "default" : "outline"}>
                      {purchase.status}
                    </Badge>
                    <span>
                      {purchase.credits_remaining} / {purchase.credits} credits remaining
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    Purchased: {fullTimestamp(purchase.purchased_at)} · Expires:{" "}
                    {fullTimestamp(purchase.expires_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {error ? <UserFacingErrorView error={error} /> : null}
    </div>
  );
}
