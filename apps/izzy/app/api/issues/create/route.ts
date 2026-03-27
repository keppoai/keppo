import { NextResponse } from "next/server";
import { createIssueRequestSchema } from "@/lib/contracts";
import { createRepositoryIssue } from "@/lib/github-client";
import { requireIzzySession } from "@/lib/session";
import { errorResponse, unknownErrorResponse } from "@/lib/user-facing-error";

export async function POST(request: Request) {
  try {
    const session = await requireIzzySession();
    const payload = createIssueRequestSchema.parse(await request.json());
    const created = await createRepositoryIssue({
      token: session.accessToken,
      title: payload.title,
      body: payload.body,
      labels: payload.labels,
    });
    return NextResponse.json({
      ok: true,
      issueNumber: created.number,
      issueUrl: created.html_url,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_session") {
      return errorResponse(401, {
        code: "unauthorized",
        title: "Sign in required",
        summary: "You need an approved GitHub session to create an issue.",
        nextSteps: ["Sign in with GitHub.", "Use an allowlisted GitHub account."],
      });
    }
    return unknownErrorResponse(error, {
      action: "create the GitHub issue",
    });
  }
}
