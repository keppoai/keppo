import { BookOpenTextIcon, CircleHelpIcon, GithubIcon, MailIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type HelpDialogProps = {
  orgId: string | null;
  workspaceId: string | null;
  tier: "free" | "starter" | "pro" | null;
};

const buildGitHubIssueHref = (orgId: string | null, workspaceId: string | null): string => {
  const url = new URL("https://github.com/keppoai/keppo/issues/new");
  const body = [
    "Support context",
    "",
    `org_id: ${orgId ?? "unknown"}`,
    `workspace_id: ${workspaceId ?? "unknown"}`,
    "",
    "What happened?",
    "",
    "What did you expect instead?",
  ].join("\n");
  url.searchParams.set("body", body);
  url.searchParams.set("title", "");
  return url.toString();
};

const buildMailtoHref = (orgId: string | null, workspaceId: string | null): string => {
  const mailto = new URL("mailto:support@keppo.ai");
  mailto.searchParams.set(
    "subject",
    `Keppo support request (${orgId ?? "unknown org"} / ${workspaceId ?? "unknown workspace"})`,
  );
  mailto.searchParams.set(
    "body",
    [
      `org_id: ${orgId ?? "unknown"}`,
      `workspace_id: ${workspaceId ?? "unknown"}`,
      "",
      "Issue:",
    ].join("\n"),
  );
  return mailto.toString();
};

export function HelpDialog({ orgId, workspaceId, tier }: HelpDialogProps) {
  const showEmail = tier === "starter" || tier === "pro";

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="icon-sm" aria-label="Help and support" />}
      >
        <CircleHelpIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Help & Support</DialogTitle>
          <DialogDescription>
            GitHub issues are the recommended path for bugs, feature requests, and general
            questions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3">
              <BookOpenTextIcon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-medium">Read the docs</p>
                <p className="text-sm text-muted-foreground">
                  Product guides, self-hosting docs, release notes, and contributor references.
                </p>
                <Button variant="outline" size="sm" render={<a href="/docs" />}>
                  Open docs
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <GithubIcon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-medium">File a GitHub issue</p>
                <p className="text-sm text-muted-foreground">
                  Recommended for bugs, feature requests, and general questions.
                </p>
                <Button
                  variant="default"
                  size="sm"
                  render={
                    <a
                      href={buildGitHubIssueHref(orgId, workspaceId)}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Open issue form
                </Button>
              </div>
            </div>
          </div>

          {showEmail ? (
            <div className="rounded-2xl border p-4">
              <div className="flex items-start gap-3">
                <MailIcon className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-medium">Send support email</p>
                  <p className="text-sm text-muted-foreground">
                    Best for billing and account issues.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={buildMailtoHref(orgId, workspaceId)} />}
                  >
                    Email support
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
