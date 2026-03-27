import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type UserFacingErrorPayload = {
  ok: false;
  error: {
    code: string;
    title: string;
    summary: string;
    nextSteps: string[];
    technicalDetails: string | null;
  };
};

export const buildErrorPayload = (params: {
  code: string;
  title: string;
  summary: string;
  nextSteps: string[];
  technicalDetails?: string | null;
}): UserFacingErrorPayload => ({
  ok: false,
  error: {
    code: params.code,
    title: params.title,
    summary: params.summary,
    nextSteps: params.nextSteps,
    technicalDetails: params.technicalDetails ?? null,
  },
});

export const errorResponse = (
  status: number,
  params: {
    code: string;
    title: string;
    summary: string;
    nextSteps: string[];
    technicalDetails?: string | null;
  },
) => NextResponse.json(buildErrorPayload(params), { status });

const summarizeZodIssues = (error: ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("\n");

const isEnvConfigurationIssue = (error: ZodError): boolean =>
  error.issues.some((issue) => {
    const [firstPathSegment] = issue.path;
    return typeof firstPathSegment === "string" && /^[A-Z0-9_]+$/.test(firstPathSegment);
  });

const isAiGenerationIssue = (error: unknown): error is Error =>
  error instanceof Error &&
  /NoObjectGeneratedError|TypeValidationError|APICallError|AI_/i.test(
    `${error.name} ${error.message}`,
  );

const isMissingRepoContextIssue = (error: unknown): error is Error =>
  error instanceof Error && /github_raw_404:/i.test(error.message);

const isGithubRepoAccessIssue = (error: unknown): error is Error =>
  error instanceof Error &&
  /github_api_(403|404):/i.test(error.message) &&
  /issues\/labels|"Not Found"|"Resource not accessible/i.test(error.message);

const isGithubIssueWriteAccessIssue = (error: unknown): error is Error =>
  error instanceof Error &&
  /github_api_403:/i.test(error.message) &&
  /Resource not accessible by integration/i.test(error.message) &&
  /rest\/issues\/issues#create-an-issue/i.test(error.message);

const toTechnicalDetails = (error: unknown): string | null => {
  if (error instanceof ZodError) {
    return summarizeZodIssues(error);
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
};

export const unknownErrorResponse = (
  error: unknown,
  context?: {
    action?: string;
  },
) => {
  const action = context?.action ?? "finish that step";
  console.error(`[izzy] Failed to ${action}`, error);

  if (error instanceof ZodError) {
    if (isEnvConfigurationIssue(error)) {
      return errorResponse(500, {
        code: "server_configuration_error",
        title: "Izzy server configuration is incomplete",
        summary: `Izzy cannot ${action} because one or more required server settings are missing or invalid.`,
        nextSteps: [
          "Check the technical details for the missing or invalid environment variable.",
          "Update the local env configuration, then retry the request.",
        ],
        technicalDetails: toTechnicalDetails(error),
      });
    }

    return errorResponse(400, {
      code: "invalid_request",
      title: "Request data is invalid",
      summary: `Izzy could not ${action} because the submitted request was incomplete or malformed.`,
      nextSteps: [
        "Review the current form values and try again.",
        "If the error keeps happening, check the technical details for the failing field.",
      ],
      technicalDetails: toTechnicalDetails(error),
    });
  }

  if (isAiGenerationIssue(error)) {
    return errorResponse(502, {
      code: "ai_generation_failed",
      title: "AI generation failed",
      summary: `Izzy could not ${action} because the AI provider response was invalid or unavailable.`,
      nextSteps: [
        "Retry the request once.",
        "If the problem keeps happening, check the technical details for the provider or schema error.",
      ],
      technicalDetails: toTechnicalDetails(error),
    });
  }

  if (isMissingRepoContextIssue(error)) {
    return errorResponse(500, {
      code: "repo_context_file_missing",
      title: "Repo context could not be loaded",
      summary: `Izzy could not ${action} because a required repo context file was not available at the configured repository ref.`,
      nextSteps: [
        "Check the technical details for the missing file path.",
        "Verify the target repo owner, name, and ref configuration, then retry.",
      ],
      technicalDetails: toTechnicalDetails(error),
    });
  }

  if (isGithubIssueWriteAccessIssue(error)) {
    return errorResponse(502, {
      code: "github_issue_write_failed",
      title: "GitHub issue creation is not allowed",
      summary: `Izzy could not ${action} because the GitHub App token does not have permission to create issues in the target repository.`,
      nextSteps: [
        "Update the GitHub App installation so the target repository grants Issues: Read and write.",
        "After updating the app permissions, sign out and sign back in to mint a fresh GitHub App token.",
      ],
      technicalDetails: toTechnicalDetails(error),
    });
  }

  if (isGithubRepoAccessIssue(error)) {
    return errorResponse(502, {
      code: "github_repo_access_failed",
      title: "GitHub repo access failed",
      summary: `Izzy could not ${action} because the signed-in GitHub session could not read the target repository metadata.`,
      nextSteps: [
        "Make sure the signed-in GitHub account can access the target private repository.",
        "Sign out and sign back in so Izzy can mint a fresh GitHub App token for the target repository.",
      ],
      technicalDetails: toTechnicalDetails(error),
    });
  }

  return errorResponse(500, {
    code: "unexpected_error",
    title: "Something went wrong",
    summary: `Izzy could not ${action}.`,
    nextSteps: ["Try again.", "If the problem keeps happening, check the technical details."],
    technicalDetails: toTechnicalDetails(error),
  });
};
