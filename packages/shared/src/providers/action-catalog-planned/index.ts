import type { PlannedActionCatalogSeed } from "./types.js";
import { googlePlannedActionCatalogSeeds } from "./google.js";
import { stripePlannedActionCatalogSeeds } from "./stripe.js";
import { githubPlannedActionCatalogSeeds } from "./github.js";
import { slackPlannedActionCatalogSeeds } from "./slack.js";
import { notionPlannedActionCatalogSeeds } from "./notion.js";
import { redditPlannedActionCatalogSeeds } from "./reddit.js";
import { xPlannedActionCatalogSeeds } from "./x.js";
import { customPlannedActionCatalogSeeds } from "./custom.js";

export const plannedActionCatalogSeeds: ReadonlyArray<PlannedActionCatalogSeed> = [
  ...googlePlannedActionCatalogSeeds,
  ...stripePlannedActionCatalogSeeds,
  ...githubPlannedActionCatalogSeeds,
  ...slackPlannedActionCatalogSeeds,
  ...notionPlannedActionCatalogSeeds,
  ...redditPlannedActionCatalogSeeds,
  ...xPlannedActionCatalogSeeds,
  ...customPlannedActionCatalogSeeds,
];
