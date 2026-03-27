import { describe, expect, it } from "vitest";
import { parseGeneratedConfig } from "./automation-prompt-box";

describe("parseGeneratedConfig", () => {
  it("accepts persisted draft payloads without ok=true", () => {
    expect(
      parseGeneratedConfig({
        name: "Draft without success marker",
        prompt: "Do the thing",
        description: "Persisted draft",
        mermaid_content: "flowchart TD\nA-->B",
        trigger_type: "manual",
        provider_recommendations: [],
        credit_balance: {
          allowance_remaining: 1,
          purchased_remaining: 0,
          total_available: 1,
        },
      }),
    ).toMatchObject({
      name: "Draft without success marker",
      prompt: "Do the thing",
    });
  });

  it("rejects explicit non-success payloads", () => {
    expect(
      parseGeneratedConfig({
        ok: false,
        name: "Draft without success marker",
        credit_balance: {
          allowance_remaining: 1,
          purchased_remaining: 0,
          total_available: 1,
        },
      }),
    ).toBeNull();
  });

  it("accepts successful payloads", () => {
    expect(
      parseGeneratedConfig({
        ok: true,
        name: "Valid draft",
        prompt: "Do the thing",
        description: "Valid response",
        mermaid_content: "flowchart TD\nA-->B",
        trigger_type: "manual",
        provider_recommendations: [],
        credit_balance: {
          allowance_remaining: 1,
          purchased_remaining: 0,
          total_available: 1,
        },
      }),
    ).toMatchObject({
      name: "Valid draft",
      prompt: "Do the thing",
    });
  });
});
