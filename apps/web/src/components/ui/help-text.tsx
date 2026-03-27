import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HelpText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-xs leading-relaxed", className)}>{children}</p>
  );
}
