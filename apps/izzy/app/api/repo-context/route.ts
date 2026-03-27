import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepoContextForPrompt } from "@/lib/github-repo-context";
import { getRepositoryLabels } from "@/lib/github-client";
import { errorResponse, unknownErrorResponse } from "@/lib/user-facing-error";
import { requireIzzySession } from "@/lib/session";

const requestSchema = z.object({
  prompt: z.string().trim().max(4_000).default(""),
});

export async function POST(request: Request) {
  try {
    const session = await requireIzzySession();
    const payload = requestSchema.parse(await request.json());
    const [contextFiles, labels] = await Promise.all([
      getRepoContextForPrompt(payload.prompt),
      getRepositoryLabels(session.accessToken),
    ]);
    return NextResponse.json({
      ok: true,
      contextFiles,
      availableLabels: labels,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_session") {
      return errorResponse(401, {
        code: "unauthorized",
        title: "Sign in required",
        summary: "You need an approved GitHub session to use Izzy.",
        nextSteps: ["Sign in with GitHub.", "Use an allowlisted GitHub account."],
      });
    }
    return unknownErrorResponse(error, {
      action: "load repo context",
    });
  }
}
