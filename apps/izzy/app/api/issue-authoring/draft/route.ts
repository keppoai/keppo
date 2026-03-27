import { NextResponse } from "next/server";
import { draftRequestSchema } from "@/lib/contracts";
import { generateIssueDraft } from "@/lib/draft";
import { getRepositoryLabels } from "@/lib/github-client";
import { getRepoContextForPrompt } from "@/lib/github-repo-context";
import { requireIzzySession } from "@/lib/session";
import { errorResponse, unknownErrorResponse } from "@/lib/user-facing-error";

export async function POST(request: Request) {
  try {
    const session = await requireIzzySession();
    const payload = draftRequestSchema.parse(await request.json());
    const [context, availableLabels] = await Promise.all([
      getRepoContextForPrompt(payload.prompt),
      getRepositoryLabels(session.accessToken),
    ]);
    const response = await generateIssueDraft({
      input: payload,
      context,
      availableLabels,
    });
    return NextResponse.json({
      ok: true,
      ...response,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_session") {
      return errorResponse(401, {
        code: "unauthorized",
        title: "Sign in required",
        summary: "You need an approved GitHub session to generate a draft.",
        nextSteps: ["Sign in with GitHub.", "Use an allowlisted GitHub account."],
      });
    }
    return unknownErrorResponse(error, {
      action: "generate an issue draft",
    });
  }
}
