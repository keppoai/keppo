import { describe, expect, it } from "vitest";
import { toProviderSdkError } from "./errors.js";

describe("notion provider sdk errors", () => {
  it("maps auth-like plain text into invalid token errors", () => {
    const sdkError = toProviderSdkError(
      "notion.search",
      new Error("Unauthorized invalid_access_token"),
    );
    expect(sdkError.shape.category).toBe("auth");
    expect(sdkError.shape.code).toBe("invalid_token");
    expect(sdkError.shape.status).toBe(401);
  });

  it("maps not-found plain text into not_found errors", () => {
    const sdkError = toProviderSdkError("notion.getPage", new Error("page not found"));
    expect(sdkError.shape.category).toBe("not_found");
    expect(sdkError.shape.code).toBe("not_found");
    expect(sdkError.shape.status).toBe(404);
  });

  it("maps throttling text into rate-limit retryable errors", () => {
    const sdkError = toProviderSdkError("notion.search", new Error("Too many requests; throttled"));
    expect(sdkError.shape.category).toBe("rate_limit");
    expect(sdkError.shape.code).toBe("rate_limited");
    expect(sdkError.shape.status).toBe(429);
    expect(sdkError.shape.retryable).toBe(true);
  });

  it("maps timeout text into timeout retryable errors", () => {
    const sdkError = toProviderSdkError("notion.queryDatabase", new Error("gateway timeout"));
    expect(sdkError.shape.category).toBe("timeout");
    expect(sdkError.shape.code).toBe("timeout");
    expect(sdkError.shape.status).toBe(504);
    expect(sdkError.shape.retryable).toBe(true);
  });

  it("maps validation-like codes into invalid_request errors", () => {
    const sdkError = toProviderSdkError(
      "notion.createPage",
      new Error("validation failed: invalid_payload"),
    );
    expect(sdkError.shape.category).toBe("validation");
    expect(sdkError.shape.code).toBe("invalid_request");
    expect(sdkError.shape.status).toBe(400);
  });
});
