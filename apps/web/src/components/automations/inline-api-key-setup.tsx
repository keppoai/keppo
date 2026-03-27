import { useState } from "react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { CheckCircle2Icon, KeyRoundIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

type InlineApiKeySetupProps = {
  orgId: string;
  onKeyConfigured?: () => void;
};

export function InlineApiKeySetup({ orgId, onKeyConfigured }: InlineApiKeySetupProps) {
  const upsertOrgAiKey = useMutation(
    makeFunctionReference<"mutation">("org_ai_keys:upsertOrgAiKey"),
  );
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [rawKey, setRawKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedProvider, setSavedProvider] = useState<"openai" | "anthropic" | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  const providerDashboardHref =
    provider === "anthropic"
      ? "https://console.anthropic.com/settings/keys"
      : "https://platform.openai.com/api-keys";
  const providerDashboardLabel = provider === "anthropic" ? "Anthropic Console" : "OpenAI Platform";

  const handleSave = async () => {
    if (!rawKey.trim()) {
      setError(
        toUserFacingError(new Error("Enter an API key before saving."), {
          fallback: "Enter an API key before saving.",
        }),
      );
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await upsertOrgAiKey({
        org_id: orgId,
        provider,
        key_mode: "byok",
        raw_key: rawKey.trim(),
      });
      setRawKey("");
      setSavedProvider(provider);
      onKeyConfigured?.();
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to save API key." }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-primary/15 bg-primary/5 p-5">
      <Alert variant="warning">
        <KeyRoundIcon className="size-4" />
        <AlertTitle>You need to add your own API key to run automations.</AlertTitle>
        <AlertDescription>
          Free workspaces need a provider key before Keppo can run automation prompts.
        </AlertDescription>
      </Alert>

      {savedProvider ? (
        <Alert>
          <CheckCircle2Icon className="size-4" />
          <AlertTitle>
            {savedProvider === "anthropic" ? "Anthropic" : "OpenAI"} key saved
          </AlertTitle>
          <AlertDescription>
            This organization can now use that key for automation runs.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="inline-api-key-provider">Provider</Label>
          <NativeSelect
            id="inline-api-key-provider"
            value={provider}
            onChange={(event) =>
              setProvider(event.currentTarget.value === "anthropic" ? "anthropic" : "openai")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inline-api-key-input">API key</Label>
          <Input
            id="inline-api-key-input"
            type="password"
            value={rawKey}
            onChange={(event) => setRawKey(event.currentTarget.value)}
            placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
          />
          <p className="text-sm text-muted-foreground">
            Get your API key from{" "}
            <a
              href={providerDashboardHref}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-4"
            >
              {providerDashboardLabel}
            </a>
            .
          </p>
        </div>
        <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save key"}
        </Button>
      </div>

      {error ? <UserFacingErrorView error={error} variant="compact" /> : null}
    </div>
  );
}
