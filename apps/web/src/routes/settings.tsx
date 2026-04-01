import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { orgLayoutRoute } from "./_org";

const settingsTabSchema = z.enum(["account", "appearance", "notifications", "ai"]);

export const settingsSearchSchema = z.object({
  tab: z.preprocess((value) => {
    const parsed = settingsTabSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }, settingsTabSchema.optional()),
});

function SettingsPagePending() {
  return (
    <ShellTransitionState
      title="Loading settings"
      detail="Keppo is restoring account, notification, and AI configuration settings."
    />
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "settings",
  validateSearch: settingsSearchSchema,
  pendingComponent: SettingsPagePending,
}).lazy(() => import("./settings.lazy").then((d) => d.settingsRouteLazy));
