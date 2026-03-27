import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { unknownErrorResponse } from "./user-facing-error";

const readJson = async (response: Response) => await response.json();

describe("user-facing server errors", () => {
  it("returns a configuration error for env validation failures", async () => {
    const response = unknownErrorResponse(
      new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          input: undefined,
          path: ["IZZY_OPENAI_API_KEY"],
          message: "Missing IZZY_OPENAI_API_KEY",
        },
      ]),
      { action: "generate clarification questions" },
    );

    const payload = await readJson(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("server_configuration_error");
    expect(payload.error.summary).toContain("required server settings");
    expect(payload.error.technicalDetails).toContain("IZZY_OPENAI_API_KEY");
  });

  it("returns an invalid request error for request validation failures", async () => {
    const response = unknownErrorResponse(
      new ZodError([
        {
          code: "too_small",
          minimum: 1,
          inclusive: true,
          origin: "string",
          input: "",
          path: ["prompt"],
          message: "Too small: expected string to have >=1 characters",
        },
      ]),
      { action: "generate clarification questions" },
    );

    const payload = await readJson(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_request");
    expect(payload.error.summary).toContain("submitted request");
    expect(payload.error.technicalDetails).toContain("prompt");
  });

  it("returns an AI generation error for provider/schema failures", async () => {
    const error = new Error("No object generated: response did not match schema.");
    error.name = "NoObjectGeneratedError";

    const response = unknownErrorResponse(error, {
      action: "generate clarification questions",
    });
    const payload = await readJson(response);

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("ai_generation_failed");
    expect(payload.error.summary).toContain("AI provider response");
    expect(payload.error.technicalDetails).toContain("NoObjectGeneratedError");
  });

  it("returns a repo context error for missing GitHub raw files", async () => {
    const response = unknownErrorResponse(new Error("github_raw_404: docs/rules/ux.md"), {
      action: "generate clarification questions",
    });
    const payload = await readJson(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("repo_context_file_missing");
    expect(payload.error.summary).toContain("repo context file");
    expect(payload.error.technicalDetails).toContain("docs/rules/ux.md");
  });

  it("returns a GitHub repo access error for private-repo metadata failures", async () => {
    const response = unknownErrorResponse(
      new Error(
        'github_api_404: {"message":"Not Found","documentation_url":"https://docs.github.com/rest/issues/labels#list-labels-for-a-repository","status":"404"}',
      ),
      {
        action: "generate an issue draft",
      },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("github_repo_access_failed");
    expect(payload.error.summary).toContain("signed-in GitHub session");
    expect(payload.error.technicalDetails).toContain("github_api_404");
  });

  it("returns a GitHub issue write error for integration write failures", async () => {
    const response = unknownErrorResponse(
      new Error(
        'github_api_403: {"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest/issues/issues#create-an-issue","status":"403"}',
      ),
      {
        action: "create the GitHub issue",
      },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("github_issue_write_failed");
    expect(payload.error.summary).toContain("does not have permission to create issues");
    expect(payload.error.technicalDetails).toContain("github_api_403");
  });
});
