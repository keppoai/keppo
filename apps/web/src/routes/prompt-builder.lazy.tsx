import { promptBuilderRoute } from "./prompt-builder";
import { useMemo, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import type { ProviderCatalogEntry } from "@/lib/types";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export const promptBuilderRouteLazy = createLazyRoute(promptBuilderRoute.id)({
  component: PromptBuilderPage,
});

function PromptBuilderPage() {
  const { selectedWorkspace, selectedWorkspaceIntegrations } = useWorkspace();
  const [prompt, setPrompt] = useState("");
  const providerCatalogRaw = useQuery(
    makeFunctionReference<"query">("integrations:providerCatalog"),
    {},
  );
  const providers = useMemo<ProviderCatalogEntry[]>(() => {
    return parseProviderCatalogPayload(providerCatalogRaw ?? []);
  }, [providerCatalogRaw]);

  const enabledProviders = useMemo(() => {
    const rows = selectedWorkspaceIntegrations
      .filter((row) => row.enabled)
      .map((row) => row.provider);
    if (rows.length === 0) {
      return new Set(providers.map((entry) => entry.provider));
    }
    return new Set(rows);
  }, [selectedWorkspaceIntegrations, providers]);

  const exposedTools = useMemo(() => {
    return providers
      .filter((provider) => enabledProviders.has(provider.provider))
      .flatMap((provider) => provider.supported_tools);
  }, [providers, enabledProviders]);

  const tagMatches = useMemo(() => {
    const matches = [...prompt.matchAll(/@([a-z]+\.[a-zA-Z0-9_]+)/g)].map((entry) => entry[1]!);
    return [...new Set(matches)];
  }, [prompt]);

  const taggedTools = useMemo(() => {
    const byName = new Map(exposedTools.map((tool) => [tool.name, tool]));
    return tagMatches.map((name) => byName.get(name)).filter((value) => value != null);
  }, [tagMatches, exposedTools]);

  const systemPrompt = useMemo(() => {
    const exposedNames = exposedTools.map((tool) => tool.name);
    return [
      "You are operating within Keppo.",
      `Workspace: ${selectedWorkspace?.name ?? "unknown"}`,
      `Allowed tools: ${exposedNames.join(", ")}`,
      "Use tools only when required and respect approval-required responses.",
      "",
      "Task prompt:",
      prompt || "<empty>",
    ].join("\n");
  }, [selectedWorkspace, exposedTools, prompt]);

  const downloadText = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const insertToolTag = (toolName: string) => {
    setPrompt((prev) => `${prev}${prev.endsWith(" ") || prev.length === 0 ? "" : " "}@${toolName}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Builder</h1>
        <p className="text-muted-foreground">
          Tag tools with @tool.name and export system prompts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prompt Input</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            placeholder="Draft your system prompt here. Example: Use @gmail.searchUnread before replying."
            className="min-h-40"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <div className="flex flex-wrap gap-2">
            {taggedTools.map((tool) => (
              <Badge
                key={tool!.name}
                variant={
                  tool!.risk_level === "high" || tool!.risk_level === "critical"
                    ? "destructive"
                    : "secondary"
                }
              >
                @{tool!.name} ({tool!.risk_level})
              </Badge>
            ))}
            {taggedTools.length === 0 && (
              <span className="text-xs text-muted-foreground">No tagged tools yet.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadText("keppo-system-prompt.txt", systemPrompt)}
            >
              Export System Prompt
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exposed Tools</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {exposedTools.map((tool) => (
            <button
              type="button"
              key={tool.name}
              className="rounded-md border p-3 text-left"
              onClick={() => insertToolTag(tool.name)}
            >
              <div className="font-mono text-sm">{tool.name}</div>
              <div className="mt-1 flex gap-2">
                <Badge variant="outline">{tool.capability}</Badge>
                <Badge
                  variant={
                    tool.risk_level === "high" || tool.risk_level === "critical"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {tool.risk_level}
                </Badge>
              </div>
            </button>
          ))}
          {exposedTools.length === 0 && (
            <p className="text-sm text-muted-foreground">No tools exposed for this Workspace.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
