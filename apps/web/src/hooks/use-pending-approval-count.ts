import { makeFunctionReference } from "convex/server";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { useWorkspace } from "@/hooks/use-workspace-context";

export function usePendingApprovalCount(): number {
  const runtime = useDashboardRuntime();
  const { selectedWorkspace } = useWorkspace();
  const workspaceId = selectedWorkspace?.id ?? null;

  const count = runtime.useQuery(
    makeFunctionReference<"query">("actions:countPendingByWorkspace"),
    workspaceId ? { workspaceId } : "skip",
  );

  return count ?? 0;
}
