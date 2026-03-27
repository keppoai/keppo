import { useEffect, useMemo, useRef, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { toast } from "sonner";
import { parsePendingActionsPayload } from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { useWorkspace } from "@/hooks/use-workspace-context";

const SOUND_PREF_KEY = "keppo:notifications:sound";

export const readApprovalSoundPreference = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SOUND_PREF_KEY) === "true";
};

const isAutomationRuntime = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.webdriver;
};

export function useApprovalSoundPreference() {
  const [enabled, setEnabled] = useState(readApprovalSoundPreference);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SOUND_PREF_KEY, enabled ? "true" : "false");
  }, [enabled]);

  return { enabled, setEnabled };
}

export function useApprovalAlerts() {
  const runtime = useDashboardRuntime();
  const { selectedWorkspaceId, selectedWorkspaceMatchesUrl } = useWorkspace();
  const rawActions = runtime.useQuery(
    makeFunctionReference<"query">("actions:listPendingByWorkspace"),
    selectedWorkspaceId && selectedWorkspaceMatchesUrl
      ? { workspaceId: selectedWorkspaceId }
      : "skip",
  );
  const actions = useMemo(() => parsePendingActionsPayload(rawActions ?? []), [rawActions]);
  const previousIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ids = new Set(actions.map((action) => action.id));
    if (previousIdsRef.current === null) {
      previousIdsRef.current = ids;
      return;
    }

    const newActions = actions.filter((action) => !previousIdsRef.current?.has(action.id));
    previousIdsRef.current = ids;
    if (newActions.length === 0 || isAutomationRuntime()) {
      return;
    }

    const title =
      newActions.length === 1
        ? `New approval: ${newActions[0]?.action_type ?? "action"} (${newActions[0]?.risk_level ?? "pending"})`
        : `${newActions.length} new approvals need review`;
    toast.info(title, { duration: 5000 });

    if (!readApprovalSoundPreference()) {
      return;
    }

    const audio = new Audio("/sounds/notification.mp3");
    void audio.play().catch(() => undefined);
  }, [actions]);
}
