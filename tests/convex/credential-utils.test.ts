import { describe, expect, it } from "vitest";
import { isKeppoToken, validateTokenEntropy } from "../../convex/credential_utils";

describe("credential utility guards", () => {
  it("recognizes keppo bearer tokens that include a suffix", () => {
    expect(isKeppoToken("keppo_example-token-123")).toBe(true);
  });

  it("rejects empty, prefix-only, and wrong-prefix tokens", () => {
    expect(isKeppoToken("")).toBe(false);
    expect(isKeppoToken("keppo_")).toBe(false);
    expect(isKeppoToken("other_prefix_abc")).toBe(false);
  });

  it("rejects tokens shorter than 32 characters", () => {
    expect(validateTokenEntropy("keppo_short_token_1234567890")).toBe(false);
  });

  it("rejects tokens with fewer than eight unique characters", () => {
    expect(validateTokenEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("rejects tokens that only use one character class", () => {
    expect(validateTokenEntropy("abcdefghijklmnopqrstuvwxyzabcdef")).toBe(false);
  });

  it("accepts sufficiently long tokens with varied characters", () => {
    expect(validateTokenEntropy("keppo_ABcd1234xyZ9!keppo_ABcd1234")).toBe(true);
  });

  it("accepts the exact 32-char boundary with eight unique chars across two classes", () => {
    expect(validateTokenEntropy("abcd1234abcd1234abcd1234abcd1234")).toBe(true);
  });
});
