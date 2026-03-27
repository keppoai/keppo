import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeFunctionReference } from "convex/server";

import { useWorkspace } from "./use-workspace-context";
import { buildWorkspaceReadinessSteps } from "@/lib/workspace-readiness";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

export type OnboardingStep = {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href?: string;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
  dismiss: () => void;
  restore: () => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  justCompleted: boolean;
  nextStep: OnboardingStep | null;
};

const EXPANDED_KEY = "keppo:onboarding:expanded";

const dismissedKey = (workspaceId: string) => `keppo:onboarding:dismissed:${workspaceId}`;
const celebratedKey = (workspaceId: string) => `keppo:onboarding:celebrated:${workspaceId}`;

export function useOnboarding(): OnboardingState {
  const { selectedWorkspaceId, selectedWorkspaceMatchesUrl } = useWorkspace();
  const runtime = useDashboardRuntime();
  const activeWorkspaceId = selectedWorkspaceMatchesUrl ? selectedWorkspaceId : "";
  const readiness = runtime.useQuery(
    makeFunctionReference<"query">("onboarding:getReadiness"),
    activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
  );

  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpandedRaw] = useState(() => localStorage.getItem(EXPANDED_KEY) !== "false");
  const prevAllComplete = useRef(false);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setDismissed(false);
      return;
    }
    setDismissed(localStorage.getItem(dismissedKey(selectedWorkspaceId)) === "true");
  }, [selectedWorkspaceId]);

  const steps = useMemo((): OnboardingStep[] => {
    return buildWorkspaceReadinessSteps(readiness);
  }, [readiness]);

  const completedCount = steps.filter((step) => step.completed).length;
  const totalCount = steps.length;
  const allComplete = totalCount > 0 && completedCount === totalCount;
  const nextStep = steps.find((step) => !step.completed) ?? null;

  useEffect(() => {
    if (!selectedWorkspaceId) {
      prevAllComplete.current = false;
      setJustCompleted(false);
      return;
    }
    if (!prevAllComplete.current && allComplete) {
      const celebrated = localStorage.getItem(celebratedKey(selectedWorkspaceId)) === "true";
      if (!celebrated) {
        setJustCompleted(true);
        localStorage.setItem(celebratedKey(selectedWorkspaceId), "true");
      }
    } else {
      setJustCompleted(false);
    }
    prevAllComplete.current = allComplete;
  }, [allComplete, selectedWorkspaceId]);

  const dismiss = useCallback(() => {
    if (!selectedWorkspaceId) {
      setDismissed(true);
      return;
    }
    setDismissed(true);
    localStorage.setItem(dismissedKey(selectedWorkspaceId), "true");
  }, [selectedWorkspaceId]);

  const restore = useCallback(() => {
    if (selectedWorkspaceId) {
      localStorage.removeItem(dismissedKey(selectedWorkspaceId));
    }
    setDismissed(false);
    setExpandedRaw(true);
    localStorage.setItem(EXPANDED_KEY, "true");
  }, [selectedWorkspaceId]);

  const setExpanded = useCallback((value: boolean) => {
    setExpandedRaw(value);
    localStorage.setItem(EXPANDED_KEY, String(value));
  }, []);

  return {
    steps,
    completedCount,
    totalCount,
    allComplete,
    dismissed,
    dismiss,
    restore,
    expanded,
    setExpanded,
    justCompleted,
    nextStep,
  };
}
