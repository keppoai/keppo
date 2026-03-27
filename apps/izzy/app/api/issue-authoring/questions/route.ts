import { NextResponse } from "next/server";
import { questionsRequestSchema } from "@/lib/contracts";
import { getRepoContextForPrompt } from "@/lib/github-repo-context";
import { generateClarificationQuestions } from "@/lib/questions";
import { errorResponse, unknownErrorResponse } from "@/lib/user-facing-error";
import { requireIzzySession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    await requireIzzySession();
    const payload = questionsRequestSchema.parse(await request.json());
    const context = await getRepoContextForPrompt(payload.prompt);
    const generated = await generateClarificationQuestions({
      input: payload,
      context,
    });
    return NextResponse.json({
      ok: true,
      questions: generated.questions,
      contextFiles: context.map((entry) => entry.path),
      imageNotes: generated.imageNotes,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_session") {
      return errorResponse(401, {
        code: "unauthorized",
        title: "Sign in required",
        summary: "You need an approved GitHub session to generate questions.",
        nextSteps: ["Sign in with GitHub.", "Use an allowlisted GitHub account."],
      });
    }
    return unknownErrorResponse(error, {
      action: "generate clarification questions",
    });
  }
}
