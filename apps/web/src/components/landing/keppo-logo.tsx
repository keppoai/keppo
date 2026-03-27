import { cn } from "@/lib/utils";

/**
 * Keppo K mark — soft paper origami K logo.
 */
export function KeppoMark({ className }: { className?: string }) {
  return <img src="/keppo-logo.png" alt="Keppo" className={cn("size-8", className)} />;
}

export function KeppoWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <KeppoMark className="size-7" />
      <span className="text-lg font-bold tracking-tight text-foreground">Keppo</span>
    </div>
  );
}
