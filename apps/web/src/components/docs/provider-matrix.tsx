import { getProviderMeta } from "@/components/integrations/provider-icons";
import { providerMatrixEntries } from "@/lib/docs/source-static";

export function ProviderMatrix() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/85 shadow-sm">
      <div className="border-b border-border/70 px-5 py-4">
        <h3 className="text-lg font-semibold tracking-tight">Provider inventory</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Public docs stay anchored to the canonical provider IDs already used by the product.
        </p>
      </div>

      <div className="divide-y divide-border/60">
        {providerMatrixEntries.map((entry) => {
          const providerMeta = getProviderMeta(entry.provider);
          const Icon = providerMeta.icon;

          return (
            <div key={entry.provider} className="grid gap-4 px-5 py-4 lg:grid-cols-[1.2fr_1fr_1fr]">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-border/70 bg-background/70 p-2 text-foreground">
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">{entry.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/75">
                  Best for
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{entry.bestFor}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/75">
                  Capabilities
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1 text-xs font-medium">
                    {entry.auth}
                  </span>
                  {entry.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full border border-border/70 bg-background/75 px-3 py-1 text-xs font-medium"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
