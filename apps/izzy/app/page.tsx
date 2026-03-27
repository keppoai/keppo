import React from "react";
import { getServerSession } from "next-auth";
import { IssueFlow } from "@/components/issue-flow/issue-flow";
import { getAuthOptions, hasAuthConfiguration } from "@/lib/auth";
import { parseActionFromSearchParams, parseAgentsFromSearchParams } from "@/lib/labels";
import { getPreviewGithubLogin, getPreviewSeed } from "@/lib/preview";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = hasAuthConfiguration() ? await getServerSession(getAuthOptions()) : null;
  const resolvedSearchParams = await searchParams;
  const previewGithubLogin = getPreviewGithubLogin();
  const previewSeed = getPreviewSeed(resolvedSearchParams);

  return (
    <IssueFlow
      authError={
        typeof resolvedSearchParams.authError === "string" ? resolvedSearchParams.authError : null
      }
      githubLogin={previewGithubLogin ?? session?.user?.githubLogin ?? null}
      initialAction={parseActionFromSearchParams(
        resolvedSearchParams.action ?? resolvedSearchParams.workflow,
      )}
      initialAgents={parseAgentsFromSearchParams(resolvedSearchParams.agent)}
      previewSeed={previewSeed}
    />
  );
}
