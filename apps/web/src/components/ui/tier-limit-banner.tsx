import { Link } from "@tanstack/react-router";
import type { UserFacingError } from "@/lib/user-facing-errors";
import { Button } from "@/components/ui/button";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { buildTierLimitErrorCopy, type TierLimitError } from "@/lib/convex-errors";

type TierLimitBannerProps = {
  limit: TierLimitError;
  billingPath: string;
  className?: string;
};

export function TierLimitBanner({ limit, billingPath, className }: TierLimitBannerProps) {
  const copy = buildTierLimitErrorCopy(limit);
  const error: UserFacingError = {
    code: limit.code.toLowerCase(),
    title: copy.title,
    summary: copy.summary,
    nextSteps: copy.nextSteps,
    technicalDetails: null,
    publicTechnicalDetails: null,
    status: null,
    severity: "warning",
    publicSafe: true,
    metadata: null,
    rawMessage: null,
    sourceMessage: limit.code,
  };

  return (
    <UserFacingErrorView
      error={error}
      {...(className ? { className } : {})}
      action={
        <Button size="sm" variant="outline" render={<Link to={billingPath} />}>
          Open billing
        </Button>
      }
      showTechnicalDetails={false}
    />
  );
}
