import { useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, ClipboardIcon, CircleAlertIcon } from "lucide-react";
import type { UserFacingError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

type UserFacingErrorProps = {
  error: UserFacingError;
  variant?: "inline" | "compact" | "page";
  action?: React.ReactNode;
  className?: string;
  showTechnicalDetails?: boolean;
};

const variantClasses: Record<NonNullable<UserFacingErrorProps["variant"]>, string> = {
  inline: "gap-3",
  compact: "gap-2 px-3 py-3 text-sm",
  page: "gap-4 rounded-[18px] px-5 py-5",
};

const variantBySeverity = (severity: UserFacingError["severity"]) => {
  if (severity === "warning") {
    return "warning" as const;
  }
  if (severity === "info") {
    return "info" as const;
  }
  return "destructive" as const;
};

export function UserFacingErrorView({
  error,
  variant = "inline",
  action,
  className,
  showTechnicalDetails = true,
}: UserFacingErrorProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const details = showTechnicalDetails ? error.technicalDetails : null;
  const copyText = useMemo(() => {
    const sections = [error.title, error.summary, ...error.nextSteps];
    if (details) {
      sections.push(details);
    }
    return sections.join("\n");
  }, [details, error.nextSteps, error.summary, error.title]);

  return (
    <Alert
      variant={variantBySeverity(error.severity)}
      className={cn(variantClasses[variant], className)}
    >
      <CircleAlertIcon className="size-4" />
      <AlertTitle className="text-sm font-semibold">{error.title}</AlertTitle>
      {action ? <AlertAction>{action}</AlertAction> : null}
      <AlertDescription className="space-y-4 text-foreground/80 [&_li]:text-foreground/75 [&_p]:text-foreground/80">
        <p>{error.summary}</p>
        {variant !== "compact" ? (
          <ul className="list-disc space-y-1.5 pl-5">
            {error.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        ) : null}
        {details ? (
          <Collapsible open={open} onOpenChange={setOpen}>
            <div className="rounded-xl border border-border/70 bg-background p-3">
              <div className="flex items-center gap-2">
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 justify-start px-1.5 text-muted-foreground hover:text-foreground",
                        open && "bg-muted/60 text-foreground",
                      )}
                    />
                  }
                >
                  <ChevronDownIcon
                    className={cn("run-collapsible-chevron mr-1.5 size-4", open && "rotate-90")}
                  />
                  Technical details
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="pt-3">
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Copy these details if you need help from support.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(copyText);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? (
                        <CheckIcon className="mr-1.5 size-3.5" />
                      ) : (
                        <ClipboardIcon className="mr-1.5 size-3.5" />
                      )}
                      {copied ? "Copied" : "Copy error details"}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-xs leading-5 text-foreground/85">
                    {details}
                  </pre>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
