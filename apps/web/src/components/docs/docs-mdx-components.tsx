import { AudienceCard } from "./audience-card";
import { DocsSectionHero } from "./docs-section-hero";
import { ProviderMatrix } from "./provider-matrix";
import { ReleaseCard } from "./release-card";
import { MdxCallout } from "./mdx-callout";

export const docsMdxComponents = {
  AudienceCard,
  DocsSectionHero,
  ProviderMatrix,
  ReleaseCard,
  Callout: ({ title, tone, children }: Record<string, unknown>) => (
    <MdxCallout
      title={typeof title === "string" ? title : "Note"}
      tone={
        tone === "success" || tone === "warning" || tone === "tip" || tone === "info"
          ? tone
          : "info"
      }
    >
      {children as React.ReactNode}
    </MdxCallout>
  ),
};
