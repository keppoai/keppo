import { makeFunctionReference } from "convex/server";
import type { KnownFeatureFlag } from "@keppo/shared/feature-flags";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

export function useFeatureAccess(key: string): boolean {
  const runtime = useDashboardRuntime();
  const featureKey = key.trim();
  const hasAccess = runtime.useQuery(
    makeFunctionReference<"query">("admin:orgFeatureAccess"),
    featureKey.length > 0 ? { featureKey } : "skip",
  );
  return hasAccess === true;
}

export function useGlobalFeatureFlag(key: KnownFeatureFlag): boolean {
  const runtime = useDashboardRuntime();
  const enabled = runtime.useQuery(
    makeFunctionReference<"query">("feature_flags:getFeatureFlagValue"),
    { key },
  );
  return enabled === true;
}
