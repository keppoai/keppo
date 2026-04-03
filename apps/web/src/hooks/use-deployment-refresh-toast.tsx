import { useEffect, useRef } from "react";
import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

const DEPLOYMENT_CHECK_INTERVAL_MS = 60_000;

const readNonEmptyString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const getClientBuildId = (): string => {
  return readNonEmptyString(import.meta.env.VITE_KEPPO_CLIENT_BUILD_ID);
};

const getServerBuildId = (payload: unknown): string => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const record = payload as Record<string, unknown>;
  return readNonEmptyString(record.buildId);
};

export function useDeploymentRefreshToast({ enabled = true }: { enabled?: boolean } = {}) {
  const runtime = useDashboardRuntime();
  const inflightRef = useRef(false);
  const shownBuildIdRef = useRef<string>("");

  useEffect(() => {
    const clientBuildId = getClientBuildId();
    if (import.meta.env.SSR || !enabled || clientBuildId.length === 0) {
      return;
    }

    let cancelled = false;

    const checkForNewDeployment = async (): Promise<void> => {
      if (cancelled || inflightRef.current) {
        return;
      }
      inflightRef.current = true;
      try {
        const response = await runtime.fetch("/api/version", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          return;
        }

        const responseText = await response.text();
        const payload = responseText.length > 0 ? parseJsonValue(responseText) : null;
        const serverBuildId = getServerBuildId(payload);
        if (
          serverBuildId.length === 0 ||
          serverBuildId === clientBuildId ||
          shownBuildIdRef.current === serverBuildId
        ) {
          return;
        }

        shownBuildIdRef.current = serverBuildId;
        toast.custom(
          (id) => (
            <div className="w-[min(420px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-border bg-popover p-4 shadow-lg">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-popover-foreground">
                  A newer version of Keppo is available.
                </p>
                <p className="text-sm text-muted-foreground">
                  Reload to use the latest deployment.
                </p>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    toast.dismiss(id);
                  }}
                >
                  Later
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    toast.dismiss(id);
                    window.location.reload();
                  }}
                >
                  Reload
                </Button>
              </div>
            </div>
          ),
          {
            id: "deployment-refresh-toast",
            duration: Number.POSITIVE_INFINITY,
          },
        );
      } catch {
        // Best-effort only; version checks should never break the dashboard.
      } finally {
        inflightRef.current = false;
      }
    };

    void checkForNewDeployment();
    const intervalId = window.setInterval(() => {
      void checkForNewDeployment();
    }, DEPLOYMENT_CHECK_INTERVAL_MS);
    const handleFocus = () => {
      void checkForNewDeployment();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewDeployment();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      toast.dismiss("deployment-refresh-toast");
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, runtime]);
}
