import type { VariantProps } from "class-variance-authority";
import { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function getRiskBadgeVariant(risk: string): BadgeVariant {
  switch (risk.toLowerCase()) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "warning";
    default:
      return "outline";
  }
}

export function getActionStatusBadgeVariant(status: string): BadgeVariant {
  switch (status.toLowerCase()) {
    case "approved":
      return "default";
    case "rejected":
      return "destructive";
    default:
      return "secondary";
  }
}
