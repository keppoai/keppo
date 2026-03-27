import type { ReactNode } from "react";
import { AlertTriangleIcon, InfoIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";

const toneMap = {
  info: {
    icon: InfoIcon,
    container:
      "border-primary/20 bg-primary/6 text-foreground dark:border-primary/30 dark:bg-primary/10",
  },
  success: {
    icon: ShieldCheckIcon,
    container:
      "border-emerald-300/60 bg-emerald-50 text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100",
  },
  warning: {
    icon: AlertTriangleIcon,
    container:
      "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100",
  },
  tip: {
    icon: SparklesIcon,
    container:
      "border-secondary/35 bg-secondary/8 text-foreground dark:border-secondary/30 dark:bg-secondary/12",
  },
} as const;

export function MdxCallout({
  title,
  tone = "info",
  children,
}: {
  title: string;
  tone?: keyof typeof toneMap;
  children: ReactNode;
}) {
  const theme = toneMap[tone];
  const Icon = theme.icon;

  return (
    <div className={`rounded-[24px] border px-5 py-4 shadow-sm ${theme.container}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full border border-current/10 p-1.5">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <div className="mt-2 text-sm leading-6 text-current/85 [&_p]:m-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
