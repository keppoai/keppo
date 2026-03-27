import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import {
  BotIcon,
  CompassIcon,
  CornerDownLeftIcon,
  LayoutDashboardIcon,
  PlayIcon,
  PlugIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { AutomationPromptModal } from "@/components/automations/automation-prompt-modal";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { useAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { useIntegrations } from "@/hooks/use-integrations";
import { useRouteParams } from "@/hooks/use-route-params";
import { humanizeRunStatus, parsePaginatedAutomations } from "@/lib/automations-view-model";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

type OperatorCommandPaletteProps = {
  workspaceId: string;
};

const EMPTY_CURSOR: string | null = null;

type PaletteAction = {
  id: string;
  label: string;
  description?: string;
  keywords: string[];
  icon: ReactNode;
  shortcut?: string;
  onSelect: () => Promise<void> | void;
};

export function OperatorCommandPalette({ workspaceId }: OperatorCommandPaletteProps) {
  const runtime = useDashboardRuntime();
  const navigate = useNavigate();
  const { canManage } = useAuth();
  const { canAccessAdminPage } = useAdmin();
  const { buildWorkspacePath } = useRouteParams();
  const { integrations, providers, connectProvider } = useIntegrations();
  const [open, setOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const triggerRunMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("automation_runs:triggerAutomationRunManual"),
  );
  const automationsRaw = runtime.useQuery(
    makeFunctionReference<"query">("automations:listAutomations"),
    open && workspaceId
      ? {
          workspace_id: workspaceId,
          paginationOpts: { numItems: 50, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );
  const automations = useMemo(
    () => parsePaginatedAutomations(automationsRaw).page,
    [automationsRaw],
  );
  const connectedProviders = useMemo(
    () => integrations.filter((entry) => entry.connected).map((entry) => entry.provider),
    [integrations],
  );

  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handleCmdK = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const handleOpenRequest = () => setOpen(true);
    document.addEventListener("keydown", handleCmdK);
    window.addEventListener("keppo:open-command-palette", handleOpenRequest);
    return () => {
      document.removeEventListener("keydown", handleCmdK);
      window.removeEventListener("keppo:open-command-palette", handleOpenRequest);
    };
  }, []);

  const runAutomation = useCallback(
    async (automationId: string, automationPath: string) => {
      setBusyAction(`run:${automationId}`);
      try {
        const run = await triggerRunMutation({ automation_id: automationId });
        closePalette();
        await navigate({
          to: buildWorkspacePath(`/automations/${automationPath}/runs/${run.id}`),
        });
      } finally {
        setBusyAction(null);
      }
    },
    [buildWorkspacePath, closePalette, navigate, triggerRunMutation],
  );

  const baseActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: "overview",
        label: "Open dashboard overview",
        description: "See readiness, approvals, and the next operator milestone.",
        keywords: ["dashboard home readiness overview"],
        icon: <LayoutDashboardIcon className="size-4" />,
        shortcut: "G D",
        onSelect: () => {
          closePalette();
          return navigate({ to: buildWorkspacePath("/") });
        },
      },
      {
        id: "approvals",
        label: "Open approvals queue",
        description: "Review human bottlenecks and queued decisions.",
        keywords: ["approvals review pending actions"],
        icon: <ShieldCheckIcon className="size-4" />,
        shortcut: "G A",
        onSelect: () => {
          closePalette();
          return navigate({ to: buildWorkspacePath("/approvals") });
        },
      },
      {
        id: "automations",
        label: "Browse automations",
        description: "Inspect drafted and active automations in this workspace.",
        keywords: ["automations list automations"],
        icon: <BotIcon className="size-4" />,
        onSelect: () => {
          closePalette();
          return navigate({ to: buildWorkspacePath("/automations") });
        },
      },
      {
        id: "integrations",
        label: "Open integrations",
        description: "Connect or enable providers before the next test run.",
        keywords: ["providers integrations connections"],
        icon: <PlugIcon className="size-4" />,
        onSelect: () => {
          closePalette();
          return navigate({ to: buildWorkspacePath("/integrations") });
        },
      },
    ];
    if (canManage()) {
      actions.unshift({
        id: "create-automation",
        label: "Create automation with guided builder",
        description: "Start the staged builder and keep the draft inside this workspace.",
        keywords: ["create automation builder prompt draft automation"],
        icon: <SparklesIcon className="size-4" />,
        shortcut: "N",
        onSelect: () => {
          closePalette();
          setBuilderOpen(true);
        },
      });
    }
    if (canAccessAdminPage) {
      actions.push({
        id: "admin",
        label: "Open admin tools",
        description: "Jump to health, flags, and platform diagnostics.",
        keywords: ["admin health flags"],
        icon: <Settings2Icon className="size-4" />,
        onSelect: () => {
          closePalette();
          return navigate({ to: "/admin" });
        },
      });
    }
    return actions;
  }, [buildWorkspacePath, canAccessAdminPage, canManage, closePalette, navigate]);

  const disconnectedProviders = useMemo(() => {
    const connected = new Set(
      integrations.filter((entry) => entry.connected).map((entry) => entry.provider),
    );
    return providers.filter((provider) => !connected.has(provider)).slice(0, 8);
  }, [integrations, providers]);

  const openAutomations = automations.map((item) => ({
    id: `open:${item.automation.id}`,
    label: `Open ${item.automation.name}`,
    description: item.latest_run
      ? `Latest run ${humanizeRunStatus(item.latest_run.status).toLowerCase()}.`
      : "No runs recorded yet.",
    keywords: [item.automation.name, item.automation.slug, "open automation detail"],
    icon: <CompassIcon className="size-4" />,
    onSelect: () => {
      closePalette();
      return navigate({
        to: buildWorkspacePath(`/automations/${item.automation.slug || item.automation.id}`),
      });
    },
  }));

  const runnableAutomations = canManage()
    ? automations
        .filter((item) => item.automation.status === "active")
        .map((item) => ({
          id: `run:${item.automation.id}`,
          label: `Run ${item.automation.name}`,
          description: item.latest_run
            ? `Last run ${humanizeRunStatus(item.latest_run.status).toLowerCase()}. Trigger another pass now.`
            : "Trigger the first manual run for this active automation.",
          keywords: [
            item.automation.name,
            item.automation.slug,
            "run automation trigger now manual",
            item.latest_run ? humanizeRunStatus(item.latest_run.status) : "never run",
          ],
          icon: <PlayIcon className="size-4" />,
          shortcut: busyAction === `run:${item.automation.id}` ? "..." : undefined,
          onSelect: () =>
            runAutomation(item.automation.id, item.automation.slug || item.automation.id),
        }))
    : [];
  const setupActions = canManage()
    ? baseActions.filter((action) =>
        ["create-automation", "integrations", "approvals"].includes(action.id),
      )
    : baseActions.filter((action) => ["integrations", "approvals"].includes(action.id));
  const navigationActions = baseActions.filter(
    (action) => !setupActions.some((entry) => entry.id === action.id),
  );
  const setupHeading =
    connectedProviders.length === 0 ? "First moves for this workspace" : "Keep setup moving";

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Operator command palette"
        description="Jump between entities, open key surfaces, run automations, and launch the guided builder."
        className="sm:max-w-3xl"
        overlayClassName="bg-black/45 backdrop-blur-md"
      >
        <Command shouldFilter className="bg-linear-to-b from-background via-background to-muted/20">
          <div className="border-b border-border/60 px-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                  Operator command palette
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keyboard-first control for navigation, setup, and manual runs.
                </p>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:flex">
                <CornerDownLeftIcon className="size-3.5" />
                Enter runs selection
              </div>
            </div>
          </div>
          <CommandInput placeholder="Search automations, launch setup work, or open a workspace surface..." />
          <CommandList>
            <CommandEmpty>No matching workspace action.</CommandEmpty>
            <CommandGroup heading={setupHeading}>
              {setupActions.map((action) => (
                <CommandItem
                  key={action.id}
                  keywords={action.keywords}
                  onSelect={() => {
                    void action.onSelect();
                  }}
                >
                  {action.icon}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{action.label}</p>
                    {action.description ? (
                      <p className="truncate text-xs text-muted-foreground">{action.description}</p>
                    ) : null}
                  </div>
                  {action.shortcut ? <CommandShortcut>{action.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>

            {navigationActions.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Navigation">
                  {navigationActions.map((action) => (
                    <CommandItem
                      key={action.id}
                      keywords={action.keywords}
                      onSelect={() => {
                        void action.onSelect();
                      }}
                    >
                      {action.icon}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{action.label}</p>
                        {action.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {action.description}
                          </p>
                        ) : null}
                      </div>
                      {action.shortcut ? (
                        <CommandShortcut>{action.shortcut}</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {openAutomations.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Automations">
                  {openAutomations.map((action) => (
                    <CommandItem
                      key={action.id}
                      keywords={action.keywords}
                      onSelect={() => {
                        void action.onSelect();
                      }}
                    >
                      {action.icon}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{action.label}</p>
                        {action.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {action.description}
                          </p>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                  {runnableAutomations.map((action) => (
                    <CommandItem
                      key={action.id}
                      keywords={action.keywords}
                      onSelect={() => {
                        void action.onSelect();
                      }}
                    >
                      {action.icon}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{action.label}</p>
                        {action.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {action.description}
                          </p>
                        ) : null}
                      </div>
                      {action.shortcut ? (
                        <CommandShortcut>{action.shortcut}</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {canManage() && disconnectedProviders.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Connect providers">
                  {disconnectedProviders.map((provider) => (
                    <CommandItem
                      key={provider}
                      keywords={[provider, "connect integration provider"]}
                      onSelect={() => {
                        setBusyAction(`provider:${provider}`);
                        closePalette();
                        void connectProvider(provider as CanonicalProviderId).finally(() =>
                          setBusyAction((current) =>
                            current === `provider:${provider}` ? null : current,
                          ),
                        );
                      }}
                    >
                      <SearchIcon className="size-4" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Connect {provider}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Authorize this provider before the next test run.
                        </p>
                      </div>
                      {busyAction === `provider:${provider}` ? (
                        <CommandShortcut>...</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
          <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>Arrow keys move</span>
            <span>Enter opens</span>
            <span>Esc closes</span>
          </div>
        </Command>
      </CommandDialog>

      <AutomationPromptModal
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        workspaceId={workspaceId}
      />
    </>
  );
}
